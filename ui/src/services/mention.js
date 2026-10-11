// @ 提及 (mention) 的统一处理 —— 动态评论 / 视频评论 / 楼中楼共用一套语义.
//
// 为什么需要单独一层 (而不是各页面各写一遍):
//   B 站的"回复某人"在**协议上**是"正文以 @昵称 + 空格 开头": 只有带了它, 被回复的人才会
//   收到 @ 通知, 楼中楼顶部也会显示「回复 @某人：」. 以前三个页面各写各的, 楼中楼发送时
//   根本没带前缀 —— 回复发出去了但对方收不到通知, 这就是"@ 功能要适配"的实质.
//
// 渲染侧: 正文里的 @昵称 要高亮成主题色 (与 .dhl/.phl 同一套做法).
// ★ 本机限制: richtext 内部的元素**点不动** (@click 不触发, 已多次实测), 所以 @昵称 只能
//   做视觉高亮, 做不了"点了进对方主页"; 要可点就得把整段正文拆成一串独立元素, 那会破坏
//   本机的中文换行排版. 这是刻意的取舍, 不是漏做.

// 提及名允许的字符: 中文/字母/数字/下划线/连字符; 20 字以内 (B 站昵称上限 20)
// 结尾常见标点要剥掉 (「@小明，你好」里的逗号不属于昵称)
// ★ 昵称字符集里**直接排除标点**: 只排除空白是不够的 —— 「@小明，你看」会被整段当成昵称
//   (门禁第一版就是这么红的). B 站昵称可以是中文/字母/数字/下划线/连字符, 但不会含句读.
var MENTION_RE = /@([^\s@#,.!?:;'"()\[\]{}<>，。！？、：；‘’“”（）【】《》…—~]{1,20})/g
var TRAIL = /[，。！？、：；,.!?:;]+$/

/** 昵称 -> 「@昵称 」(B 站语义: 后面跟一个空格) */
export function mentionPrefix(name) {
  const n = String(name == null ? '' : name).trim()
  return n === '' ? '' : ('@' + n + ' ')
}

/**
 * 把待发送的正文补上 @ 前缀 (已经以同一个 @ 开头就不重复加).
 * @param {string} text 用户输入
 * @param {string} name 被回复人昵称 (空 = 回复主楼, 不加前缀)
 */
export function applyMention(text, name) {
  const t = String(text == null ? '' : text)
  const n = String(name == null ? '' : name).trim()
  if (n === '') return t                                 // 回复主楼: 不加前缀
  const at = '@' + n
  if (t.indexOf(at) === 0) {
    const rest = t.slice(at.length)
    if (rest === '' || /^\s/.test(rest)) return t        // 已经带了 @昵称(空格/结尾), 不重复加
  }
  return at + ' ' + t
}

/** 正文里是否整段就是「回复 @某人」这类 (给输入框提示用) */
export function stripMention(text, name) {
  const t = String(text == null ? '' : text)
  const p = mentionPrefix(name)
  return (p !== '' && t.indexOf(p) === 0) ? t.slice(p.length) : t
}

/**
 * 把 parseMessage 产出的 segs 再切一层: 纯文本段里的 @昵称 变成 t=3 的提及段.
 * 输入/输出段约定 (与 services/bili.js 的 parseMessage 一致):
 *   t=0 纯文本 · t=1 emoji 图片 · t=2 高亮 (话题/表情文字) · t=3 提及 (@昵称)
 * @param {Array} segs
 * @returns {Array} 新的段数组 (不修改入参)
 */
export function splitMentionSegs(segs) {
  const src = segs || []
  const out = []
  for (let i = 0; i < src.length; i++) {
    const s = src[i]
    if (!s || s.t !== 0 || typeof s.v !== 'string' || s.v.indexOf('@') < 0) { out.push(s); continue }
    const text = s.v
    let last = 0
    MENTION_RE.lastIndex = 0
    let m
    while ((m = MENTION_RE.exec(text))) {
      let name = m[1]
      // 末尾标点不属于昵称 -> 缩回去 (避免「@小明，」整体染色)
      const tr = TRAIL.exec(name)
      if (tr) name = name.slice(0, name.length - tr[0].length)
      if (name === '') continue
      const at = m.index
      if (at > last) out.push({ t: 0, v: text.slice(last, at) })
      out.push({ t: 3, v: '@' + name })
      last = at + 1 + name.length
      MENTION_RE.lastIndex = last
    }
    if (last === 0) { out.push(s); continue }
    if (last < text.length) out.push({ t: 0, v: text.slice(last) })
  }
  return out
}
