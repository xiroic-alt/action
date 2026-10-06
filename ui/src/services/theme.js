// M3 主题运行时: 把 services/config.js 里的用户选择解成「语义角色」与「形状/字级」,
// 页面只消费语义名 (surface / onSurfaceVariant / primary ...), 不出现任何字面色值.
//
// 分层 (与 material-design-3-ui 的分层要求一致):
//   参考调色板 (m3-scheme.js, 构建期由 Google 官方实现算好)
//     -> 语义角色 (本文件的 roles(): surface / onSurface / primaryContainer ...)
//       -> 页面 :style 绑定 (只写角色名)
//
// 为什么颜色走 :style 而不是 CSS 类:
//   本机渲染器 (greenui) 的 CSS 子集**不支持自定义属性** (在 libfalcon-live.so 里搜
//   'var(--' / 'customProperty' / 'CSSVar' 全部无命中), 也没有 CSS 变量实现,
//   所以"换主题"必须靠 JS 算值 + 内联 style. 这是实测结论, 不是偏好.
//   低频枚举 (圆角风格 / 密度 / 字级) 走类切换, 避免给每个元素都挂绑定.
//
// 缓存: 只按"主题相关的配置元组"做键, 换主题才重算, 平时零成本.

import { M3_ROLES, M3_SCHEMES, M3_SEEDS } from './m3-scheme.js'
import { loadConfig } from './config.js'

// ---------- 种子色 ----------
export function seedList() { return M3_SEEDS }

export function seedHex(id) {
  for (var i = 0; i < M3_SEEDS.length; i++) if (M3_SEEDS[i][0] === id) return M3_SEEDS[i][1]
  return M3_SEEDS[0][1]
}

// ---------- 明暗 ----------
// auto: 06:00-17:59 浅色, 其余深色 (词典笔主要在白天/睡前两个时段用, 按小时分档最直观)
function hourNow() {
  try { return new Date().getHours() } catch (e) { return 20 }
}

export function resolveMode(cfg) {
  var m = cfg ? cfg.themeMode : loadConfig().themeMode
  if (m === 'light' || m === 'dark') return m
  var h = hourNow()
  return (h >= 6 && h < 18) ? 'light' : 'dark'
}

// ---------- 角色表 ----------
// AMOLED 纯黑: 只改 surface 家族 (容器色保留轻微提亮, 否则所有层次会糊成一片黑)
var BLACK = '#000000'
function flattenDark(r, keepContainers) {
  var o = {}
  for (var k in r) if (r.hasOwnProperty(k)) o[k] = r[k]
  o.surface = BLACK
  o.surfaceDim = BLACK
  o.surfaceBright = r.surfaceContainerHighest
  if (!keepContainers) {
    o.surfaceContainerLowest = BLACK
    o.surfaceContainerLow = '#0a0a0a'
    o.surfaceContainer = '#131313'
    o.surfaceContainerHigh = '#1c1c1c'
    o.surfaceContainerHighest = '#262626'
  }
  return o
}

function buildRoles(seed, mode, contrast, pureBlack) {
  var key = seed + '|' + mode + '|' + contrast
  var raw = M3_SCHEMES[key] || M3_SCHEMES['rose|dark|0']
  var vals = raw.split(',')
  var out = {}
  for (var i = 0; i < M3_ROLES.length; i++) out[M3_ROLES[i]] = vals[i]
  if (pureBlack && mode === 'dark') out = flattenDark(out, false)
  return out
}

var cacheRoles = null
var cacheKey = ''

function themeKey(c) {
  return c.themeSeed + '|' + resolveMode(c) + '|' + c.contrastLevel + '|' + (c.pureBlack ? 1 : 0)
}

export function roles() {
  var c = loadConfig()
  var k = themeKey(c)
  if (cacheRoles && cacheKey === k) return cacheRoles
  cacheRoles = buildRoles(c.themeSeed, resolveMode(c), c.contrastLevel, c.pureBlack)
  cacheKey = k
  return cacheRoles
}

// 主题观感变了要让调用方知道 (设置页改完主题, 返回上一页时用它判断是否重算界面)
export function themeRev() { return cacheKey }

// ---------- 形状 / 密度 / 字级 ----------
// 圆角 (M3 shape scale: extra-small 4 / small 8 / medium 12 / large 16 / extra-large 28,
// 按钮与 chip 在 M3 里恒为全圆角)
var RADIUS = {
  flat: { card: 8, btn: 8, chip: 8, field: 8 },
  std: { card: 12, btn: 999, chip: 999, field: 12 },
  round: { card: 28, btn: 999, chip: 999, field: 28 }
}

