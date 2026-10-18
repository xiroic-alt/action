// 视频弹幕: XML 解析 / Pakku 风格合并 / 屏蔽过滤 / 泳道排布 / 时刻命中
//
// 为什么单独一层 (而不是写进播放页):
//   本机 (Falcon / QuickJS 20200705) 没有 canvas, 也没有任何弹幕渲染库; 页面只能用普通元素
//   挪 transform. 于是真正需要被钉死的全是纯几何 + 时间:
//     - 什么时候可见 (visibleAt / buildTracks 算出的 dur)
//     - 放在第几条泳道 (buildTracks, 同泳道严禁时间区间相交)
//     - 有多宽 (estimateWidth: 本机**测量不了文本宽度**, 只能按字符估)
//   全是纯函数: 不 import 任何模块 / 不碰 bilinet / 不读写文件 —— 门禁与页面都能直接加载.
//
// 协议事实 (references/bilibili-api-collect-mirror/docs/danmaku/danmaku_xml.md):
//   <d p="出现秒,模式,字号,十进制RGB,发送时间戳,池,用户hash,dmid,屏蔽等级">文本</d>
//   模式: 1/2/3 普通(滚动) · 4 底端 · 5 顶端 · 6 逆向 · 7 高级 · 8 代码 · 9 BAS
//   字号: 18 小 / 25 标准 / 36 大;  颜色: 十进制 RGB888 (16777215 = #ffffff)
//   本机不支持 7(位置在 JSON 里)/8(代码)/9(BAS) —— 解析期直接丢, 不留到渲染期再判.
//
// 颜色字段的约定 (重要): parseDanmakuXml 的 color 保持**十进制整数**, 与签名
// "color: number(十进制RGB)" 一致; 要写进 style 用 colorHex(color) 转 '#rrggbb'.
// 转换只做一处, 页面不重复实现.

// ---------- 缺省几何 (为什么是这些值) ----------
// 屏幕逻辑 960x266 (player.vue 实测); 视频画面矩形缺省 474x266 (player.vue fitRect 的 16:9 兜底).
// 弹幕按**视频矩形**排: 铺到两侧黑边上没有意义, 还会压住返回按钮/进度条.
var AREA_W = 474
var AREA_H = 266
// 字号 22: 播放器标题 22px / 评论正文 18px; 弹幕要在 266px 高的屏上可读, 又不压住画面
var FONT_PX = 22
// 速度 60 px/s: 474 / 60 ≈ 7.9s 穿过屏幕, 与 B 站默认观感同量级.
// 再快看不清(屏只有 266px 高, 弹幕本来就短), 再慢会在屏上堆成一片.
var SPEED_PX = 60
// 顶/底弹幕停留 4s: 这类弹幕定点不动, 时长由观感决定 (B 站官方观感约 4s)
var TOP_BOTTOM_DUR = 4
// 行高 = 字号 * 1.5: 22px 字要留出上下间距才不糊在一起, 1.5 是阅读下限
var LANE_RATIO = 1.5
// 泳道"空闲时刻"的初值: 一个足够小的负数, 保证任何 t >= 0 的弹幕都能占上第一条空泳道
// (不用 -Infinity: 参与算术后容易出现 NaN/Infinity 混进输出, 这里的语义只是"一直空着")
var FREE_AT = -1e9
// 单个屏蔽正则的最大 source 长度: 本机 CPU 弱, 超长正则 + 回溯会把主线程冻住(播放页卡死)
var RE_MAX = 200

// ---------- 小工具 ----------
function num(v) { var n = Number(v); return isFinite(n) ? n : 0 }

function numOr(v, def, min) {
  var n = Number(v)
  return (isFinite(n) && n >= min) ? n : def
}

// 数组入参归一: 也接受"单个值"(单个正则/单个屏蔽词), 免得调用方为传一个值还要包一层数组
function arr(v) {
  if (v instanceof Array) return v
  if (v === undefined || v === null) return []
  return [v]
}

