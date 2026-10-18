// BV / av 号识别与互转 (PiliNara 的两个消费点: 评论区点号跳转 / 搜索框直接进视频)
//
// 用户明确收窄了范围: **不做**分享到其它应用、**不做** b23 短链展开.
// 这里只保留"文本里认出视频号"和"BV<->av 换算"这两件事, 因为它们是评论区跳转与搜索直达的地基.
//
// ★ 算法用的是**现行版** (2023 起 B 站换过一轮; 旧版 fZodR9.../177451812 对近年稿件会算错,
//   那正是"点开跳到别的视频"的成因). 来源: bilibili-API-collect docs/misc/bvid_desc.md
//   码表 FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf
//   编码: tmp = ((2^51 | aid) ^ 23442827791579), 逐位取模 58 -> 9 字符, 写完 swap(3,9)/swap(4,7)
//   解码: 逆 swap -> 去 BV1 -> 58 进制累积 -> & (2^51-1) -> ^ 23442827791579
//
// ★ 为什么不用位运算符直接算: 本机 QuickJS 20200705 只有 32 位整数语义, x & y / x ^ y 在
//   |x| >= 2^31 时先把操作数截断成 int32, 结果整个错误; 而 51 位量 (2^51 ≈ 2.25e15) 远超 int32.
//   所以这里把"与/异或"拆成低 26 位 + 高 26 位两块, 每块都是 32 位安全的小整数, 再拼回来.
//   所有中间量 < 58^9 ≈ 7.4e15 < 2^53, Number 全程精确, 不需要 BigInt.
//
// 已用 B 站在线接口核实过的对照 (av 号来自 x/web-interface/view 的 data.aid):
//   av170001          <-> BV17x411w7KC
//   av111298867365120 <-> BV1L9Uoa9EUx
//   av1004871019      <-> BV16x4y1H7M1
//   av1906473802      <-> BV1MU411S7iJ
const TABLE = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'
const MASK51 = 2251799813685247    // 2^51 - 1
const MAX_AID = 2251799813685248   // 2^51
const XOR = 23442827791579
const LO = 67108864                // 2^26

// 码表反查 (字符 -> 下标), 只算一次
const REV = {}
for (let i = 0; i < TABLE.length; i++) REV[TABLE.charAt(i)] = i

// 51 位安全异或/与: a,b < 2^51 (实际 < 2^52), 拆两半各 26 位, 半与半不重叠进位
function bxor(a, b) {
  const ah = Math.floor(a / LO), al = a % LO
  const bh = Math.floor(b / LO), bl = b % LO
  return ((ah ^ bh) * LO) + (al ^ bl)
}
function band(a, b) {
  const ah = Math.floor(a / LO), al = a % LO
  const bh = Math.floor(b / LO), bl = b % LO
  return ((ah & bh) * LO) + (al & bl)
}

/** BV 号 -> 数字 av 号; 非法输入返回 0 */
export function bvToAv(bv) {
  if (typeof bv !== 'string') return 0
  const s = bv.trim()
  if (s.length !== 12 || s.substring(0, 3) !== 'BV1') return 0
  const a = s.split('')
  const t1 = a[3]; a[3] = a[9]; a[9] = t1   // 逆 swap(3,9)
  const t2 = a[4]; a[4] = a[7]; a[7] = t2   // 逆 swap(4,7)
  let tmp = 0
  // ★ 只拒"码表外字符"(0/I/O/l 不在表里). 现行编码是全空间双射: 任何 12 位合法字符组合
  //   都对应一个真实存在的 av 号, 不存在"形似但不合法" —— 所以把大小写写错 (bv1...) 不会报错,
  //   而是**解出另一个合法号**, 用户看到的就是"点开跳到别的视频". 这正是 findVideoIds /
  //   normalizeQuery 只认标准 'BV1' 前缀的原因.
  for (let i = 3; i < 12; i++) {
    const idx = REV[a[i]]
    if (idx === undefined) return 0
    tmp = tmp * 58 + idx
  }
  const av = bxor(band(tmp, MASK51), XOR)
  return av > 0 ? av : 0
}

/**
 * 数字 av 号 -> BV 号; 非法输入返回 ''.
 * 容忍三种写法: 170001 / '170001' / 'av170001' (大小写不限) —— 用户从各处粘来的形态不定,
 * 但小数 (1.5) 一律拒掉: 没有 av1.5.
 */
