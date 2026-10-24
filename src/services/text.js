// 文本切分 —— 把一段文字拆成"文字段"与"表情段"
//
// 为什么必须切: 设备系统字体**没有任何 emoji 字形** (实测 HarmonyOS_Sans_SC / NotoSansSC /
// Alibaba-PuHuiTi / STXihei 全部缺 emoji; 只有 falcon-icons 图标字体), 也没有 emoji 字体文件.
// 直接渲染 emoji 会出豆腐块或空白. 所以 emoji 必须换成 <image> 显示.
//
// 两类表情都要支持:
//   1. Unicode emoji (😀👍❤️⭐ ...) —— 用内置的本地 PNG (assets/emoji, 零联网生成)
//   2. B 站表情代码 ([大笑] [笑哭] ...) —— 用 B 站表情图 (用户明确允许这一类联网)
//
// 本模块是**纯逻辑** (不 require 任何图片), 因此可以在 Node 门禁里直接单测.

// ---------------- Unicode emoji 判定 ----------------

/** 单码位是否属于 emoji 区段 */
export function isEmojiCp(cp) {
  if (!isFinite(cp) || cp < 0) return false
  // 常见 emoji 区段 (覆盖 Unicode 13 的 Emoji_Presentation 大部分)
  return (cp >= 0x1f000 && cp <= 0x1faff) ||   // 主要 emoji 块 (含补充符号)
    (cp >= 0x1f300 && cp <= 0x1f5ff) ||
    (cp >= 0x1f600 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||           // 杂项符号 + 装饰符号
    (cp >= 0x2b00 && cp <= 0x2bff) ||           // 箭头/星形
    (cp >= 0x2190 && cp <= 0x21ff) ||           // 箭头 (设备字体缺, 走图片)
    (cp >= 0x2900 && cp <= 0x297f) ||
    (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||         // 区域指示符 (国旗)
    cp === 0x2764 || cp === 0x2763 || cp === 0x2b50 || cp === 0x2b55 ||
    cp === 0x203c || cp === 0x2049 || cp === 0x2122 || cp === 0x2139 ||
    cp === 0x3030 || cp === 0x303d || cp === 0x00a9 || cp === 0x00ae ||
    (cp >= 0x24c2 && cp <= 0x24c2) ||
    (cp >= 0x25aa && cp <= 0x25fe) ||           // 几何图形 (部分设备字体有, 但走图片更稳)
    (cp >= 0x1f170 && cp <= 0x1f19a) ||
    (cp >= 0x1f200 && cp <= 0x1f251)
}

/** 是否变体选择符 (FE0F 表示"用彩色 emoji 形态") */
export function isVS(cp) { return cp === 0xfe0f || cp === 0xfe0e }

/** 肤色修饰符 */
export function isSkinTone(cp) { return cp >= 0x1f3fb && cp <= 0x1f3ff }

/** 是否零宽连接符 (ZWJ) */
export function isZWJ(cp) { return cp === 0x200d }

/** 区域指示符 (国旗由两个组成) */
export function isRegional(cp) { return cp >= 0x1f1e6 && cp <= 0x1f1ff }

/** 键帽 (数字 + FE0F + 20E3) */
export function isKeycap(cp) { return cp === 0x20e3 }

/** 键帽的基字符: 0-9 / # / * (它们本身不是 emoji 区段) */
export function isKeycapBase(cp) {
  return (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a
}

/**
 * 从 text[i] 起读一个完整 emoji 序列 (含 ZWJ 组合 / 肤色 / 国旗 / 键帽).
 * @returns {{end:number, cps:number[]}} end 为序列结束后的下标; 不是 emoji 时 cps 为空
 */
export function readEmoji(text, i) {
  const n = text.length
  if (i >= n) return { end: i, cps: [] }
  let cp = text.charCodeAt(i)
  // 代理对
  if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < n) {
    const lo = text.charCodeAt(i + 1)
    if (lo >= 0xdc00 && lo <= 0xdfff) cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00)
  }
  // 键帽特例: 起始是 0-9 / # / *, 后面跟 FE0F? 与 20E3 —— 这些起始码位本身不是 emoji
  if (!isEmojiCp(cp) && !isRegional(cp) && !isKeycapBase(cp)) return { end: i, cps: [] }

  const cps = []
  let j = i
  const push = (code) => { cps.push(code) }
  const readAt = (k) => {
    let c = text.charCodeAt(k)
    if (c >= 0xd800 && c <= 0xdbff && k + 1 < n) {
      const lo = text.charCodeAt(k + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) return { cp: 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00), len: 2 }
    }
    return { cp: c, len: 1 }
  }

  // 第一段: 区域指示符成对 (国旗)
  if (isRegional(cp)) {
    const r1 = readAt(j); push(r1.cp); j += r1.len
    const r2 = j < n ? readAt(j) : null
    if (r2 && isRegional(r2.cp)) { push(r2.cp); j += r2.len }
    return { end: j, cps }
  }

  const first = readAt(j)
  push(first.cp); j += first.len

  // 键帽: 基字符 + FE0F? + 20E3
  if (isKeycapBase(first.cp)) {
    let k = j
    if (k < n) {
      const v = readAt(k)
      if (isVS(v.cp)) k += v.len
    }
    if (k < n) {
      const kc = readAt(k)
      if (isKeycap(kc.cp)) {
        if (k > j) { const vv = readAt(j); push(vv.cp) }
        push(kc.cp)
        return { end: k + kc.len, cps: cps }
      }
    }
    // 不是键帽: 回退成普通字符
    return { end: i, cps: [] }
  }

  // 键帽: 数字/井号/星号 + FE0F? + 20E3
  if (j < n) {
    const nx = readAt(j)
    if (isVS(nx.cp)) { push(nx.cp); j += nx.len }
    const nx2 = j < n ? readAt(j) : null
    if (nx2 && isKeycap(nx2.cp)) { push(nx2.cp); j += nx2.len; return { end: j, cps } }
  }

  // 循环: 变体选择符 / 肤色 / ZWJ 连接的下一个 emoji
  while (j < n) {
    const cur = readAt(j)
    if (isVS(cur.cp)) { push(cur.cp); j += cur.len; continue }
    if (isSkinTone(cur.cp)) { push(cur.cp); j += cur.len; continue }
    if (isZWJ(cur.cp)) {
      const nxt = j + 1 < n ? readAt(j + 1) : null
      if (nxt && (isEmojiCp(nxt.cp) || isRegional(nxt.cp))) {
        push(cur.cp); j += cur.len
        push(nxt.cp); j += nxt.len
        continue
      }
    }
    break
  }
  return { end: j, cps }
}

