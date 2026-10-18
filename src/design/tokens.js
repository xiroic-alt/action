// PiliPRO 设计 token —— 规格取自 PiliNara 源码 (不靠目测)
//
// 出处 (Starfallan/PiliNara, 仓库内 lib/):
//   lib/common/style.dart    cardSpace=8.0  safeSpace=12.0  mdRadius=10  imgRadius=10
//                            aspectRatio=16/10  topBarHeight=52  bottomSheetRadius=28
//                            dialog 宽 420  imgMaxRatio=2.6
//   lib/utils/theme_utils.dart  useMaterial3=true; AppBar elevation=0 / titleSpacing=0 /
//                            centerTitle=false / 标题 16px; SnackBar elevation=20 +
//                            secondaryContainer 底 + onSecondaryContainer 字;
//                            PopupMenu 圆角 16 / menuPadding 4 / 标签 14px w500
//
// 笔屏约束 (设备实测, 见 HANDOVER §3): 逻辑 960x266, 顶部条 44px, 内容区只有 222px;
// 没有 CSS 自定义属性; transition 只支持 transform; 点击必须挂在有尺寸的元素上.
// => 所以 token 分两层: **PiliNara 的规格比例**(8/12/10/16:10) + **笔屏的物理尺寸**(44/222/960).
//    手机上的 52px 顶栏在这里必须压到 44px, 否则内容区只剩 214px.

import { seedToHueChroma, toneColor, contrast } from './tonal.js'

/** PiliNara 的原始规格常量 (单位与 Flutter 逻辑像素一致, 便于对照上游) */
export const SPEC = {
  cardSpace: 8,
  safeSpace: 12,
  radius: 10,
  radiusLarge: 28,
  radiusMenu: 16,
  coverRatio: 16 / 10,
  coverRatio16x9: 16 / 9,
  topBarHeightMobile: 52
}

/** 笔屏几何 (唯一来源; 页面不得再写死数字) */
export const SCREEN = {
  width: 960,
  height: 266,
  topBar: 44,
  navRail: 84,
  content: 222,
  // 触摸命中区下限: 手指 + 笔屏像素密度决定 44px 才稳 (实测小命中区经常点不中)
  minTouch: 44
}

export const SEEDS = [
  ['bili', '#FB7299', 'B站粉'],
  ['blue', '#3D7EFF', '蓝'],
  ['teal', '#00B3A4', '青'],
  ['green', '#2E9E5B', '绿'],
  ['amber', '#F2A03D', '琥珀'],
  ['violet', '#9C6BFF', '紫'],
  ['red', '#F2544B', '红'],
  ['slate', '#6B7280', '灰']
]

// 语义角色 -> tone 映射 (M3 标准映射表; light/dark 各一套)
const ROLES = {
  light: {
    primary: 40, onPrimary: 100, primaryContainer: 90, onPrimaryContainer: 10,
    secondary: 40, onSecondary: 100, secondaryContainer: 90, onSecondaryContainer: 10,
    tertiary: 40, onTertiary: 100, tertiaryContainer: 90, onTertiaryContainer: 10,
    error: 40, onError: 100, errorContainer: 90, onErrorContainer: 10,
    surface: 98, onSurface: 10, surfaceVariant: 90, onSurfaceVariant: 30,
    surfaceContainerLowest: 100, surfaceContainerLow: 96, surfaceContainer: 94,
    surfaceContainerHigh: 92, surfaceContainerHighest: 90,
    outline: 50, outlineVariant: 80, inverseSurface: 20, inverseOnSurface: 95, inversePrimary: 80, shadow: 0
  },
  dark: {
    primary: 80, onPrimary: 20, primaryContainer: 30, onPrimaryContainer: 90,
    secondary: 80, onSecondary: 20, secondaryContainer: 30, onSecondaryContainer: 90,
    tertiary: 80, onTertiary: 20, tertiaryContainer: 30, onTertiaryContainer: 90,
    error: 80, onError: 20, errorContainer: 30, onErrorContainer: 90,
    surface: 6, onSurface: 90, surfaceVariant: 30, onSurfaceVariant: 80,
    surfaceContainerLowest: 4, surfaceContainerLow: 10, surfaceContainer: 12,
    surfaceContainerHigh: 17, surfaceContainerHighest: 22,
    outline: 60, outlineVariant: 30, inverseSurface: 90, inverseOnSurface: 20, inversePrimary: 40, shadow: 0
  }
}

// 彩度权重: 主色最饱和, 中性色几乎不染色 (否则整屏发粉, 观感廉价)
const CHROMA = {
  primary: 1, primaryContainer: 1, onPrimary: 0.4, onPrimaryContainer: 0.55, inversePrimary: 1,
  secondary: 0.45, secondaryContainer: 0.45, onSecondary: 0.25, onSecondaryContainer: 0.35,
  tertiary: 0.7, tertiaryContainer: 0.7, onTertiary: 0.3, onTertiaryContainer: 0.4,
  error: 1, errorContainer: 1, onError: 0.4, onErrorContainer: 0.5,
  surface: 0.06, surfaceContainerLowest: 0.03, surfaceContainerLow: 0.05, surfaceContainer: 0.07,
  surfaceContainerHigh: 0.09, surfaceContainerHighest: 0.12,
  onSurface: 0.08, onSurfaceVariant: 0.12, surfaceVariant: 0.10,
  outline: 0.14, outlineVariant: 0.08, inverseSurface: 0.06, inverseOnSurface: 0.06, shadow: 0.2
}

const CACHE = {}

/**
 * 取某个主题的语义色表. 结果按 (seed|dark) 缓存 —— 同一主题只会算一次.
 * @param {string} seedId  SEEDS 里的 id
 * @param {boolean} dark
 */
export function palette(seedId, dark) {
  const key = String(seedId) + '|' + (dark ? 'd' : 'l')
  if (CACHE[key]) return CACHE[key]
  let hex = SEEDS[0][1]
  for (let i = 0; i < SEEDS.length; i++) if (SEEDS[i][0] === seedId) hex = SEEDS[i][1]
  const hc = seedToHueChroma(hex)
  const map = dark ? ROLES.dark : ROLES.light
  const out = {}
  for (const role in map) {
    if (!map.hasOwnProperty(role)) continue
    const scale = CHROMA[role] == null ? 0.1 : CHROMA[role]
    out[role] = toneColor(hc, map[role], scale)
  }
  CACHE[key] = out
  return out
}

/** 文字层级的字号 (笔屏只有 222px 内容高, 比手机整体小 1-2 级) */
export const TYPE = {
  title: 16,
  subtitle: 14,
  body: 13,
  caption: 11,
  tiny: 10
}

/** 间距阶梯 = PiliNara 的 8/12 两档 + 笔屏补充的 4/16/20 */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 }

/** 视图几何: 把 PiliNara 的 16:10 封面按笔屏可用宽度算出来 (列表卡片用) */
export function coverSize(width, ratio) {
  const w = Math.max(1, Math.round(width))
  const r = ratio || SPEC.coverRatio
  return { w: w, h: Math.round(w / r) }
}

export { contrast }
