// 纯 JS 二维码编码器 (Byte 模式 / 纠错级 M / 版本 1-10) —— QuickJS 兼容, 无第三方依赖
//
// 为什么要自己写: 笔上没有 canvas, 也没有可用的二维码库; B 站扫码登录必须把二维码
// 画在笔屏上, 只能本地编码, 再把 0/1 矩阵交给 <div> 渲染.
//
// 实现依据 ISO/IEC 18004 (2006):
//   §8.4  功能图形: 寻像图形 + 分隔符 + 时序图形 + 校正图形 + 恒暗模块
//   §8.5  Reed-Solomon 纠错 (GF(256), 本原多项式 0x11d)
//   §8.9  数据掩码: 8 种掩码, 按 N1/N2/N3/N4 惩罚分取最优
//   §8.10 格式信息: BCH(15,5), 生成多项式 0x537, 与 0x5412 异或; 纠错级 M = 00
//   §8.11 版本信息 (版本 >= 7): BCH(18,6), 生成多项式 0x1F25
//
// 容量 (M 级, Byte 模式) 1..10 版分别为: 14/26/42/62/84/106/122/152/180/213 字节.
// 实测 B 站扫码登录 url 为 131 字节 -> 版本 8 (49x49), 这是渲染端要按 49 模块布局的原因.
//
// 导出:
//   qrcodeMatrix(text) -> { size, rows, version, mask }   rows[r][c] = 0/1 (1 = 暗)
//   byteCapacity(version) / maxCapacity()                 容量查询 (页面选版用)
//   formatBits / versionBits                              标准测试向量用 (离线门禁断言)

/** 版本参数表 (纠错级 M): 版本 -> [总码字数, 每块纠错码字数, [数据码字数, 块数], [数据码字数, 块数] | null] */
const EC_M = {
  1: [26, 10, [16, 1], null],
  2: [44, 16, [28, 1], null],
  3: [70, 26, [44, 1], null],
  4: [100, 18, [32, 2], null],
  5: [134, 24, [43, 2], null],
  6: [172, 16, [27, 4], null],
  7: [196, 18, [31, 4], null],
  8: [242, 22, [38, 2], [39, 2]],
  9: [292, 22, [36, 3], [37, 2]],
  10: [346, 26, [43, 4], [44, 1]]
}

/** 校正图形中心坐标 (ISO/IEC 18004 附录 E): 版本 -> 全部候选中心 */
const ALIGN = [null, [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

export const MAX_VERSION = 10

/** 某版本在 M 级 Byte 模式下的字节容量 (含 4bit 模式 + 8/16bit 计数开销) */
export function byteCapacity(version) {
  const t = EC_M[version]
  if (!t) return 0
  const g1 = t[2]
  const g2 = t[3]
  const dataCw = g1[0] * g1[1] + (g2 ? g2[0] * g2[1] : 0)
  const countBits = version <= 9 ? 8 : 16
  return Math.floor((dataCw * 8 - 4 - countBits) / 8)
}

export function maxCapacity() { return byteCapacity(MAX_VERSION) }

// ---------------- GF(256) ----------------
const EXP = new Array(256)
const LOG = new Array(256)
;(function () {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x = x << 1
    if (x >= 256) x ^= 0x11d
  }
  EXP[255] = EXP[0]
})()

function gmul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[(LOG[a] + LOG[b]) % 255]
}

/**
 * RS 纠错码字. 生成多项式 g(x) = ∏(x - α^i) (i = 0..ecCount-1), 系数最高次在前:
 * gen[0] = 1 (x^ecCount 的系数), gen[ecCount] = 常数项. 多项式除法取余.
 */