export function avToBv(av) {
  let raw = av
  if (typeof raw === 'string') raw = raw.trim().replace(/^[aA][vV]/, '')
  const n0 = Number(raw)
  if (typeof raw === 'string' && raw !== '' && !/^\d+$/.test(raw)) return ''
  if (!isFinite(n0) || n0 <= 0 || n0 !== Math.floor(n0)) return ''
  const n = n0
  if (n > MASK51) return ''
  // (2^51 | aid): aid < 2^51 时等于 2^51 + aid (无进位, 纯加法)
  let tmp = bxor(MAX_AID + n, XOR)
  const b = ['B', 'V', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0']
  let i = 11
  while (tmp > 0) {
    if (i < 3) return ''
    b[i] = TABLE.charAt(tmp % 58)
    tmp = Math.floor(tmp / 58)
    i--
  }
  const s3 = b[3]; b[3] = b[9]; b[9] = s3
  const s4 = b[4]; b[4] = b[7]; b[7] = s4
  return b.join('')
}

/**
 * 从任意文本里找出所有视频号.
 * 返回 [{ kind: 'bv'|'av', id, bvid, index, length }]
 * 规则:
 *   - BV 必须 12 位且以 BV1 开头, 且必须真的能换算 (码表外字符不算, 避免 BV1abcdefgh 误报)
 *   - av 必须独立成词 ("have 170001" 不算, "av170001" 才算); 纯数字一律不当视频号
 */
export function findVideoIds(text) {
  const out = []
  const s = String(text == null ? '' : text)
  // 只认标准 'BV1' 前缀 (后 9 位区分大小写, 小写会解到别的号)
  const reBv = /BV1[0-9A-Za-z]{9}/g
  let m
  while ((m = reBv.exec(s)) !== null) {
    const raw = m[0]
    if (!bvToAv(raw)) continue
    out.push({ kind: 'bv', id: raw, bvid: raw, index: m.index, length: raw.length })
  }
  const reAv = /(^|[^0-9A-Za-z])[aA][vV](\d{1,15})(?![0-9A-Za-z])/g
  while ((m = reAv.exec(s)) !== null) {
    const pre = m[1] || ''
    const digits = m[2]
    const bvid = avToBv(digits)
    if (!bvid) continue
    out.push({ kind: 'av', id: Number(digits), bvid: bvid, index: m.index + pre.length, length: 2 + digits.length })
  }
  out.sort(function (a, b) { return a.index - b.index })
  return out
}

/** 把文本切成片段: 普通文本 / 视频号 (页面渲染"可点视频号"用) */
export function splitByVideoIds(text) {
  const s = String(text == null ? '' : text)
  const ids = findVideoIds(s)
  if (!ids.length) return s ? [{ text: s, kind: null }] : []
  const out = []
  let pos = 0
  for (let i = 0; i < ids.length; i++) {
    const it = ids[i]
    if (it.index > pos) out.push({ text: s.substring(pos, it.index), kind: null })
    out.push({ text: s.substring(it.index, it.index + it.length), kind: it.kind, bvid: it.bvid })
    pos = it.index + it.length
  }
  if (pos < s.length) out.push({ text: s.substring(pos), kind: null })
  return out
}

/**
 * 搜索框输入规整:
 *   输入本身就是 BV/av 号 -> { kind: 'video', bvid }  (直接进详情)
 *   其它                  -> { kind: 'search', keyword }
 */
export function normalizeQuery(text) {
  const s = String(text == null ? '' : text).trim()
  if (!s) return { kind: 'search', keyword: '' }
  // 只认标准 'BV1' 前缀: 后 9 位区分大小写, 小写粘贴 (bv17x411w7kc) 会解出**另一个号**,
  // 拿它跳转会打开错的视频 —— 宁可当关键词搜, 也不猜.
  if (/^BV1[0-9A-Za-z]{9}$/.test(s)) {
    if (bvToAv(s)) return { kind: 'video', bvid: s }
  }
  const m = /^[aA][vV](\d{1,15})$/.exec(s)
  if (m) {
    const bvid = avToBv(m[1])
    if (bvid) return { kind: 'video', bvid: bvid }
  }
  return { kind: 'search', keyword: s }
}
