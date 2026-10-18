// 字幕 (subtitle): B 站 CC 字幕 JSON / WebVTT / SRT 的解析、选取、偏移与导出
//
// 为什么要有单独一层 (而不是各页面各写一遍):
//   B 站把字幕拆成两条互不相干的东西 ——
//     1) 字幕**列表**跟着播放器接口下发 (x/player/wbi/v2 的 data.subtitle.subtitles),
//        只有 {id, lan, lan_doc, subtitle_url, ai_type}, 没有正文;
//     2) 字幕**正文**是一个独立 URL 上的 JSON: { body: [{ from, to, content }] }, 单位是秒.
//   而用户说"保存字幕"时认的是 VTT / SRT 两种文本格式 (PiliNara 的 CC 面板就是给这两种).
//   同一份时间语义必须只有一个真源, 否则"偏移后导出的字幕和画面对不上"这类问题会散在页面里.
//
// ★ 本模块是**纯逻辑**: 不 import 任何模块、不碰 bilinet、不读写文件、无副作用.
//   页面、门禁 (tools/check-subtitle.mjs) 和真机走的是同一份实现 —— 门禁能直接 import 它.
//
// 时间单位: 全部是**秒** (number, 可带小数). B 站 CC 的 from/to 本来就是秒 (浮点),
// VTT/SRT 的 "00:01:02.345" 也统一折算成秒 —— 页面拿 cue.from 直接和 video.currentTime 比,
// 不做第二套单位换算. cue 的形状固定是 { from, to, text }.

// ---------- 内部: 数值与时间 ----------
// 统一的毫秒量化. 为什么必须量化: 0.1 + 0.2 在 double 里是 0.30000000000000004,
// "偏移 0.1s 后与原文逐字等价"这类断言会假红; 而 VTT/SRT 的时间精度本来只有毫秒,
// 量化不丢任何真实信息, 也让 UI 显示更稳.
function q(sec) {
  return Math.round(Number(sec) * 1000) / 1000
}

function pad(n, width) {
  var s = String(n)
  while (s.length < width) s = '0' + s
  return s
}

// 秒 -> "HH:MM:SS.mmm" (sep 用 '.' ) 或 "HH:MM:SS,mmm" (sep 用 ',', SRT 要逗号).
// 负数/非数按 0 处理: 时间戳写成负数在两种格式里非法, 导出时宁可退化成 0.
function fmtTime(sec, sep) {
  var t = Number(sec)
  if (!isFinite(t) || t < 0) t = 0
  var total = Math.round(t * 1000)        // 先整体取整毫秒, 进位只发生一次
  var ms = total % 1000
  var rest = (total - ms) / 1000
  var s = rest % 60
  var m = Math.floor(rest / 60) % 60
  var h = Math.floor(rest / 3600)
  return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + sep + pad(ms, 3)
}

// [HH:]MM:SS[.,]mmm / [HH:]MM:SS —— 小时位可缺 (VTT 允许 "01:02.345",
// 部分 SRT 生成器也会省小时位), 毫秒可缺, 逗号与点号都收.
// 不做 60 进位的合法性校验: "00:00:75,000" 这种脏数据当 75 秒用比整条丢掉更有用.
var TIME_RE = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/

/** 时间戳文本 -> 秒; 解析失败返回 -1 (调用方据此丢行, 不抛) */
function parseTime(text) {
  var s = String(text == null ? '' : text).trim()
  if (s === '') return -1
  var m = TIME_RE.exec(s)
  if (!m) return -1
  var h = m[1] ? Number(m[1]) : 0
  var mi = Number(m[2])
  var se = Number(m[3])
  // ".5" 按 500ms 补零 (VTT/SRT 都允许省略尾零), 超过 3 位已经在正则里挡掉
  var ms = m[4] ? Number((m[4] + '00').slice(0, 3)) : 0
  return q(h * 3600 + mi * 60 + se + ms / 1000)
}