function rsEc(data, ecCount) {
  let gen = [1]
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(gen.length + 1)
    for (let j = 0; j < next.length; j++) next[j] = 0
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]                 // gen[j] * x
      next[j + 1] ^= gmul(gen[j], EXP[i]) // gen[j] * α^i
    }
    gen = next
  }
  const rem = new Array(ecCount)
  for (let i = 0; i < ecCount; i++) rem[i] = 0
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0]
    rem.shift()
    rem.push(0)
    if (factor !== 0) for (let j = 0; j < ecCount; j++) rem[j] ^= gmul(gen[j + 1], factor)
  }
  return rem
}

// ---------------- 格式信息 / 版本信息 (标准 BCH) ----------------

/** 格式信息 BCH(15,5): 入参 5 位 = 纠错级(2) + 掩码(3); 纠错级 M = 00 */
export function formatBits(ecBits, mask) {
  const data = ((ecBits & 0x3) << 3) | (mask & 0x7)
  let rem = data << 10
  const G = 0x537
  for (let i = 14; i >= 10; i--) if (((rem >>> i) & 1) === 1) rem ^= G << (i - 10)
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412
}

/** 版本信息 BCH(18,6) (版本 >= 7 才有) */
export function versionBits(version) {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25)
  return ((version << 12) | (rem & 0xfff)) & 0x3ffff
}

// ---------------- 掩码 ----------------
function maskFn(pattern, r, c) {
  switch (pattern) {
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

// ---------------- 惩罚分 (ISO/IEC 18004 §8.9.2) ----------------
const P3A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
const P3B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]

function runPenalty(seq) {
  let p = 0
  let run = 1
  for (let i = 1; i <= seq.length; i++) {
    if (i < seq.length && seq[i] === seq[i - 1]) run++
    else {
      if (run >= 5) p += 3 + (run - 5)
      run = 1
    }
  }
  return p
}

function patternPenalty(seq) {
  let p = 0
  for (let i = 0; i + 11 <= seq.length; i++) {
    let a = true
    let b = true
    for (let k = 0; k < 11; k++) {
      if (seq[i + k] !== P3A[k]) a = false
      if (seq[i + k] !== P3B[k]) b = false
    }
    if (a) p += 40
    if (b) p += 40
  }
  return p
}

function penalty(m, size) {
  let total = 0
  const row = new Array(size)
  const col = new Array(size)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) row[c] = m[r][c]
    total += runPenalty(row) + patternPenalty(row)
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) col[r] = m[r][c]
    total += runPenalty(col) + patternPenalty(col)
  }
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c] === 1) dark++
  // N2: 2x2 同色块
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c]
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) total += 3
    }
  }
  // N4: 暗模块占比偏离 50% (按 5% 档取整后 x2)
  const percent = (dark * 100) / (size * size)
  total += Math.abs(Math.floor(percent / 5) * 5 - 50) * 2
  return total
}

// ---------------- 功能图形 ----------------
function drawFinder(m, funcs, size, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r
      const cc = col + c
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
      funcs[rr][cc] = true
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6
      m[rr][cc] = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0
    }
  }
}

/** 功能图形 + 保留区 (格式信息/版本信息位置预先占位, 数据放置时跳过) */
function buildFunctionPatterns(size, version) {
  const m = []
  const funcs = []
  for (let r = 0; r < size; r++) {
    const row = new Array(size)
    const f = new Array(size)
    for (let c = 0; c < size; c++) { row[c] = 0; f[c] = false }
    m.push(row)
    funcs.push(f)
  }
  drawFinder(m, funcs, size, 0, 0)
  drawFinder(m, funcs, size, size - 7, 0)
  drawFinder(m, funcs, size, 0, size - 7)

  // 时序图形
  for (let i = 8; i < size - 8; i++) {
    funcs[6][i] = true
    m[6][i] = i % 2 === 0 ? 1 : 0
    funcs[i][6] = true
    m[i][6] = i % 2 === 0 ? 1 : 0
  }

  // 校正图形 (必须全部画出; 与寻像图形重叠的角落跳过)
  const centers = version >= 2 && version <= MAX_VERSION ? ALIGN[version - 1] : null
  if (centers) {
    for (let ai = 0; ai < centers.length; ai++) {
      for (let aj = 0; aj < centers.length; aj++) {
        const ar = centers[ai]
        const ac = centers[aj]
        if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            funcs[ar + r][ac + c] = true
            m[ar + r][ac + c] = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0) ? 1 : 0
          }
        }
      }
    }
  }

  // 恒暗模块
  funcs[size - 8][8] = true
  m[size - 8][8] = 1

  // 格式信息占位 (两份)
  const fp = formatPositions(size)
  for (let i = 0; i < fp.length; i++) {
    funcs[fp[i][0]][fp[i][1]] = true
    m[fp[i][0]][fp[i][1]] = 0
  }
  // 版本信息占位 (版本 >= 7)
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      funcs[b][a] = true
      m[b][a] = 0
      funcs[a][b] = true
      m[a][b] = 0
    }
  }
  return { m: m, funcs: funcs }
}

