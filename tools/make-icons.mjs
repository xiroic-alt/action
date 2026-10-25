// 图标生成器 —— 从 material-symbols/rounded 光栅化 PiliPRO 需要的小图标
//
// 为什么有这步: 笔上没有字体图标 (设备字体无 emoji 字形), <image> 只能吃位图,
// 且 mini-glide 不解 SVG, 所以必须在**构建侧**把 Material 符号烘成 PNG 打进包.
//
// 色板:
//   w 白 (深色主题底上用)   d 近黑 (浅色主题底上用)   p B站粉 (选中态)
//   m 次要灰 (浅色主题)     dm 浅色主题的次要灰
//
// 运行:  node tools/make-icons.mjs        (需要 material-icons-svg 在 ../material-icons-svg)
//        node tools/make-icons.mjs --dry  (只打印清单)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
// 图标源在仓库外 (工作区共享素材), 与源码同机即可
const SRC = path.resolve(REPO, '..', 'material-icons-svg', 'material-symbols', 'rounded')
const OUT = path.join(REPO, 'src', 'assets', 'mi')
const DRY = process.argv.includes('--dry')

const COLORS = { w: '#ffffff', p: '#fb7299', m: '#8a94a6', d: '#16181c', dm: '#5b6472', g: '#c8d2de' }

// file: 产物名 / icon: material-symbols 文件名 / size: px / color: 色板键
// PiliNara 导航语义: 首页/动态/我的 (线框未选 + 实心选中), 见 nav_bar_config.dart
const ICONS = [
  // ---- 导航 (NavigationRail, 26px) ----
  { file: 'nav_home_26_w', icon: 'home-fill', size: 26, color: 'w' },
  { file: 'nav_dyn_26_w', icon: 'dynamic_feed-fill', size: 26, color: 'w' },
  { file: 'nav_mine_26_w', icon: 'person-fill', size: 26, color: 'w' },
  { file: 'nav_home_26_d', icon: 'home-fill', size: 26, color: 'd' },
  { file: 'nav_dyn_26_d', icon: 'dynamic_feed-fill', size: 26, color: 'd' },
  { file: 'nav_mine_26_d', icon: 'person-fill', size: 26, color: 'd' },
  { file: 'nav_home_26_p', icon: 'home-fill', size: 26, color: 'p' },
  { file: 'nav_dyn_26_p', icon: 'dynamic_feed-fill', size: 26, color: 'p' },
  { file: 'nav_mine_26_p', icon: 'person-fill', size: 26, color: 'p' },
  // ---- 通用动作 ----
  { file: 'back_26_w', icon: 'arrow_back_ios', size: 26, color: 'w' },
  { file: 'back_26_d', icon: 'arrow_back_ios', size: 26, color: 'd' },
  { file: 'search_24_w', icon: 'search', size: 24, color: 'w' },
  { file: 'search_24_d', icon: 'search', size: 24, color: 'd' },
  { file: 'refresh_24_w', icon: 'refresh', size: 24, color: 'w' },
  { file: 'refresh_24_d', icon: 'refresh', size: 24, color: 'd' },
  { file: 'close_24_w', icon: 'close', size: 24, color: 'w' },
  { file: 'close_24_d', icon: 'close', size: 24, color: 'd' },
  { file: 'more_24_w', icon: 'more_vert', size: 24, color: 'w' },
  { file: 'more_24_d', icon: 'more_vert', size: 24, color: 'd' },
  // ---- 播放 ----
  { file: 'play_16_w', icon: 'play_arrow-fill', size: 16, color: 'w' },
  { file: 'play_28_w', icon: 'play_arrow-fill', size: 28, color: 'w' },
  { file: 'play_46_w', icon: 'play_arrow-fill', size: 46, color: 'w' },
  { file: 'pause_46_w', icon: 'pause-fill', size: 46, color: 'w' },
  { file: 'replay10_28_w', icon: 'replay_10-fill', size: 28, color: 'w' },
  { file: 'forward10_28_w', icon: 'forward_10-fill', size: 28, color: 'w' },
  // ---- 互动 (视频详情页操作栏) ----
  { file: 'like_24_m', icon: 'thumb_up', size: 24, color: 'm' },
  { file: 'like_24_p', icon: 'thumb_up-fill', size: 24, color: 'p' },
  { file: 'coin_24_m', icon: 'paid', size: 24, color: 'm' },
  { file: 'coin_24_p', icon: 'paid', size: 24, color: 'p' },
  { file: 'fav_24_m', icon: 'bookmark', size: 24, color: 'm' },
  { file: 'fav_24_p', icon: 'bookmark-fill', size: 24, color: 'p' },
  { file: 'share_24_m', icon: 'share', size: 24, color: 'm' },
  { file: 'comment_24_m', icon: 'comment', size: 24, color: 'm' },
  // ---- 我的 ----
  { file: 'hist_24_m', icon: 'history', size: 24, color: 'm' },
  { file: 'favlist_24_m', icon: 'bookmark-fill', size: 24, color: 'm' },
  { file: 'toview_24_m', icon: 'schedule', size: 24, color: 'm' },
  { file: 'watch_24_m', icon: 'play_circle-fill', size: 24, color: 'm' },
  // ---- 认证徽章 ----
  { file: 'bolt_16_w', icon: 'electric_bolt-fill', size: 16, color: 'w' },
  { file: 'check_20_w', icon: 'check', size: 20, color: 'w' },
  { file: 'check_20_d', icon: 'check', size: 20, color: 'd' },
  { file: 'chevron_20_m', icon: 'chevron_right', size: 20, color: 'm' },
  // 详情页"看封面"动作
  { file: 'image_24_w', icon: 'image', size: 24, color: 'w' },
  { file: 'image_24_d', icon: 'image', size: 24, color: 'd' }
]