// 密度: 列表行高 / 内边距 / 控件高 (M3 没有"密度"这个语义, 这是设备可用性扩展:
// 266px 的屏高下, 一行 56px 只能看到 4 行, 紧凑档能把首屏信息量提上去)
// coverW/coverH 维持 16:9 (缩略图比例不能变, 否则封面会被拉伸)
var DENSITY = {
  compact: { item: 96, pad: 6, ctrl: 34, gap: 6, coverW: 154, coverH: 96 },
  std: { item: 112, pad: 8, ctrl: 38, gap: 10, coverW: 180, coverH: 112 },
  cozy: { item: 128, pad: 12, ctrl: 44, gap: 14, coverW: 206, coverH: 128 }
}

// 字级: M3 的 type scale 至少 11 档, 但本机逻辑分辨率 960x266、最小可读字号实测 ~15px,
// 照搬 M3 的 11sp/12sp 会糊到看不清 —— 这里保留 M3 的**层级关系** (label<body<title<headline)
// 与"每档至少差 2px"的节奏, 把绝对值抬到设备可读区间. 这是有意的偏离.
var TYPE_BASE = { title: 22, subtitle: 20, body: 19, label: 17, caption: 15, tiny: 13 }
var SCALE = { sm: 0.9, std: 1.0, lg: 1.15 }

function typeMap(fontScale) {
  var f = SCALE[fontScale] || 1
  var o = {}
  for (var k in TYPE_BASE) if (TYPE_BASE.hasOwnProperty(k)) o[k] = Math.round(TYPE_BASE[k] * f)
  return o
}

