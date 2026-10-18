// 门禁 #4: 二维码编码器正确性 —— 独立解码器 + 真实解码库双向验证
//
// 为什么值得单独一道门禁: 二维码画错的表现是"看着像二维码, 但手机扫不出来",
// 真机上极难定位 (到底是编码错、掩码错、还是渲染错). 这里用两条互相独立的链路钉死:
//
//   链路 A (纯 JS, 逆推): 把编码结果的矩阵重新"解码"一遍 —— 解格式信息 -> 去掩码 ->
//     按 zigzag 读回码字 -> 反交织 -> 校验 RS 伴随式全为 0 -> 解析 Byte 模式 -> 比对原文.
//     覆盖: 版本选择/功能图形/格式信息位序/掩码/RS 数学/分块交织/余数位.
//
//   链路 B (外部实现): 若本机有 Python + OpenCV, 把矩阵渲染成 PNG 交给 cv2.QRCodeDetector
//     真解一次. 这是与项目源码完全无关的第三方实现, 能抓住"两条链路共有的规范理解错误".
//     缺 OpenCV 时跳过 (打印 SKIP), 不影响门禁结论.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const U = (p) => pathToFileURL(path.join(ROOT, 'src', p)).href
const QR = await import(U('services/qrcode.js'))

let pass = 0
const ok = (c, m) => { assert.ok(c, m); pass++ }
const eq = (a, b, m) => { assert.equal(a, b, m); pass++ }

// ---------------- 标准测试向量 ----------------
// ISO/IEC 18004 表 C.1: 格式信息 (纠错级 M, 掩码 0) = 0x5412 (恰等于 BCH 掩码常量本身)
eq(QR.formatBits(0, 0), 0x5412, '格式信息 (M, mask0) = 0x5412')
eq(QR.formatBits(0, 1), 0x5125, '格式信息 (M, mask1) = 0x5125')
// ISO/IEC 18004 表 D.1: 版本信息
eq(QR.versionBits(7), 0x07c94, '版本信息 v7 = 0x07C94')
eq(QR.versionBits(8), 0x085bc, '版本信息 v8 = 0x085BC')

// ---------------- 容量表 (M 级 Byte) ----------------
const CAP = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]
const REMAINDER = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0]
for (let v = 1; v <= 10; v++) eq(QR.byteCapacity(v), CAP[v - 1], 'v' + v + ' 的 M 级 Byte 容量 ' + CAP[v - 1])
eq(QR.maxCapacity(), 213, '最大容量 213 字节 (v10-M)')

// ---------------- 独立解码器 ----------------
const EC_M = {
  1: [26, 10, [16, 1], null], 2: [44, 16, [28, 1], null], 3: [70, 26, [44, 1], null],
  4: [100, 18, [32, 2], null], 5: [134, 24, [43, 2], null], 6: [172, 16, [27, 4], null],
  7: [196, 18, [31, 4], null], 8: [242, 22, [38, 2], [39, 2]], 9: [292, 22, [36, 3], [37, 2]],
  10: [346, 26, [43, 4], [44, 1]]
}
const ALIGN = [null, [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

const EXP = new Array(256)
const LOG = new Array(256)
;(function () {
  let x = 1
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x >= 256) x ^= 0x11d }
  EXP[255] = EXP[0]
})()
const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]

/** 按标准还原"功能图形占用表" (与编码器完全独立的一份实现) */
function reservedMap(version) {
  const size = version * 4 + 17
  const res = []
  for (let r = 0; r < size; r++) { const row = []; for (let c = 0; c < size; c++) row.push(false); res.push(row) }
  const box = (r0, c0, h, w) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < size && c < size) res[r][c] = true }
  // 三个寻像图形 + 分隔符 (8x8) 与格式信息所在的 row8 / col8
  box(0, 0, 9, 9)
  box(0, size - 8, 9, 8)
  box(size - 8, 0, 8, 9)
  // 时序图形
  box(6, 0, 1, size)
  box(0, 6, size, 1)
  // 校正图形
  if (version >= 2) {
    const cs = ALIGN[version - 1]
    for (const ar of cs) for (const ac of cs) {
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue
      box(ar - 2, ac - 2, 5, 5)
    }
  }
  // 版本信息
  if (version >= 7) { box(0, size - 11, 6, 3); box(size - 11, 0, 3, 6) }
  return { size, res }
}