// 右侧时间戳可能带 cue 设置 ("00:00:04.000 align:start line:0"), 只取第一个 token
function firstToken(s) {
  var t = String(s == null ? '' : s).trim()
  var i = t.search(/\s/)
  return i < 0 ? t : t.slice(0, i)
}

// 文本压成单行: 换行 -> 空格, 首尾去白.
// 为什么导出时也要压: 本机字幕是单行渲染, 且这样 "parse -> 导出 -> 再 parse" 才能逐字等价
// (解析侧本来就把连续多行合成一行).
function flat(text) {
  return String(text == null ? '' : text).replace(/\r\n|\r|\n/g, ' ').trim()
}

// ---------- 内部: VTT / SRT 共用的块解析 ----------
var ARROW = '-->'
// WEBVTT 头部 + NOTE/STYLE/REGION 三种块级指令 (都在行首, 整块跳过)
var VTT_BLOCK_RE = /^(WEBVTT|NOTE|STYLE|REGION)\b/i

/**
 * VTT 与 SRT 的差别只有三处: 指令块、逗号/点号、序号行.
 * 序号行和 cue 标识行本来就是"没有 --> 就跳过", 所以两个解析器共用一个内核.
 * @param {string} text
 * @param {boolean} vtt true = 跳过 WEBVTT/NOTE/STYLE/REGION 块
 */
function parseCues(text, vtt) {
  var out = []
  if (text == null) return out
  var src = String(text)
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1)     // 带 BOM 的文件很常见
  var lines = src.split(/\r\n|\r|\n/)
  var i = 0
  while (i < lines.length) {
    var cur = lines[i]
    var t = cur.trim()
    if (t === '') { i++; continue }
    if (vtt && VTT_BLOCK_RE.test(t)) {
      // 块级指令: 一直吞到空行 (WEBVTT 后面的 Kind:/Language: 也这样被吞掉)
      i++
      while (i < lines.length && lines[i].trim() !== '') i++
      continue
    }
    var at = cur.indexOf(ARROW)
    if (at < 0) { i++; continue }                          // 序号行 / cue 标识行 / 垃圾行
    var from = parseTime(cur.slice(0, at))
    var to = parseTime(firstToken(cur.slice(at + ARROW.length)))
    // 坏行丢弃: 时间戳解析不出来, 或 to <= from (这种 cue 永远选不中, 留着只会污染下标)
    if (from < 0 || to < 0 || to <= from) { i++; continue }
    i++
    var parts = []
    while (i < lines.length) {
      var l = lines[i]
      if (l.trim() === '') break
      if (l.indexOf(ARROW) >= 0) break                     // 容错: 缺空行分隔时不吞掉下一条
      parts.push(l.trim())
      i++
    }
    // 连续多行合成一行 (空格连). 空文本的 cue 保留 —— VTT/SRT 里它是合法的"清屏",
    // 丢掉反而让 "解析 -> 导出 -> 再解析" 对不上.
    out.push({ from: from, to: to, text: parts.join(' ') })
  }
  return out
}

// ---------- 内部: 字幕列表的归一化 ----------
function normUrl(u) {
  var s = String(u == null ? '' : u).trim()
  if (s === '') return ''
  if (s.indexOf('//') === 0) s = 'https:' + s
  if (s.indexOf('http://') === 0) s = 'https://' + s.slice(7)
  return s
}

// detail 的四种真实形态都收: {data:{subtitle:{subtitles}}} / {subtitle:{subtitles}} /
// {subtitles:[...]} / 数组本身. 逐层往下找, 最多 4 层 (防环).
function subtitleListOf(v) {
  var depth = 0
  while (v && typeof v === 'object' && depth < 4) {
    if (Array.isArray(v)) return v
    if (v.subtitle && Array.isArray(v.subtitle.subtitles)) return v.subtitle.subtitles
    if (Array.isArray(v.subtitles)) return v.subtitles
    v = v.data || v.result || null
    depth++
  }
  return []
}