/** 格式信息的 15 个单元坐标 (两份共 30 个位置) */
function formatPositions(size) {
  const out = []
  // 第一份: 左上寻像图形两侧的 L 形
  for (let i = 0; i <= 5; i++) out.push([i, 8])
  out.push([7, 8])
  out.push([8, 8])
  out.push([8, 7])
  for (let i = 9; i < 15; i++) out.push([8, 14 - i])
  // 第二份: 右上横条 + 左下竖条
  for (let i = 0; i < 8; i++) out.push([8, size - 1 - i])
  for (let i = 8; i < 15; i++) out.push([size - 15 + i, 8])
  return out
}

/** 位序: bit i (LSB = 0) 按标准写进两个副本 */
function drawFormat(m, size, mask) {
  const bits = formatBits(0, mask)   // 纠错级 M = 00
  const get = function (i) { return ((bits >>> i) & 1) === 1 ? 1 : 0 }
  for (let i = 0; i <= 5; i++) m[i][8] = get(i)
  m[7][8] = get(6)
  m[8][8] = get(7)
  m[8][7] = get(8)
  for (let i = 9; i < 15; i++) m[8][14 - i] = get(i)
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = get(i)
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = get(i)
  m[size - 8][8] = 1   // 恒暗模块
}

function drawVersionInfo(m, size, version) {
  const bits = versionBits(version)
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) === 1 ? 1 : 0
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    m[b][a] = bit
    m[a][b] = bit
  }
}

/** 数据单元坐标表 (zigzag 自右下角向左上, 跳过第 6 列与全部功能图形) */
function dataCells(size, funcs) {
  const cells = []
  let inc = -1
  let row = size - 1
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5
    while (true) {
      for (let j = 0; j < 2; j++) {
        const cc = col - j
        if (!funcs[row][cc]) cells.push([row, cc])
      }
      row += inc
      if (row < 0 || row >= size) {
        row -= inc
        inc = -inc
        break
      }
    }
  }
  return cells
}

// ---------------- 余数位 (remainder bits) ----------------
// QR 标准: 数据区模块数不总是 8 的整数倍, 每个版本有固定的余数位 (填 0):
//   v1: 0, v2-v6: 7, v7-v13: 0, v14-v20: 3, v21-v27: 4, v28-v34: 3, v35-v40: 0
// 之前这里断言"可放置单元数 == 码字位数", 对 v2-v6 会必然失败 —— 不是实现错, 是漏了这张表.
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0]

function remainderBits(version) {
  return REMAINDER_BITS[version] == null ? 0 : REMAINDER_BITS[version]
}

// ---------------- 码字编排 ----------------
function pushBits(arr, val, len) {
  for (let i = len - 1; i >= 0; i--) arr.push((val >>> i) & 1)
}

