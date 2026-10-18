// 页面样式工厂 —— 所有页面从 tokens 取样式, 不写死颜色
//
// 为什么集中: 笔上没有 CSS 变量, 主题切换只能靠"重算一整套内联 style".
// 页面如果各自写 #fb7299, 主题就换不动了. 这里把"语义角色 -> 内联样式对象"收敛成一个函数,
// 页面只写 :style="T.card" 这种.
import { palette, TYPE, SPACE, SPEC, SCREEN } from './tokens.js'
import { getCfg } from '../core/config.js'

/** 圆角档位: 与 PiliNara 的 flat/std/round 对齐 (基准 10) */
export function radii(style) {
  const base = style === 'flat' ? 4 : (style === 'round' ? 16 : SPEC.radius)
  return {
    card: base,
    chip: Math.round(base * 1.6),
    btn: Math.round(base * 2.2),
    sheet: SPEC.radiusLarge,
    menu: SPEC.radiusMenu
  }
}

/** 字号档位 */
export function fonts(scale) {
  const k = scale === 'sm' ? 0.9 : (scale === 'lg' ? 1.15 : 1)
  const f = (n) => Math.round(n * k)
  return { title: f(TYPE.title), subtitle: f(TYPE.subtitle), body: f(TYPE.body), caption: f(TYPE.caption), tiny: f(TYPE.tiny) }
}

/** 列表密度: 影响行高与封面尺寸 */
export function density(d) {
  if (d === 'compact') return { row: 84, cover: 148, gap: 6 }
  if (d === 'cozy') return { row: 116, cover: 208, gap: 12 }
  return { row: 100, cover: 176, gap: SPACE.sm }
}

/**
 * 取当前主题的完整样式包.
 * 返回 { c: 语义色, t: 文字样式, rad, sp, den, dark }
 */
export function ui() {
  const dark = getCfg('themeMode') === 'dark'
  const pure = getCfg('pureBlack') === true
  const c = palette(getCfg('themeSeed'), dark)
  if (pure && dark) {
    c.surface = '#000000'
    c.surfaceContainerLowest = '#000000'
    c.surfaceContainerLow = '#0a0a0a'
    c.surfaceContainer = '#111111'
    c.surfaceContainerHigh = '#181818'
    c.surfaceContainerHighest = '#202020'
  }
  const f = fonts(getCfg('fontScale'))
  const rad = radii(getCfg('radiusStyle'))
  const t = {
    title: { fontSize: f.title + 'px', color: c.onSurface },
    subtitle: { fontSize: f.subtitle + 'px', color: c.onSurface },
    body: { fontSize: f.body + 'px', color: c.onSurface },
    weak: { fontSize: f.caption + 'px', color: c.onSurfaceVariant },
    caption: { fontSize: f.caption + 'px', color: c.onSurfaceVariant },
    tiny: { fontSize: f.tiny + 'px', color: c.onSurfaceVariant },
    onPrimary: { fontSize: f.body + 'px', color: c.onPrimary },
    onAccent: { fontSize: f.caption + 'px', color: c.onPrimaryContainer },
    accent: { fontSize: f.body + 'px', color: c.primary }
  }
  return {
    dark,
    c,
    t,
    f,
    rad,
    sp: SPACE,
    den: density(getCfg('density')),
    seg: SCREEN,
    // ---- 常用容器 (直接 :style="U.page") ----
    page: { width: SCREEN.width + 'px', height: SCREEN.height + 'px', backgroundColor: c.surface },
    bar: { backgroundColor: c.surfaceContainer, height: SCREEN.topBar + 'px', width: SCREEN.width + 'px' },
    card: { backgroundColor: c.surfaceContainerLow, borderRadius: rad.card + 'px' },
    cardHi: { backgroundColor: c.surfaceContainer, borderRadius: rad.card + 'px' },
    inset: { backgroundColor: c.surfaceContainerHighest, borderRadius: rad.chip + 'px' },
    action: { backgroundColor: c.surfaceContainerHighest, borderRadius: rad.btn + 'px' },
    primary: { backgroundColor: c.primary, borderRadius: rad.btn + 'px' },
    chip: { backgroundColor: c.primaryContainer, borderRadius: rad.chip + 'px' },
    divider: { height: '1px', backgroundColor: c.outlineVariant }
  }
}