// ---------- 给页面的绑定包 ----------
// 用法: data() 里 this.T = tokens(); onShow() 重新 tokens() (主题可能在设置页被改)
export function tokens() {
  var c = loadConfig()
  var r = roles()
  var rad = RADIUS[c.radiusStyle] || RADIUS.std
  var den = DENSITY[c.density] || DENSITY.std
  var type = typeMap(c.fontScale)

  var t = {}

  // 原始语义角色 (需要未包装的颜色时直接取)
  t.c = r

  // ---- 容器 ----
  t.page = { backgroundColor: r.surface }                                  // 页面底
  t.bar = { backgroundColor: r.surfaceContainer }                          // 顶栏 / 导航栏
  t.card = { backgroundColor: r.surfaceContainerLow }                      // 卡片 / 列表容器
  t.cardHi = { backgroundColor: r.surfaceContainer }                       // 高一层容器
  t.inset = { backgroundColor: r.surfaceContainerHighest }                 // 输入框 / 选中底

  // ---- 文字 ----
  t.txt = { color: r.onSurface }                                           // 主要文字
  t.txt2 = { color: r.onSurfaceVariant }                                   // 次要文字
  t.txt3 = { color: r.outline }                                            // 弱化文字
  t.line = { borderColor: r.outlineVariant }                               // 分隔线

  // ---- 强调 (primary) ----
  t.accent = { color: r.primary }
  t.accentBg = { backgroundColor: r.primary }
  t.accentTxt = { color: r.onPrimary }
  t.accentChip = { backgroundColor: r.primaryContainer }                   // 选中态容器
  t.accentChipT = { color: r.onPrimaryContainer }
  t.accentSoft = { backgroundColor: r.primaryContainer, color: r.onPrimaryContainer }

  // ---- 错误 / 危险 ----
  t.err = { color: r.error }
  t.errBg = { backgroundColor: r.errorContainer }
  t.errSoft = { backgroundColor: r.errorContainer, color: r.onErrorContainer }

  // ---- 反色 (snackbar / 提示条) ----
  t.inverse = { backgroundColor: r.inverseSurface }
  t.inverseT = { color: r.inverseOnSurface }
  t.snack = { backgroundColor: r.inverseSurface, color: r.inverseOnSurface, borderRadius: rad.card + 'px' }

  // ---- 形状 ----
  t.rad = {
    card: rad.card + 'px',
    btn: rad.btn + 'px',
    chip: rad.chip + 'px',
    field: rad.field + 'px'
  }
  t.shapeCard = { borderRadius: rad.card + 'px' }
  t.shapeBtn = { borderRadius: rad.btn + 'px' }
  t.shapeChip = { borderRadius: rad.chip + 'px' }
  // 容器 = 背景角色 x 形状 (页面直接绑一个对象, 少写一次)
  t.cardR = { backgroundColor: r.surfaceContainerLow, borderRadius: rad.card + 'px' }
  t.cardHiR = { backgroundColor: r.surfaceContainer, borderRadius: rad.card + 'px' }
  t.insetR = { backgroundColor: r.surfaceContainerHighest, borderRadius: rad.chip + 'px' }
  t.actionR = { backgroundColor: r.surfaceContainerHighest, borderRadius: rad.btn + 'px' }
  t.accentR = { backgroundColor: r.primary, borderRadius: rad.btn + 'px' }
  t.accentPill = { backgroundColor: r.primary, borderRadius: rad.chip + 'px' }
  t.errActionR = { backgroundColor: r.errorContainer, borderRadius: rad.btn + 'px' }

  // ---- 密度 ----
  t.den = {
    item: den.item + 'px',
    itemH: den.item,
    pad: den.pad + 'px',
    ctrl: den.ctrl + 'px',
    gap: den.gap + 'px'
  }
  // 列表卡片: 行高 / 封面 / 封面圆角 / 卡片圆角 —— 一处绑定, 全列表跟着密度走
  t.row = { height: den.item + 'px' }
  t.cover = { width: den.coverW + 'px', height: den.coverH + 'px' }
  t.coverR = { width: den.coverW + 'px', height: den.coverH + 'px', borderTopLeftRadius: rad.card + 'px', borderBottomLeftRadius: rad.card + 'px' }

  // ---- 字级 ----
  t.fs = {
    title: type.title + 'px',
    subtitle: type.subtitle + 'px',
    body: type.body + 'px',
    label: type.label + 'px',
    caption: type.caption + 'px',
    tiny: type.tiny + 'px'
  }
  t.fTitle = { fontSize: t.fs.title }
  t.fSub = { fontSize: t.fs.subtitle }
  t.fBody = { fontSize: t.fs.body }
  t.fLabel = { fontSize: t.fs.label }
  t.fCaption = { fontSize: t.fs.caption }

  // ---- 文字组合样式 (颜色 x 字级) ----
  // 页面只写语义名 (title / body / label / caption / accent), 颜色与字号一起跟着设置走.
  // 为什么合在一个对象里: Vue2 的 :style 数组绑定在本机运行时没有先例, 不敢假设支持;
  // 单个对象是已经在用的形态 (player.vue 的 vrectStyle), 零风险.
  // 字级映射 (M3 层级关系保留, 绝对值抬到设备可读区间):
  //   title 22 屏幕/区块标题 · subtitle 20 列表主文字 · body 19 正文
  //   label 17 按钮与次要信息 · caption 15 注释 · tiny 13 极弱
  t.t = {
    title: { color: r.onSurface, fontSize: t.fs.title },
    titleVar: { color: r.onSurfaceVariant, fontSize: t.fs.title },
    subtitle: { color: r.onSurface, fontSize: t.fs.subtitle },
    subtitleVar: { color: r.onSurfaceVariant, fontSize: t.fs.subtitle },
    accentSub: { color: r.primary, fontSize: t.fs.subtitle },
    empty: { color: r.outline, fontSize: t.fs.title },
    onAccentTitle: { color: r.onPrimary, fontSize: t.fs.title },
    body: { color: r.onSurface, fontSize: t.fs.body },
    bodyVar: { color: r.onSurfaceVariant, fontSize: t.fs.body },
    label: { color: r.onSurfaceVariant, fontSize: t.fs.label },
    labelOn: { color: r.onSurface, fontSize: t.fs.label },
    caption: { color: r.onSurfaceVariant, fontSize: t.fs.caption },
    weak: { color: r.outline, fontSize: t.fs.caption },
    tiny: { color: r.outline, fontSize: t.fs.tiny },
    accent: { color: r.primary, fontSize: t.fs.body },
    accentSm: { color: r.primary, fontSize: t.fs.label },
    accentTitle: { color: r.primary, fontSize: t.fs.title },
    onAccent: { color: r.onPrimary, fontSize: t.fs.body },
    onAccentSm: { color: r.onPrimary, fontSize: t.fs.label },
    onAccentC: { color: r.onPrimaryContainer, fontSize: t.fs.label },
    err: { color: r.error, fontSize: t.fs.body }
  }

  // 动效开关 (关闭后页面不挂过渡/动画)
  t.motion = c.motion

  // 导航位置: left = M3 NavigationRail (88x266), top = 旧顶部横排 (960x44)
  t.navPos = c.navPos
  t.navW = c.navPos === 'left' ? 88 : 0
  t.navH = c.navPos === 'top' ? 44 : 0
  t.mainW = c.navPos === 'left' ? 872 : 960
  t.mainH = c.navPos === 'left' ? 266 : 222

  // 明暗 (供 <image> 选图标用: 浅色底要深色图标)
  t.dark = resolveMode(c) === 'dark'

  return t
}

// 在给定底色上应该用浅字还是深字 (WCAG 相对亮度; 选主题色时打勾图标要用它).
// 不能用 onPrimary: 那是"主题派生色 vs 它自己的前景", 而色板展示的是**种子原色**.
export function readableOn(hex) {
  var h = String(hex || '#000000').replace('#', '')
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2)
  var n = parseInt(h, 16)
  var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  function lin(v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.45 ? '#16181c' : '#ffffff'
}

// rgba 工具: 需要半透明叠层时用 (例: 遮罩)
export function hexA(hex, alpha) {
  var h = String(hex || '#000000').replace('#', '')
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2)
  var n = parseInt(h, 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')'
}