const require_ = createRequire(import.meta.url)
let sharp
try { sharp = require_('sharp') }
catch (e) {
  try { sharp = require_(path.resolve(REPO, '..', '.local', 'svg2png', 'node_modules', 'sharp')) }
  catch (e2) { console.error('缺少 sharp: npm --prefix ../.local/svg2png i sharp'); process.exit(2) }
}

if (!DRY && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

let made = 0, missing = []
for (const it of ICONS) {
  const svg = path.join(SRC, it.icon + '.svg')
  if (!fs.existsSync(svg)) { missing.push(it.icon); continue }
  const color = COLORS[it.color] || COLORS.w
  // ★ 必须把颜色写进 SVG 再光栅化.
  //   原来只算出了 color 却没用在任何地方 -> sharp 原样输出 SVG 自带的黑色,
  //   于是 47 个图标的所有变体 (_w/_d/_p) 全是纯黑, 深色主题下几乎看不见.
  //   做法: 给 <svg> 注入 fill (子路径会继承), 并把 currentColor 也替换掉.
  let svgText = fs.readFileSync(svg, 'utf8')
  svgText = svgText.replace(/currentColor/g, color)
  if (!/fill=/.test(svgText.slice(0, svgText.indexOf('>')))) {
    svgText = svgText.replace('<svg', '<svg fill="' + color + '"')
  }
  const data = 'data:image/svg+xml;base64,' + Buffer.from(svgText, 'utf8').toString('base64')
  if (DRY) { console.log(it.file + ' <- ' + it.icon + ' ' + it.size + 'px ' + color); made++; continue }
  sharp(Buffer.from(data.split(',')[1], 'base64'))
    .resize(it.size, it.size)
    .png()
    .toFile(path.join(OUT, it.file + '.png'))
    .then(() => { made++ })
    .catch((err) => { missing.push(it.icon + ': ' + err.message) })
}

if (!DRY) {
  // 等所有异步写完 (小图, 快)
  setTimeout(() => {
    console.log(made + ' 个 PNG -> ' + OUT)
    if (missing.length) { console.error('失败/缺失:', missing.slice(0, 10)); process.exit(1) }
  }, 4000)
} else {
  console.log(made + ' 个图标 (dry-run)')
}