// 浅拷贝: filterDanmaku / buildTracks 只**读**入参, 输出必须是新对象
// (页面会把 items 直接绑在渲染列表上, 共享引用会让上一条弹幕的状态串到下一条)
function cloneItem(it) {
  var o = {}
  for (var k in it) {
    if (Object.prototype.hasOwnProperty.call(it, k)) o[k] = it[k]
  }
  return o
}

// mode 归一: 缺失/非法一律当 1(普通滚动).
// 为什么: 手工构造的列表、以及被"合并->过滤"链剥掉 mode 的列表, 都还得按主流语义走 ——
// 绝不能让"少了个字段"变成"弹幕全都不显示"或"屏蔽全都不生效". 解析器只会产出 1..6.
function modeOf(it) {
  var n = Number(it && it.mode)
  if (!isFinite(n)) return 1
  return Math.round(n)
}
function isScrollMode(m) { return m === 1 || m === 2 || m === 3 || m === 6 }
function isTopBottom(m) { return m === 4 || m === 5 }

// 按**码点**计长度: 弹幕里 emoji 很多, 直接 text.length 会把一个 emoji 算成 2 (UTF-16 代理对),
// minLength 就会莫名多拦/少拦. 手写代理对判断, 不依赖 fromCodePoint / 任何 ES2015+ 新方法.
function charLen(s) {
  var str = String(s == null ? '' : s)
  var n = 0
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var d = str.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { i++; n++; continue }
    }
    n++
  }
  return n
}

// ---------- XML 反转义 ----------
// ★ 必须**单次正则扫描**替换, 不能连续 replace 五次: 那样 "&amp;lt;3" 会先变 "&lt;3" 再变 "<3"
//   (多解一层 = 语义错误), 这是 B 站弹幕文本里最常见的一类脏数据.
var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
var ENT_RE = /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g

function unescapeXml(s) {
  return String(s == null ? '' : s).replace(ENT_RE, function (m, body) {
    if (body.charAt(0) === '#') {
      var code = (body.charAt(1) === 'x' || body.charAt(1) === 'X')
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      // 越界/非法码点: 原样留着, 不去造怪字符
      if (!isFinite(code) || code <= 0 || code > 0x10ffff) return m
      if (code <= 0xffff) return String.fromCharCode(code)
      // 手写代理对: 避开 fromCodePoint 在本运行时的可用性疑问
      var v = code - 0x10000
      return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    }
    var k = body.toLowerCase()
    return ENT[k] === undefined ? m : ENT[k]
  })
}

// ---------- 1. XML 解析 ----------
// 坏行一律跳过 (返回 null), 绝不抛: 一次网络抖动拿回半截 XML, 不能让整个播放页挂掉.
// 丢掉的行: 没有 p 属性 / 字段少于 4 项 / 时间非数字或为负 / 模式不在 1..6 / 文本去空白后为空.
var D_RE = /<d\b([^>]*)>([\s\S]*?)<\/d\s*>/g
var P_RE = /\bp\s*=\s*(?:"([^"]*)"|'([^']*)')/

function parseDanmakuLine(attrs, raw) {
  var pm = P_RE.exec(String(attrs == null ? '' : attrs))
  if (!pm) return null
  var p = String(pm[1] !== undefined ? pm[1] : pm[2])
  var f = p.split(',')
  if (f.length < 4) return null          // 时间/模式/字号/颜色 至少四段, 少一段就是坏行
  var t = parseFloat(f[0])
  if (!isFinite(t) || t < 0) return null  // 负时间属于脏数据(会在片头立刻冒出来), 直接丢
  var mode = parseInt(f[1], 10)
  if (!(mode >= 1 && mode <= 6)) return null   // 白名单: 7 高级 / 8 代码 / 9 BAS 本机渲染不了
  var size = parseInt(f[2], 10)
  if (!isFinite(size) || size <= 0) size = 25  // 字号缺省 25 = B 站标准档
  var color = parseInt(f[3], 10)
  if (!isFinite(color) || color < 0 || color > 0xffffff) color = 0xffffff  // 坏颜色退白, 白弹幕永远可读
  var text = unescapeXml(raw).replace(/^\s+|\s+$/g, '')
  if (text === '') return null
  return { t: t, mode: mode, size: size, color: color, text: text }
}