// CC 正文 JSON 的形态: {body:[...]} / {data:{body:[...]}} / 数组本身
function cueListOf(v) {
  var depth = 0
  while (v && typeof v === 'object' && depth < 4) {
    if (Array.isArray(v)) return v
    if (Array.isArray(v.body)) return v.body
    v = v.data || v.result || null
    depth++
  }
  return []
}

// ========== 对外 ==========

/**
 * 解析字幕正文 JSON (B 站 CC: { body: [{ from, to, content }] }).
 * raw 可以是**字符串** (刚 httpGet 回来的原文) 也可以是**已解析的对象**;
 * 字符串不是合法 JSON 时返回空数组 (不抛 —— 调用方只需要"没有字幕"这个结论).
 * from/to 是秒 (浮点), 逐条量化到毫秒; to <= from 的条目丢弃.
 * @param {string|object|null} raw
 * @returns {Array<{from:number,to:number,text:string}>}
 */
export function parseSubtitleJson(raw) {
  var data = raw
  if (typeof data === 'string') {
    var s = data.trim()
    if (s === '') return []
    try { data = JSON.parse(s) } catch (e) { return [] }
  }
  var list = cueListOf(data)
  var out = []
  for (var i = 0; i < list.length; i++) {
    var it = list[i]
    if (!it || typeof it !== 'object') continue
    var from = Number(it.from)
    var to = Number(it.to)
    if (!isFinite(from) || !isFinite(to) || to <= from) continue
    var text = it.content != null ? it.content : (it.text != null ? it.text : '')
    out.push({ from: q(from), to: q(to), text: flat(text) })
  }
  return out
}

/**
 * 解析 WebVTT. 兼容 "00:00:01.000 --> 00:00:04.000" 与逗号小数点;
 * 行首 WEBVTT/NOTE/STYLE/REGION 块跳过; 一个 cue 的多行文本用空格合成一行.
 * @param {string|null} text
 * @returns {Array<{from:number,to:number,text:string}>}
 */
export function parseVtt(text) {
  return parseCues(text, true)
}

/**
 * 解析 SRT. 序号行可缺; "00:00:01,000 --> 00:00:04,000" 与点号都收;
 * "MM:SS.mmm" (缺小时位) 也收.
 * @param {string|null} text
 * @returns {Array<{from:number,to:number,text:string}>}
 */
export function parseSrt(text) {
  return parseCues(text, false)
}

/**
 * 取某一时刻该显示的字幕. 区间是**左闭右开**: from <= t < to.
 * 多条命中 (字幕源本来就可能重叠) 取第一条 —— 顺序即优先级, 由调用方决定谁排前面.
 * @param {Array} cues
 * @param {number} timeSec
 * @returns {{from:number,to:number,text:string}|null}
 */
export function pickCue(cues, timeSec) {
  var t = Number(timeSec)
  if (!isFinite(t) || !cues || !cues.length) return null
  for (var i = 0; i < cues.length; i++) {
    var c = cues[i]
    if (!c) continue
    var from = Number(c.from)
    var to = Number(c.to)
    if (!isFinite(from) || !isFinite(to)) continue
    if (from <= t && t < to) return c
  }
  return null
}

/**
 * 归一化播放器接口里的字幕列表.
 * 入参形态: {data:{subtitle:{subtitles:[]}}} / {subtitle:{subtitles:[]}} / subtitles 数组本身.
 * 返回 [{ id, lan, lanDoc, url, aiType }]:
 *   - id 统一成**字符串** (B 站同时下发数字 id 和 id_str, 当 v-for key 会 1 与 '1' 混用)
 *   - lan 如 'zh-CN' / 'ai-zh' / 'en-US'; lanDoc 是显示名, 缺了退回 lan
 *   - url 补全协议 (设备 curl 对 http 的 CDN 不稳, 与 bili.js normalizeUrl 同一处理)
 *   - aiType: 0 = 人工, 1 = AI 生成 (B 站语义); 缺失按 0 —— 只有明确标 1 才在 UI 上打 AI 角标
 * 没有 url 的条目直接丢 (点了也播不了, 留在列表里只会变成死按钮).
 * @param {object|Array|null} detail
 * @returns {Array<{id:string,lan:string,lanDoc:string,url:string,aiType:number}>}
 */