function readFormat(m, size) {
  const bits = new Array(15)
  for (let i = 0; i <= 5; i++) bits[i] = m[i][8]
  bits[6] = m[7][8]; bits[7] = m[8][8]; bits[8] = m[8][7]
  for (let i = 9; i < 15; i++) bits[i] = m[8][14 - i]
  const b2 = new Array(15)
  for (let i = 0; i < 8; i++) b2[i] = m[8][size - 1 - i]
  for (let i = 8; i < 15; i++) b2[i] = m[size - 15 + i][8]
  let v1 = 0, v2 = 0
  for (let i = 0; i < 15; i++) { v1 |= bits[i] << i; v2 |= b2[i] << i }
  assert.equal(v1, v2, '格式信息两份副本必须一致')
  const ec = ((v1 ^ 0x5412) >>> 13) & 0x3
  const mask = ((v1 ^ 0x5412) >>> 10) & 0x7
  assert.equal(QR.formatBits(ec, mask), v1, '格式信息 BCH 自校验通过')
  return { ec, mask }
}

function maskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0
    case 1: return r % 2 === 0
    case 2: return c % 3 === 0
    case 3: return (r + c) % 3 === 0
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  }
}

/** 逆推: 矩阵 -> 文本. 任何一步不符就抛 (门禁失败) */
function decode(m, size) {
  const version = (size - 17) / 4
  ok(Number.isInteger(version) && version >= 1 && version <= 40, '边长 ' + size + ' 对应合法版本')
  const { res } = reservedMap(version)
  const fmt = readFormat(m, size)
  eq(fmt.ec, 0, '纠错级必须是 M (bits 00)')

  const bits = []
  let inc = -1
  let row = size - 1
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5
    while (true) {
      for (let j = 0; j < 2; j++) {
        const cc = col - j
        if (!res[row][cc]) {
          let v = m[row][cc] === 1
          if (maskBit(fmt.mask, row, cc)) v = !v
          bits.push(v ? 1 : 0)
        }
      }
      row += inc
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break }
    }
  }

  const t = EC_M[version]
  const totalCw = t[0]
  eq(bits.length, totalCw * 8 + REMAINDER[version], '数据区比特数 = 码字位 + 余数位 (v' + version + ')')
  for (let i = totalCw * 8; i < bits.length; i++) eq(bits[i], 0, '余数位去掩码后必须为 0')

  const cw = []
  for (let i = 0; i + 8 <= totalCw * 8; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    cw.push(b)
  }

  const g1 = t[2]
  const g2 = t[3]
  const ecCount = t[1]
  const blocks = []
  for (let i = 0; i < g1[1]; i++) blocks.push({ len: g1[0], data: [], ec: [] })
  if (g2) for (let i = 0; i < g2[1]; i++) blocks.push({ len: g2[0], data: [], ec: [] })
  let p = 0
  let maxLen = g1[0]
  if (g2 && g2[0] > maxLen) maxLen = g2[0]
  for (let i = 0; i < maxLen; i++) for (let b = 0; b < blocks.length; b++) if (i < blocks[b].len) blocks[b].data.push(cw[p++])
  for (let i = 0; i < ecCount; i++) for (let b = 0; b < blocks.length; b++) blocks[b].ec.push(cw[p++])
  eq(p, totalCw, '码字总数与版本表一致')

  // RS 伴随式: 每块的 C(α^i) 必须全为 0 (编码数学错误的唯一可靠判据)
  for (let b = 0; b < blocks.length; b++) {
    const full = blocks[b].data.concat(blocks[b].ec)
    for (let i = 0; i < ecCount; i++) {
      let s = 0
      for (let k = 0; k < full.length; k++) s = mul(s, EXP[i]) ^ full[k]
      eq(s, 0, 'v' + version + ' 第 ' + (b + 1) + ' 块 RS 伴随式 S' + i + ' = 0')
    }
  }

  const dataBits = []
  for (let b = 0; b < blocks.length; b++) for (let k = 0; k < blocks[b].data.length; k++) for (let i = 7; i >= 0; i--) dataBits.push((blocks[b].data[k] >>> i) & 1)
  let q = 0
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | dataBits[q++]; return v }
  eq(take(4), 4, '模式指示符 = 0100 (Byte)')
  const len = take(version <= 9 ? 8 : 16)
  const bytes = []
  for (let i = 0; i < len; i++) bytes.push(take(8))
  return { version, mask: fmt.mask, bytes }
}

function fromUtf8(bytes) {
  let s = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    let cp = 0
    if (b < 0x80) { cp = b; i++ }
    else if (b < 0xe0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 2 }
    else if (b < 0xf0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); i += 3 }
    else { cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); i += 4 }
    if (cp > 0xffff) { cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)) }
    else s += String.fromCharCode(cp)
  }
  return s
}