/**
 * 解析 B 站弹幕 XML (<i><d p="...">文本</d>...</i>).
 * @param {string} xml 原始 XML (可能半截 / 空 / 非字符串)
 * @returns {Array} [{ t: 秒(number), mode: number, size: number, color: number(十进制RGB), text: string }]
 *                  保持文档顺序(不排序); 合并/排泳道时会各自排序
 */
export function parseDanmakuXml(xml) {
  var out = []
  var src = String(xml == null ? '' : xml)
  if (src === '' || src.indexOf('<d') < 0) return out
  D_RE.lastIndex = 0
  var m
  while ((m = D_RE.exec(src))) {
    var row = parseDanmakuLine(m[1], m[2])
    if (row) out.push(row)
  }
  return out
}

// 颜色: 十进制 RGB -> '#rrggbb' (页面写 style 只吃字符串; 协议里是十进制整数).
// 越界/非数字 -> '#ffffff' (白弹幕是 B 站默认, 任何底色上都能读)
function hex2(v) { return ('0' + v.toString(16)).slice(-2) }
export function colorHex(color) {
  var n = Math.round(Number(color))
  if (!isFinite(n) || n < 0) n = 0xffffff
  if (n > 0xffffff) n = 0xffffff
  return '#' + hex2((n >> 16) & 0xff) + hex2((n >> 8) & 0xff) + hex2(n & 0xff)
}

// 按 t 升序的**新数组** (元素仍是原对象, 只读用).
// 排序键加"原下标"兜底: 老引擎的 Array.sort 不保证稳定, 同 t 的弹幕顺序飘了会让泳道分配不可复现.
function sortByTime(list) {
  var src = list || []
  var dec = []
  for (var i = 0; i < src.length; i++) dec.push({ it: src[i], i: i })
  dec.sort(function (a, b) {
    var d = num(a.it && a.it.t) - num(b.it && b.it.t)
    return d !== 0 ? d : (a.i - b.i)
  })
  var out = []
  for (var j = 0; j < dec.length; j++) out.push(dec[j].it)
  return out
}

// ---------- 2. Pakku 风格合并 ----------
function scaleOf(count, threshold, growth, maxScale) {
  var extra = (count - threshold) * growth
  if (!(extra > 0)) return 1                       // count <= threshold: 不放大
  var cap = maxScale - 1
  if (extra > cap) extra = cap
  return 1 + extra
}

/**
 * Pakku 风格的"合并弹幕": 相同 text 且时间差 <= windowSec 的合成一条.
 *  - 只在**滚动类** (1/2/3/6) 合并; 顶/底弹幕是定点停留, 合并会把两条不同位置的内容叠在一起.
 *  - 合并簇的时间锚点是**簇内最早那条**: 若拿"上一条"当参照, A@0 A@5 A@10 (window 6) 会链式并成一簇,
 *    弹幕会被拖到完全不对的时间出现.
 *  - scale = 1 + min(maxScale-1, max(0, count-threshold) * growth), 上限 maxScale.
 *
 * @param {Array} list 任意弹幕数组 (元素需有 text/t; t 用 number 秒)
 * @param {Object} [opts] { windowSec=6, threshold=3, growth=0.12, maxScale=2.2, keepMode=false }
 *        keepMode=true 时输出额外带上 mode (默认不带 —— 输出形状与约定完全一致:
 *        { t, text, color, count, scale }; 需要 buildTracks 区分顶/底弹幕时再打开)
 * @returns {Array} [{ t, text, color, count, scale }] 按 t 升序; 不修改入参
 */