/** Byte 模式编码 + 分块 RS + 交织 -> 最终码字序列 */
function encodeCodewords(bytes, version) {
  const t = EC_M[version]
  const g1 = t[2]
  const g2 = t[3]
  const ecCount = t[1]
  const blocks = []
  for (let i = 0; i < g1[1]; i++) blocks.push({ len: g1[0], data: null, ec: null })
  if (g2) for (let i = 0; i < g2[1]; i++) blocks.push({ len: g2[0], data: null, ec: null })
  let dataCwTotal = 0
  for (let i = 0; i < blocks.length; i++) dataCwTotal += blocks[i].len

  const bits = []
  pushBits(bits, 4, 4)                                   // 模式: Byte
  pushBits(bits, bytes.length, version <= 9 ? 8 : 16)    // 字符计数
  for (let i = 0; i < bytes.length; i++) pushBits(bits, bytes[i], 8)
  const capBits = dataCwTotal * 8
  const term = Math.min(4, capBits - bits.length)
  if (term > 0) pushBits(bits, 0, term)
  while (bits.length % 8 !== 0) bits.push(0)
  const PAD = [0xec, 0x11]
  for (let i = 0; bits.length < capBits; i++) pushBits(bits, PAD[i % 2], 8)

  const dataCw = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    dataCw.push(b)
  }

  let pos = 0
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].data = dataCw.slice(pos, pos + blocks[i].len)
    pos += blocks[i].len
    blocks[i].ec = rsEc(blocks[i].data, ecCount)
  }

  const out = []
  let maxLen = g1[0]
  if (g2 && g2[0] > maxLen) maxLen = g2[0]
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < blocks.length; b++) if (i < blocks[b].data.length) out.push(blocks[b].data[i])
  }
  for (let i = 0; i < ecCount; i++) {
    for (let b = 0; b < blocks.length; b++) out.push(blocks[b].ec[i])
  }
  return out
}

function bytesToBits(cw) {
  const out = []
  for (let i = 0; i < cw.length; i++) pushBits(out, cw[i], 8)
  return out
}

// ---------------- UTF-8 ----------------
function toUtf8(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
        i++
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return out
}

/**
 * 生成二维码矩阵.
 * @param {string} text 内容 (UTF-8, 上限 maxCapacity() 字节)
 * @returns {{ size: number, rows: Array<Array<number>>, version: number, mask: number }}
 *          rows[r][c] = 0/1 (1 = 暗模块)
 */
export function qrcodeMatrix(text) {
  const bytes = toUtf8(String(text == null ? '' : text))
  let version = 0
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (bytes.length <= byteCapacity(v)) { version = v; break }
  }
  if (version === 0) {
    throw new Error('内容过长: ' + bytes.length + ' 字节, M 级第 ' + MAX_VERSION + ' 版上限 ' + maxCapacity() + ' 字节')
  }

  const size = version * 4 + 17
  const cw = encodeCodewords(bytes, version)
  const base = buildFunctionPatterns(size, version)
  const cells = dataCells(size, base.funcs)
  const dataBits = cw.length * 8
  const rest = remainderBits(version)
  if (cells.length !== dataBits + rest) {
    throw new Error('内部错误: 可放置单元 ' + cells.length + ' != 码字位 ' + dataBits + ' + 余数位 ' + rest)
  }
  // 余数位按标准填 0, 一起参与掩码与惩罚计算
  const bits = bytesToBits(cw)
  for (let i = 0; i < rest; i++) bits.push(0)

  let bestRows = null
  let bestMask = 0
  let bestPen = -1
  for (let mask = 0; mask < 8; mask++) {
    const m = []
    for (let r = 0; r < size; r++) m.push(base.m[r].slice())
    drawFormat(m, size, mask)
    if (version >= 7) drawVersionInfo(m, size, version)
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i][0]
      const c = cells[i][1]
      let dark = bits[i] === 1
      if (maskFn(mask, r, c)) dark = !dark
      m[r][c] = dark ? 1 : 0
    }
    const p = penalty(m, size)
    if (bestRows === null || p < bestPen) {
      bestRows = m
      bestMask = mask
      bestPen = p
    }
  }

  return { size: size, rows: bestRows, version: version, mask: bestMask }
}

export default qrcodeMatrix
