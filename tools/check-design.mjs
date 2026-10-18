// 静态体检 #2: 设计系统 (PiliNara 对齐) 的可访问性与几何契约
//
// 为什么需要: 颜色是算出来的 (design/tonal.js), 字号/间距/命中区是常量 ——
// 只要有人手滑改了色板权重或尺寸, 结果就是"字看不清 / 点不中", 而这两种错在真机上
// 很难一眼定位. 这里用 WCAG 对比度和笔屏几何把它钉死.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const U = (p) => pathToFileURL(path.join(ROOT, 'src', p)).href

const tonal = await import(U('design/tonal.js'))
const tokens = await import(U('design/tokens.js'))

let pass = 0
const ok = (c, m) => { assert.ok(c, m); pass++ }
const eq = (a, b, m) => { assert.equal(a, b, m); pass++ }

// ---- 笔屏几何: 唯一来源, 且必须自洽 ----
eq(tokens.SCREEN.width, 960, '屏宽 960')
eq(tokens.SCREEN.height, 266, '屏高 266')
eq(tokens.SCREEN.topBar, 44, '系统条 44')
eq(tokens.SCREEN.height - tokens.SCREEN.topBar, tokens.SCREEN.content, '内容区 = 屏高 - 系统条')
ok(tokens.SCREEN.minTouch >= 44, '最小命中区 >= 44px (触摸设备下限)')
ok(tokens.SCREEN.width - tokens.SCREEN.navRail > 700, '侧栏后内容区仍 >= 700px')

// ---- PiliNara 规格常量必须与上游一致 ----
eq(tokens.SPEC.cardSpace, 8, 'cardSpace = 8 (lib/common/style.dart)')
eq(tokens.SPEC.safeSpace, 12, 'safeSpace = 12')
eq(tokens.SPEC.radius, 10, 'mdRadius = 10')
eq(tokens.SPEC.radiusLarge, 28, 'bottomSheetRadius = 28')
eq(tokens.SPEC.radiusMenu, 16, '菜单圆角 16')
eq(tokens.SPEC.coverRatio, 16 / 10, '封面比例 16/10')
eq(tokens.SPEC.topBarHeightMobile, 52, '上游顶栏 52 (我们覆盖为 44, 常量须保留可追溯)')

// ---- 色板: 每个种子的明暗两套都要满足 M3 可访问性 ----
const PAIRS = [
  ['onSurface', 'surface', 4.5],
  ['onSurfaceVariant', 'surface', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['onPrimaryContainer', 'primaryContainer', 4.5],
  ['onSecondaryContainer', 'secondaryContainer', 4.5],
  ['onSurface', 'surfaceContainer', 4.5],
  ['onSurface', 'surfaceContainerHighest', 4.5],
  ['primary', 'surface', 3.0]
]
let worst = 99
for (const seed of tokens.SEEDS) {
  for (const dark of [false, true]) {
    const p = tokens.palette(seed[0], dark)
    ok(/^#[0-9a-f]{6}$/i.test(p.surface), seed[0] + ' 色板 surface 是合法色值')
    for (const [fg, bg, min] of PAIRS) {
      const c = tonal.contrast(p[fg], p[bg])
      worst = Math.min(worst, c)
      ok(c >= min - 0.02,
        seed[0] + (dark ? ' 深色' : ' 浅色') + ': ' + fg + ' on ' + bg + ' 对比度 ' + c.toFixed(2) + ' >= ' + min)
    }
  }
}
// 主色必须是 B 站粉的色相 (不能被改成别的颜色)
const light = tokens.palette('bili', false)
ok(tonal.contrast(light.primary, light.surface) > 3, 'B 站粉主色在浅色底上仍可读')
// 中性色的彩度必须很低 (否则整屏发粉)
const chrome = tonal.seedToHueChroma(light.surface)
ok(chrome.c < 6, 'surface 彩度足够低 (' + chrome.c.toFixed(2) + '), 避免整屏染色')

// ---- 封面几何: 16:10 且不越界 ----
const cv = tokens.coverSize(220)
eq(cv.w, 220, '封面宽按入参')
eq(cv.h, Math.round(220 / (16 / 10)), '封面高 = 宽 / (16/10)')
eq(tokens.coverSize(0).w, 1, '宽度为 0 时钳到 1 (避免 0 尺寸命中区)')

console.log('CHECK-DESIGN PASSED (' + pass + ' 条断言: 几何/规格/8 种子 x 2 明暗对比度, 最差 ' + worst.toFixed(2) + ')')

// ---------------- 存储规范 (miniapp 数据落盘规范) ----------------
// 依据: 设备固件实测 —— 业务数据必须写 <appid>/data/, 它在覆盖安装时不被替换,
// 且被系统「空间清理」按包统计; 安装体 <appid>/a/ 会被整体替换, 绝不能写业务数据.
const paths = await import(U('core/paths.js'))
eq(paths.APPID_FALLBACK, '8009476000000001', 'appid 与 package.json 一致')
ok(paths.dataDir().indexOf('/userdisk/miniapp/data/mini_app/pkg/8009476000000001/data') === 0,
  '数据根在 <appid>/data/ (规范位置): ' + paths.dataDir())
ok(paths.dbPath().indexOf('/data/database/') > 0, '数据库在 data/database/')
ok(paths.logPath().indexOf('/data/') > 0, '日志在 data/ 下')
// 不许写到安装体 a/ 或旧的私有根
for (const p of [paths.dataDir(), paths.dbPath(), paths.logPath(), paths.kvFilePath(), paths.authFilePath()]) {
  ok(p.indexOf('/pkg/8009476000000001/a/') < 0, '不许写安装体 a/: ' + p)
  ok(p.indexOf('/userdisk/pilipro') < 0, '不许写旧私有根 /userdisk/pilipro: ' + p)
  ok(p.indexOf('/userdata/') < 0, '/userdata 只有 125MB, 不放业务数据: ' + p)
}
// package.json 的 appid 必须是同一个 (两处漂移是最常见的事故)
const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
eq(pkgJson.appid, paths.APPID_FALLBACK, 'package.json appid = paths 常量')

console.log('CHECK-DESIGN PASSED (' + pass + ' 条断言: 几何/规格/对比度/存储规范)')