/** 码位数组 -> 素材文件名键 (与 assets/emoji/index.json 一致, 去掉 FE0F) */
export function emojiKey(cps) {
  const out = []
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] === 0xfe0f) continue     // 变体选择符不参与命名
    out.push(cps[i].toString(16).toUpperCase().padStart(4, '0'))
  }
  return out.join('-')
}

// ---------------- B 站表情代码 ----------------

/** 匹配 [xxx] 形式的 B 站表情 (限制长度, 避免把 [1] 这种当表情) */
export const BILI_RE = /^\[([^\[\]\s]{1,10})\]/

// ---------------- 切分 ----------------

/**
 * 切分文本.
 * @param {string} text
 * @param {Object} [opts]
 *   opts.biliEmoji: { 名称: 图片URL } —— 命中则产出 { t:'bili', v:名称, url }
 *   opts.keepUnknownEmoji: 未知 unicode emoji 是否保留为文字 (默认 false, 直接丢弃避免豆腐块)
 * @returns {Array<{t:'text'|'emoji'|'bili', v:string, key?:string, url?:string}>}
 */
export function segment(text, opts) {
  const o = opts || {}
  const bili = o.biliEmoji || null
  const keepUnknown = !!o.keepUnknownEmoji
  const s = String(text == null ? '' : text)
  const out = []
  let buf = ''
  const flushText = () => {
    if (buf) { out.push({ t: 'text', v: buf }); buf = '' }
  }
  let i = 0
  while (i < s.length) {
    const ch = s.charAt(i)
    // 1) B 站表情代码
    if (ch === '[') {
      const m = BILI_RE.exec(s.slice(i))
      if (m) {
        const name = m[1]
        const url = bili && bili[name]
        if (url) {
          flushText()
          out.push({ t: 'bili', v: name, url: url })
          i += m[0].length
          continue
        }
      }
    }
    // 2) Unicode emoji
    const cp = s.charCodeAt(i)
    const isHigh = cp >= 0xd800 && cp <= 0xdbff
    // 键帽的起始字符 (0-9/#/*) 本身不是 emoji, 但后面可能跟 FE0F+20E3, 所以也要尝试
    const maybeKeycap = (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a
    if (isHigh || isEmojiCp(cp) || maybeKeycap) {
      const r = readEmoji(s, i)
      if (r.cps.length) {
        const key = emojiKey(r.cps)
        flushText()
        if (keepUnknown) out.push({ t: 'emoji', v: s.slice(i, r.end), key: key })
        else out.push({ t: 'emoji', v: s.slice(i, r.end), key: key })
        i = r.end
        continue
      }
    }
    buf += ch
    i++
  }
  flushText()
  return out
}

/** 纯文本化: 去掉 emoji / B 站表情代码, 用于标题栏等不能放图片的地方 */
export function plain(text) {
  const segs = segment(text, { keepUnknownEmoji: false })
  let out = ''
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].t === 'text') out += segs[i].v
    else if (segs[i].t === 'bili') out += segs[i].v
  }
  return out
}

/** 估算显示宽度: 中文/emoji 算 1, 半角算 0.5 (弹幕泳道与省略号用) */
export function width(text) {
  const segs = segment(text)
  let w = 0
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s.t !== 'text') { w += 1; continue }
    for (let j = 0; j < s.v.length; j++) {
      const c = s.v.charCodeAt(j)
      w += (c < 0x80) ? 0.5 : 1
    }
  }
  return w
}