export function pickSubtitles(detail) {
  var list = subtitleListOf(detail)
  var out = []
  for (var i = 0; i < list.length; i++) {
    var it = list[i]
    if (!it || typeof it !== 'object') continue
    var url = normUrl(it.subtitle_url || it.subtitle_url_v2 || it.url || '')
    if (url === '') continue
    var lan = String(it.lan == null ? '' : it.lan)
    var id = (it.id_str != null && it.id_str !== '') ? it.id_str : (it.id != null ? it.id : lan)
    out.push({
      id: String(id),
      lan: lan,
      lanDoc: String(it.lan_doc || it.lanDoc || lan),
      url: url,
      aiType: Number(it.ai_type) || 0
    })
  }
  return out
}

/**
 * 整体平移字幕时间 (对轴/本地偏移). **不原地改**入参, 返回新数组 (每个 cue 也是新对象).
 * 结果夹紧到 >= 0, 且始终 from < to:
 *   两条时间都被推到 0 之前时, 退化成 [0, 0.001] 的 1ms 空窗 —— 播放时实际命不中
 *   (等价于丢弃), 但**数组长度不变**, 调用方不用处理下标漂移.
 * 非数的 cue 直接丢 (产出 NaN 时间戳比缺一条更糟).
 * @param {Array} cues
 * @param {number} deltaSec 正 = 往后推
 * @returns {Array<{from:number,to:number,text:string}>}
 */
export function offsetCues(cues, deltaSec) {
  var src = cues || []
  var d = Number(deltaSec)
  if (!isFinite(d)) d = 0
  var out = []
  for (var i = 0; i < src.length; i++) {
    var c = src[i]
    if (!c) continue
    var from = Number(c.from)
    var to = Number(c.to)
    if (!isFinite(from) || !isFinite(to)) continue
    var nf = q(from + d)
    var nt = q(to + d)
    if (nf < 0) nf = 0
    if (nt < 0) nt = 0
    if (nt <= nf) nt = q(nf + 0.001)
    var next = Object.assign({}, c)
    next.from = nf
    next.to = nt
    out.push(next)
  }
  return out
}

/**
 * cue 数组 -> WebVTT 文本.
 * 文本里的 <b>/<i> 等标签**原样保留** (B 站字幕带这些), 只把换行压成空格.
 * 输出末尾一定有换行; 空数组给 "WEBVTT\n" (仍是合法的空字幕文件).
 * @param {Array} cues
 * @returns {string}
 */
export function cuesToVtt(cues) {
  var src = cues || []
  var out = ['WEBVTT']
  for (var i = 0; i < src.length; i++) {
    var c = src[i]
    if (!c) continue
    out.push('')
    out.push(fmtTime(c.from, '.') + ' --> ' + fmtTime(c.to, '.'))
    out.push(flat(c.text))
  }
  return out.join('\n') + '\n'
}

/**
 * cue 数组 -> SRT 文本. 序号从 1 递增, 时间戳用逗号, 末尾一定有换行; 空数组给空串.
 * @param {Array} cues
 * @returns {string}
 */
export function cuesToSrt(cues) {
  var src = cues || []
  var out = []
  var n = 0
  for (var i = 0; i < src.length; i++) {
    var c = src[i]
    if (!c) continue
    n++
    out.push(String(n))
    out.push(fmtTime(c.from, ',') + ' --> ' + fmtTime(c.to, ','))
    out.push(flat(c.text))
    out.push('')
  }
  return out.length ? (out.join('\n') + '\n') : ''
}
