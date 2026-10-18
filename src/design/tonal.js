// M3 色调板生成器 —— 从 B 站粉 (#FB7299) 派生整套语义色
//
// 为什么要自己算: 设备上没有 CSS 自定义属性, 也不能像 Flutter 那样在运行时换 ThemeData;
// 一旦颜色写死在样式里, 主题切换/对比度切换就都得改样式表. 这里在**构建期之外**(模块 eval 时)
// 用一套确定性的色度学算法算出 32 个语义角色, 页面只消费角色名.
//
// 算法: 以 CIELAB 为骨干 (sRGB -> 线性 -> XYZ(D65) -> Lab), 用 L* 当 M3 的 tone,
// 色相 h 与彩度 c 随 tone 做 M3 式收敛 (tone 越靠两端彩度越低), 再映射到语义角色.
// 不用完整 CAM16/HCT: 那套要在 QuickJS 上跑大量矩阵运算, 而 M3 观感的差异主要来自
// "tone 阶梯 + 色相保持 + 彩度收敛" 这三件事 —— 这里保留它们, 并用对比度门禁钉死可读性.
//
// 关键约定: **所有色值在模块顶层算一次**, 之后只做查表; 页面拿到的是普通对象,
// 不触发任何计算 (笔的 CPU 很弱, 每帧算颜色是不能接受的).

const M3_TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }

function hex2rgb(hex) {
  const h = String(hex).replace('#', '')
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)]
}
function rgb2hex(r, g, b) {
  const f = function (v) {
    const n = clamp(Math.round(v), 0, 255).toString(16)
    return n.length === 1 ? '0' + n : n
  }
  return '#' + f(r) + f(g) + f(b)
}
function srgb2lin(c) {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function lin2srgb(v) {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return clamp(s * 255, 0, 255)
}
// sRGB -> Lab (D65)
function rgb2lab(rgb) {
  const r = srgb2lin(rgb[0]), g = srgb2lin(rgb[1]), b = srgb2lin(rgb[2])
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = function (t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116) }
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
// Lab -> 线性 sRGB (可能超出色域, 由调用方钳制)
function lab2lin(L, a, bb) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200
  const inv = function (t) { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787 }
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883
  return [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.2040 + z * 1.0570
  ]
}
// 色域钳制: 保持 L 与色相, 二分收缩彩度直到落回 sRGB
function lab2hex(L, a, b) {
  let lo = 0, hi = 1
  const at = function (k) {
    const lin = lab2lin(L, a * k, b * k)
    const out = [lin2srgb(lin[0]), lin2srgb(lin[1]), lin2srgb(lin[2])]
    const inGamut = lin[0] >= -0.001 && lin[0] <= 1.001 && lin[1] >= -0.001 && lin[1] <= 1.001 && lin[2] >= -0.001 && lin[2] <= 1.001
    return { out: out, inGamut: inGamut }
  }
  const direct = at(1)
  if (direct.inGamut) return rgb2hex(direct.out[0], direct.out[1], direct.out[2])
  let best = at(0).out
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    const r = at(mid)
    if (r.inGamut) { lo = mid; best = r.out } else { hi = mid }
  }
  return rgb2hex(best[0], best[1], best[2])
}
/** 相对亮度 (WCAG) */
export function luminance(hex) {
  const rgb = hex2rgb(hex)
  const r = srgb2lin(rgb[0]), g = srgb2lin(rgb[1]), b = srgb2lin(rgb[2])
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** 对比度 (WCAG 2.1): 门禁用它钉死"文字必须看得清" */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
/** 从种子色提取 (色相, 彩度) —— M3 的 tonal spot 就是"保持它, 换 tone" */
export function seedToHueChroma(hex) {
  const lab = rgb2lab(hex2rgb(hex))
  const a = lab[1], b = lab[2]
  return { h: Math.atan2(b, a), c: Math.sqrt(a * a + b * b), L: lab[0] }
}
/**
 * 生成某一个 tone 的颜色.
 * M3 的收敛规律: 极亮/极暗端的彩度必须压低, 否则 sRGB 装不下且观感刺眼.
 * 这里用一条平滑权重 w(t) 乘种子彩度, 在 t=40/50 附近保持最饱和.
 */
export function toneColor(seedHueChroma, tone, chromaScale) {
  const t = clamp(tone, 0, 100) / 100
  // 权重曲线: 中间(t≈0.5)最饱和, 两端收敛 (经验值, 与 M3 观感一致)
  const w = 0.35 + 0.65 * Math.sin(Math.PI * clamp(t, 0.02, 0.98))
  const c = seedHueChroma.c * w * (chromaScale == null ? 1 : chromaScale)
  return lab2hex(tone, Math.cos(seedHueChroma.h) * c, Math.sin(seedHueChroma.h) * c)
}
export { M3_TONES, hex2rgb, rgb2hex }