// ---------------- 样本: 覆盖每个版本的容量上下界 ----------------
const SAMPLES = []
// 线上实测形态的 B 站登录 url 长度 (131 字节)
const BILI = 'https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=74535df8401177948cc47c1ce0906f17&from='
eq(Buffer.byteLength(BILI, 'utf8'), 131, '样本 url = 131 字节 (与线上实测同长)')
SAMPLES.push(BILI)
for (let v = 1; v <= 10; v++) {
  SAMPLES.push('A'.repeat(CAP[v - 1]))          // 恰好填满该版本
  if (v > 1) SAMPLES.push('A'.repeat(CAP[v - 1] - 1))  // 差 1 字节: 必须回落到上一版
}
SAMPLES.push('哔哩哔哩 · 词典笔搜索')
SAMPLES.push('emoji 😀😀 混排')
SAMPLES.push('')
SAMPLES.push('1')

let maxVersion = 0
const masksSeen = {}
for (const text of SAMPLES) {
  const m = QR.qrcodeMatrix(text)
  eq(m.rows.length, m.size, '矩阵行数 = size')
  for (const row of m.rows) eq(row.length, m.size, '矩阵列数 = size')
  for (const row of m.rows) for (const v of row) ok(v === 0 || v === 1, '矩阵单元只有 0/1')

  const s = m.size
  for (const [r0, c0] of [[0, 0], [0, s - 7], [s - 7, 0]]) {
    eq(m.rows[r0 + 3][c0 + 3], 1, '寻像图形中心为暗')
    eq(m.rows[r0][c0], 1, '寻像图形外框为暗')
    eq(m.rows[r0 + 1][c0 + 1], 0, '寻像图形内圈为亮')
  }
  for (let i = 8; i < s - 8; i++) {
    eq(m.rows[6][i], i % 2 === 0 ? 1 : 0, '水平时序图形交替')
    eq(m.rows[i][6], i % 2 === 0 ? 1 : 0, '垂直时序图形交替')
  }
  eq(m.rows[s - 8][8], 1, '恒暗模块为暗')

  const d = decode(m.rows, m.size)
  eq(d.version, m.version, '解码版本与编码一致')
  eq(d.mask, m.mask, '解码掩码与编码一致')
  eq(fromUtf8(d.bytes), text, '解码文本与原文一致 (' + Buffer.byteLength(text, 'utf8') + 'B, v' + m.version + ')')
  masksSeen[d.mask] = (masksSeen[d.mask] || 0) + 1
  if (m.version > maxVersion) maxVersion = m.version
}
ok(maxVersion === 10, '样本覆盖到 v10 (最大版本 ' + maxVersion + ')')
ok(Object.keys(masksSeen).length >= 3, '掩码分选确实生效 (命中 ' + Object.keys(masksSeen).length + ' 种), 不是固定掩码')

let threw = false
try { QR.qrcodeMatrix('B'.repeat(214)) } catch (e) { threw = true }
ok(threw, '超过 213 字节时抛出明确错误')

// ---------------- 链路 B: 第三方实现双向验证 ----------------
// B1 矩阵逐模块比对: 强制参考库也走 Byte 模式 + 同一个版本/掩码, 两份矩阵必须**逐模块一致**
//    (Python qrcode 库默认会对 'AAAA' 这类内容选字母数字模式, 不强制就比不了)
// B2 真实解码: zbar (pyzbar) 与 OpenCV 都解一遍. zbar 是成熟解码器; cv2.QRCodeDetector 对
//     部分合法码会检测不到 (参考库生成的同一矩阵它也会失败), 所以只做统计不做硬断言.
function pythonCmdFor(mods) {
  for (const cmd of ['python', 'py']) {
    try {
      execFileSync(cmd, ['-c', 'import ' + mods.join(',')], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 })
      return cmd
    } catch (e) { /* 试下一个 */ }
  }
  return null
}