export function mergeDanmaku(list, opts) {
  var o = opts || {}
  var windowSec = numOr(o.windowSec, 6, 0)
  var threshold = numOr(o.threshold, 3, 0)
  var growth = numOr(o.growth, 0.12, 0)
  var maxScale = numOr(o.maxScale, 2.2, 1)
  var keepMode = o.keepMode === true
  var sorted = sortByTime(list)
  var out = []
  // ★ 无原型对象: 弹幕文本可以是 "__proto__" / "constructor" 这类键,
  //   普通 {} 上 groups['__proto__'] 拿到的是 Object.prototype (非 undefined) -> out[gi] 是 undefined -> 崩.
  var groups = Object.create(null)
  for (var i = 0; i < sorted.length; i++) {
    var it = sorted[i]
    if (!it) continue
    var text = String(it.text == null ? '' : it.text)
    var t = num(it.t)
    if (text === '') continue                      // 无文本的条目直接丢 (没有可渲染的东西)
    // ★ 顶/底弹幕既**不查**也**不写**分组表: 它们和滚动弹幕语义不同, 共享一张表会把
    //   "同文本的顶端弹幕" 当成滚动弹幕的合并对象 (合并会改掉它的 time/count/scale).
    if (!isScrollMode(modeOf(it))) {
      var solo = { t: t, text: text, color: it.color === undefined ? 0xffffff : it.color, count: 1, scale: 1 }
      if (keepMode) solo.mode = modeOf(it)
      out.push(solo)
      continue
    }
    var gi = groups[text]
    if (gi === undefined) {
      var fresh = { t: t, text: text, color: it.color === undefined ? 0xffffff : it.color, count: 1, scale: 1 }
      if (keepMode) fresh.mode = modeOf(it)
      groups[text] = out.length
      out.push(fresh)
      continue
    }
    var g = out[gi]
    if (t - g.t <= windowSec) {
      g.count = g.count + 1
      g.scale = scaleOf(g.count, threshold, growth, maxScale)
    } else {
      // 超出窗口 -> 另起一簇; 后面同 text 的条目改为跟这一簇比
      var nxt = { t: t, text: text, color: g.color, count: 1, scale: 1 }
      if (keepMode) nxt.mode = modeOf(it)
      out.push(nxt)
      groups[text] = out.length - 1
    }
  }
  return out
}

// ---------- 3. 屏蔽过滤 ----------
// 正则编译: 非法 source 一律**忽略**而不是抛 —— 屏蔽词是玩家手输的, 输错一个字不能让播放页挂掉.
// 另两条保守处理:
//   - source 超过 RE_MAX 字符跳过 (本机 CPU 弱, 超长正则回溯会冻住主线程);
//   - 空 source 跳过 ('/^$/' 之外的"空正则"会 match 一切 -> 误加一个空串就全屏清空).
function compileRegexes(list) {
  var src = arr(list)
  var out = []
  for (var i = 0; i < src.length; i++) {
    var r = src[i]
    if (r instanceof RegExp) {
      if (r.source !== '' && r.source.length <= RE_MAX) out.push(r)
      continue
    }
    var s = String(r == null ? '' : r)
    if (s === '' || s.length > RE_MAX) continue
    try { out.push(new RegExp(s)) } catch (e) { /* 非法正则: 忽略这一条 */ }
  }
  return out
}

function hitRegex(text, list) {
  for (var i = 0; i < list.length; i++) {
    try {
      // /g 与 /y 的 test 会推进 lastIndex —— 不复位就变成"一条命中、一条漏过"
      if (list[i].global || list[i].sticky) list[i].lastIndex = 0
      if (list[i].test(text)) return true
    } catch (e) { /* 单条运行期出错也不影响其它条 */ }
  }
  return false
}

function hitKeyword(text, keywords) {
  for (var i = 0; i < keywords.length; i++) {
    var k = String(keywords[i] == null ? '' : keywords[i])
    if (k === '') continue          // 空串屏蔽词跳过: indexOf('') 恒为 0, 会把所有弹幕都滤掉
    if (text.indexOf(k) >= 0) return true
  }
  return false
}