const NEEDS = ['numpy', 'PIL', 'qrcode']
const pyRef = pythonCmdFor(NEEDS)
if (!pyRef) {
  console.log('SKIP  本机无 Python+numpy/qrcode, 跳过第三方比对与解码 (链路 A 已独立覆盖)')
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pilipro-qr-'))
  const cases = [BILI, 'B'.repeat(14), 'B'.repeat(106), 'B'.repeat(213), '哔哩哔哩 · 词典笔搜索', 'emoji 😀 混排']
  const meta = []
  for (let i = 0; i < cases.length; i++) {
    const m = QR.qrcodeMatrix(cases[i])
    meta.push({ text: cases[i], version: m.version, mask: m.mask, size: m.size })
    fs.writeFileSync(path.join(tmp, 'm' + i + '.json'), JSON.stringify({ rows: m.rows }), 'utf8')
  }
  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(meta), 'utf8')

  const pySrc = [
    'import sys, json',
    'import numpy as np',
    'import qrcode',
    'from qrcode.constants import ERROR_CORRECT_M',
    'from qrcode.util import QRData, MODE_8BIT_BYTE',
    'tmp = sys.argv[1]',
    'try:',
    '    from pyzbar.pyzbar import decode as zbdecode',
    '    from PIL import Image',
    '    HAS_ZBAR = True',
    'except Exception:',
    '    HAS_ZBAR = False',
    'try:',
    '    import cv2',
    '    CVDET = cv2.QRCodeDetector()',
    'except Exception:',
    '    CVDET = None',
    '',
    'def render(rows, scale=8, q=4):',
    '    n = len(rows)',
    '    size = (n + q * 2) * scale',
    '    img = np.full((size, size), 255, dtype=np.uint8)',
    '    for r in range(n):',
    '        for c in range(n):',
    '            if rows[r][c]:',
    '                img[(r + q) * scale:(r + q) * scale + scale,',
    '                    (c + q) * scale:(c + q) * scale + scale] = 0',
    '    return img',
    '',
    'meta = json.load(open(tmp + "/meta.json", encoding="utf-8"))',
    'out = {"diff": [], "zbar": [], "cv2": [], "size": []}',
    'for i, mm in enumerate(meta):',
    '    data = QRData(mm["text"].encode("utf-8"), mode=MODE_8BIT_BYTE)',
    '    q = qrcode.QRCode(version=mm["version"], error_correction=ERROR_CORRECT_M,',
    '                      box_size=1, border=0, mask_pattern=mm["mask"])',
    '    q.add_data(data)',
    '    q.make(fit=False)',
    '    ref = [[1 if v else 0 for v in row] for row in q.get_matrix()]',
    '    mine = json.load(open(tmp + "/m%d.json" % i, encoding="utf-8"))["rows"]',
    '    n = len(ref)',
    '    out["size"].append(n)',
    '    out["diff"].append(sum(1 for r in range(n) for c in range(n) if ref[r][c] != mine[r][c]))',
    '    img = render(mine)',
    '    if HAS_ZBAR:',
    '        res = zbdecode(Image.fromarray(img))',
    '        out["zbar"].append(bool(res) and res[0].data.decode("utf-8", "replace") == mm["text"])',
    '    else:',
    '        out["zbar"].append(None)',
    '    if CVDET is not None:',
    '        d, _, _ = CVDET.detectAndDecode(img)',
    '        out["cv2"].append(bool(d))',
    '    else:',
    '        out["cv2"].append(None)',
    'sys.stdout.write(json.dumps(out))'
  ].join('\n')
  const pyPath = path.join(tmp, 'verify.py')
  fs.writeFileSync(pyPath, pySrc, 'utf8')

  let res = null
  try {
    res = JSON.parse(execFileSync(pyRef, [pyPath, tmp], { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 }))
  } catch (e) {
    console.log('SKIP  第三方验证执行失败 (' + (e && e.message ? String(e.message).split('\n')[0] : e) + '), 链路 A 已覆盖')
  }
  if (res) {
    for (let i = 0; i < meta.length; i++) {
      eq(res.size[i], meta[i].size, '参考库矩阵边长一致 (v' + meta[i].version + ')')
      eq(res.diff[i], 0, '与 Python qrcode 库逐模块一致 (v' + meta[i].version + ', mask' + meta[i].mask + ', ' + Buffer.byteLength(meta[i].text, 'utf8') + 'B)')
      if (res.zbar[i] !== null) eq(res.zbar[i], true, 'zbar 真实解码成功 (' + Buffer.byteLength(meta[i].text, 'utf8') + 'B)')
    }
    const zbarN = res.zbar.filter((x) => x === true).length
    const cv2N = res.cv2.filter((x) => x === true).length
    if (zbarN === 0 && res.zbar.every((x) => x === null)) console.log('SKIP  本机没有 pyzbar, 只做了参考库逐模块比对')
    else console.log('第三方验证: 逐模块 0 差异 / zbar 解出 ' + zbarN + '/' + meta.length + ' / cv2 解出 ' + cv2N + '/' + meta.length)
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

console.log('CHECK-QRCODE PASSED (' + pass + ' 条断言: BCH 标准向量 / 容量表 / 结构 / 独立逆推解码 / 213 字节上限 / 第三方比对)')