function hitMode(mode, modes) {
  for (var i = 0; i < modes.length; i++) {
    var n = Number(modes[i])
    if (isFinite(n) && n === mode) return true
  }
  return false
}

/**
 * 按用户规则过滤弹幕. 命中任一条即丢弃; count/scale/mode 等字段原样带出.
 * @param {Array} list
 * @param {Object} [rules] { keywords: [], regexes: [], modes: [], minLength: 0 }
 *        keywords 子串命中(区分大小写, 按字面命中); regexes 支持字符串或 RegExp, 非法忽略;
 *        modes 为空数组 = 不按模式过滤; minLength 小于该长度丢弃 (按码点计, 0 = 不过滤)
 * @returns {Array} 同形状新数组; 不修改入参 (输出是浅拷贝)
 */
export function filterDanmaku(list, rules) {
  var r = rules || {}
  var keywords = arr(r.keywords)
  var regexes = compileRegexes(r.regexes)
  var modes = arr(r.modes)
  var minLength = numOr(r.minLength, 0, 0)
  var out = []
  var src = list || []
  for (var i = 0; i < src.length; i++) {
    var it = src[i]
    if (!it) continue
    var text = String(it.text == null ? '' : it.text)
    if (charLen(text) < minLength) continue
    if (hitKeyword(text, keywords)) continue
    if (hitRegex(text, regexes)) continue
    if (modes.length > 0 && hitMode(modeOf(it), modes)) continue
    out.push(cloneItem(it))
  }
  return out
}

// ---------- 4. 宽度估算 ----------
/**
 * 估算文本像素宽度 (本机测不了真实文本宽度, 只能按字符类别估).
 * 码点 < 0x80 视为半角 (0.55 * fontSize); 其余一律全角 (1.0 * fontSize); 求和后向上取整.
 * 为什么 0.55: 本机拉丁字母/数字的实测平均字宽约为字号的 0.55 倍 (等宽感更弱, 取整偏小会叠字,
 * 所以这里偏保守地按 0.55 而不是 0.5). 全角按 1.0 是中文方块字的标准字宽.
 * 代理对(emoji)按两个码元都算全角 -> 估宽偏大, 属刻意保守(宁可早出屏, 不要叠字).
 * @param {string} text
 * @param {number} [fontSize=22] 字号 px
 * @returns {number} 整数 px
 */
export function estimateWidth(text, fontSize) {
  var s = String(text == null ? '' : text)
  var px = numOr(fontSize, FONT_PX, 1)
  var w = 0
  for (var i = 0; i < s.length; i++) {
    w += s.charCodeAt(i) < 0x80 ? 0.55 * px : px
  }
  return Math.ceil(w)
}

// ---------- 5. 泳道排布 ----------
/**
 * 排泳道: 同一条泳道内**时间区间严禁相交**, 溢出丢弃.
 * 模型 (为什么这么定): 一条弹幕在 [t, t+dur) 独占一条泳道整行. 本机没有 canvas, 只能靠
 * transform + 定时器推进 —— 若让同泳道两条并行滚动, 必须算 x 轴间距, 而 x 又依赖
 * estimateWidth 的估算误差, 一旦估小就叠字. 首版取"独占泳道"这个**可证明正确**的模型:
 * 宁可少显示几条, 也不要在屏幕上叠成一团. (追求"同泳道追尾并存"需要真实文本测量, 本机没有.)
 *
 * @param {Array} list 弹幕数组 (元素需有 t/text; 可带 color/size/mode/count/scale)
 * @param {Object} [cfg] { areaW=474, areaH=266, fontSize=22, speedPx=60, laneH=round(fontSize*1.5), maxLanes }
 *        lanes = min(maxLanes, floor(areaH/laneH)); 元素自带 dur>0 时按 dur, 否则 dur = areaW/speedPx .
 *        顶/底弹幕 (mode 4/5) 默认停留 TOP_BOTTOM_DUR 秒.
 * @returns {{lanes:number, items:Array}} items: 入参字段原样带出 + { lane:0..lanes-1, w, dur }, 按 t 升序
 */
export function buildTracks(list, cfg) {
  var c = cfg || {}
  var areaW = numOr(c.areaW, AREA_W, 1)
  var areaH = numOr(c.areaH, AREA_H, 1)
  var fontSize = numOr(c.fontSize, FONT_PX, 1)
  var speedPx = numOr(c.speedPx, SPEED_PX, 1)
  var laneH = numOr(c.laneH, Math.round(fontSize * LANE_RATIO), 1)
  var fitLanes = Math.floor(areaH / laneH)
  // 退化输入 (areaH 比行高还小) 也至少给 1 条泳道: 0 泳道 = 整页一条弹幕都没有,
  // 比"挤出一行"更像是坏了
  if (fitLanes < 1) fitLanes = 1
  var maxLanes = Math.floor(numOr(c.maxLanes, fitLanes, 1))
  if (maxLanes < 1) maxLanes = 1
  var lanes = maxLanes < fitLanes ? maxLanes : fitLanes
  var defDur = areaW / speedPx
  var sorted = sortByTime(list)
  var freeAt = []
  var i
  for (i = 0; i < lanes; i++) freeAt.push(FREE_AT)
  var items = []
  for (i = 0; i < sorted.length; i++) {
    var it = sorted[i]
    if (!it) continue
    var t = num(it.t)
    if (!isFinite(t) || t < 0) continue
    var text = String(it.text == null ? '' : it.text)
    if (text === '') continue
    var tb = isTopBottom(modeOf(it))
    var dur = num(it.dur)
    if (!(dur > 0)) dur = tb ? TOP_BOTTOM_DUR : defDur
    // 贪心: 取编号最小且已空闲的泳道 (编号小 = 靠上, 与阅读顺序一致, 也便于比对稳定)
    var lane = -1
    for (var j = 0; j < lanes; j++) {
      if (freeAt[j] <= t) { lane = j; break }
    }
    if (lane < 0) continue                // 全忙 -> 丢弃 (与用户要求一致: 密到装不下就丢, 不叠)
    freeAt[lane] = t + dur
    var out = cloneItem(it)               // 带出 count/scale/mode: 合并后的放大要能传到页面上
    out.t = t
    out.text = text
    out.color = it.color === undefined ? 0xffffff : it.color
    out.lane = lane
    out.w = estimateWidth(text, fontSize)
    out.dur = dur
    items.push(out)
  }
  return { lanes: lanes, items: items }
}

// ---------- 6. 时刻命中 ----------
/**
 * 取出 timeSec 时刻应显示的弹幕: t <= timeSec < t + dur (左闭右开).
 * 左闭右开与泳道不相交是同一套时间语义: 相邻两条首尾相接时不会同一帧都出现.
 * 返回**原对象引用**(不复制) —— 播放中每帧都要调, 500 条逐帧浅拷贝在这台设备上是纯浪费;
 * 调用方只读.
 * @param {Array} items buildTracks 的输出 (缺 dur 时按缺省时长兜底)
 * @param {number} timeSec 播放位置(秒)
 * @returns {Array}
 */
export function visibleAt(items, timeSec) {
  var out = []
  var t = Number(timeSec)
  if (!isFinite(t)) return out
  var src = items || []
  for (var i = 0; i < src.length; i++) {
    var it = src[i]
    if (!it) continue
    var t0 = Number(it.t)
    if (!isFinite(t0)) continue
    var d = Number(it.dur)
    if (!(d > 0)) d = isTopBottom(modeOf(it)) ? TOP_BOTTOM_DUR : (AREA_W / SPEED_PX)
    if (t >= t0 && t < t0 + d) out.push(it)
  }
  return out
}
