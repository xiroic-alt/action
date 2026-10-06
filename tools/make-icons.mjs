#!/usr/bin/env node
/**
 * 图标产线: 从 material-icons-svg (Google 官方 @material-symbols/svg-400 离线副本)
 * 生成 miniapp 可直接 require 的 PNG 图标 (ui/src/assets/mi/).
 *
 * 为什么要转 PNG 而不是直接引 SVG:
 *   本机 <image> 走 mini-glide 解码 (实测只吃 png/jpg 一类位图), SVG 不保证能渲染;
 *   且 aiot-cli 的两条构建链对 .svg 的处理不一致. PNG 是已经在设备上验证过的路子
 *   (assets/emoji/*.png 就是这么用的), 所以这里统一在构建前把 SVG 光栅化.
 *
 * SVG 是单 path / 无 fill 的形态 -> 在根节点注入 fill 与 width/height 即可任意着色与定尺,
 * 渲染即最终尺寸, 不做二次重采样.
 *
 * 用法 (本地一次性生成, 产物入库):
 *   node tools/make-icons.mjs                # 写入 ui/src/assets/mi
 *   node tools/make-icons.mjs --dry          # 只检查图标是否存在, 不写文件
 * 依赖 sharp (仅本地产线用, 不进 miniapp 依赖):
 *   npm --prefix ../../.local/svg2png i sharp
 *   NODE_PATH=../../.local/svg2png/node_modules node tools/make-icons.mjs
 *
 * 许可: 图标来自 Google Material Symbols / Material Icons, Apache-2.0 (见 material-icons-svg/LICENSE-APACHE-2.0.txt)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..', '..')                  // D:/share-files/AI/bilibilipan
const SRC = path.join(REPO, 'material-icons-svg', 'material-symbols', 'rounded')
const OUT = path.join(__dirname, '..', 'ui', 'src', 'assets', 'mi')
const DRY = process.argv.indexOf('--dry') >= 0

// 统一色板 (与 ui 里现有配色一致): w 白 / p B站粉 / m 次要灰 / d 深底 / g 浅灰
// y 个人认证黄: 官方 App 的认证徽章底色 (#FFAC2C), 只有认证图标用
// d = 深色主题底(近黑), dm = 浅色主题的次要灰 (m 的浅底版本, 对比度够用)
const COLORS = { w: '#ffffff', p: '#fb7299', m: '#8a94a6', d: '#16181c', dm: '#5b6472', g: '#c8d2de', y: '#ffac2c' }

// file: 产物名(ui 里 require 的名字) / icon: material-symbols 文件名 / size: 显示尺寸(px) / color: 色板键
const ICONS = [
  { file: 'back_26_w', icon: 'arrow_back_ios', size: 26, color: 'w' },   // ‹ 返回
  { file: 'home_30_w', icon: 'home-fill', size: 30, color: 'w' },        // ⌂ 首页
  { file: 'refresh_30_w', icon: 'refresh', size: 30, color: 'w' },       // ⟳ 刷新
  { file: 'play_18_w', icon: 'play_arrow-fill', size: 18, color: 'w' },  // 列表播放量前缀
  { file: 'play_28_w', icon: 'play_arrow-fill', size: 28, color: 'w' },  // 播放按钮
  { file: 'play_46_w', icon: 'play_arrow-fill', size: 46, color: 'w' },  // 播放器大按钮
  { file: 'pause_46_w', icon: 'pause-fill', size: 46, color: 'w' },
  { file: 'pause_28_w', icon: 'pause-fill', size: 28, color: 'w' },
  { file: 'replay10_28_w', icon: 'replay_10-fill', size: 28, color: 'w' },
  { file: 'forward10_28_w', icon: 'forward_10-fill', size: 28, color: 'w' },
  { file: 'check_44_w', icon: 'check', size: 44, color: 'w' },
  { file: 'check_56_w', icon: 'check', size: 56, color: 'w' },      // 播放器暂停
  { file: 'replay10_34_w', icon: 'replay_10-fill', size: 34, color: 'w' },
  { file: 'forward10_34_w', icon: 'forward_10-fill', size: 34, color: 'w' },
  { file: 'check_20_p', icon: 'check', size: 20, color: 'p' },           // 已赞/已藏 (高亮态)
  { file: 'check_20_w', icon: 'check', size: 20, color: 'w' },           // 操作成功提示
  { file: 'add_32_w', icon: 'add', size: 32, color: 'w' },               // ＋ 放大
  { file: 'remove_32_w', icon: 'remove', size: 32, color: 'w' },         // − 缩小
  { file: 'chevron_20_m', icon: 'chevron_right', size: 20, color: 'm' }, // › 进入
  { file: 'expand_20_m', icon: 'keyboard_arrow_down', size: 20, color: 'm' }, // ▾ 展开
  { file: 'thumbup_20_m', icon: 'thumb_up', size: 20, color: 'm' },      // 评论赞(未赞)
  { file: 'thumbup_20_p', icon: 'thumb_up-fill', size: 20, color: 'p' }, // 评论赞(已赞)
  { file: 'reply_20_m', icon: 'reply', size: 20, color: 'm' },           // 回复
  { file: 'image_20_m', icon: 'image', size: 20, color: 'm' },           // 图 N
  { file: 'comment_20_m', icon: 'comment', size: 20, color: 'm' },       // 评论数
  { file: 'share_20_m', icon: 'share', size: 20, color: 'm' },           // 转发数
  // 认证徽章: 官方样式是「彩色圆底 + 白闪电」, 所以图标本身只要一个白闪电,
  // 黄标(个人认证)/蓝标(机构认证) 由页面上那层圆底的背景色区分
  { file: 'bolt_16_w', icon: 'electric_bolt-fill', size: 16, color: 'w' },
  { file: 'star_20_m', icon: 'star', size: 20, color: 'm' },             // 特别关注(未设置)
  { file: 'star_20_p', icon: 'star-fill', size: 20, color: 'p' },        // 特别关注(已设置)
  { file: 'folder_20_m', icon: 'folder', size: 20, color: 'm' },         // 关注分组
  { file: 'alert_20_m', icon: 'error', size: 20, color: 'm' },           // 警示标识(视频争议提示)
  { file: 'person_20_m', icon: 'person', size: 20, color: 'm' }          // 我的关注
]

// ---- 需要成对产出 (深色底用白 / 浅色底用近黑) 的图标 ----
// M3 主题是运行时可切换的, 但 <image> 只能吃位图 (本机 mini-glide 不解 SVG),
// 颜色烘进 PNG 就固定了. 解法: 每颗图标出 w/d 两个色版, 页面按当前明暗选一个,
// 于是"图标颜色"跟着主题走而不需要 8 种子 x 2 明暗 = 16 份产物.
const PAIRS = [
  // 导航栏 (M3 NavigationRail) — 26px
  { name: 'nav_home', icon: 'home-fill', size: 26 },
  { name: 'nav_hot', icon: 'whatshot-fill', size: 26 },
  { name: 'nav_search', icon: 'search', size: 26 },
  { name: 'nav_dyn', icon: 'dynamic_feed-fill', size: 26 },
  { name: 'nav_mine', icon: 'person-fill', size: 26 },
  { name: 'nav_more', icon: 'apps', size: 26 },
  // 导航栏底部动作 / 通用动作 — 24px
  { name: 'act_refresh', icon: 'refresh', size: 24 },
  { name: 'act_close', icon: 'close', size: 24 },
  { name: 'act_check', icon: 'check', size: 24 },
  { name: 'act_play', icon: 'play_circle-fill', size: 24 },
  // 设置分组前导图标 — 22px
  { name: 'set_appearance', icon: 'palette', size: 22 },
  { name: 'set_play', icon: 'play_circle-fill', size: 22 },
  { name: 'set_line', icon: 'alt_route', size: 22 },
  { name: 'set_net', icon: 'network_check', size: 22 },
  { name: 'set_content', icon: 'tune', size: 22 },
  { name: 'set_data', icon: 'database', size: 22 },
  { name: 'set_account', icon: 'account_circle', size: 22 },
  { name: 'set_about', icon: 'info', size: 22 },
  { name: 'set_live', icon: 'live_tv', size: 22 },
  { name: 'set_msg', icon: 'notifications-fill', size: 22 },
  { name: 'set_speed', icon: 'speed', size: 22 },
  // 单选项 (设置页的 radio 语义)
  { name: 'opt_on', icon: 'radio_button_checked', size: 20 },
  { name: 'opt_off', icon: 'radio_button_unchecked', size: 20 },
  // 「我的」页入口
  { name: 'my_history', icon: 'history', size: 22 },
  { name: 'my_fav', icon: 'bookmark-fill', size: 22 },
  { name: 'my_toview', icon: 'schedule', size: 22 },
  { name: 'my_follow', icon: 'person-fill', size: 22 }
]

const require_ = createRequire(import.meta.url)
let sharp
try {
  sharp = require_('sharp')
} catch (e) {
  try { sharp = require_(path.join(REPO, '.local', 'svg2png', 'node_modules', 'sharp')) } catch (e2) {
    console.error('缺少 sharp: npm --prefix .local/svg2png i sharp'); process.exit(2)
  }
}

if (!DRY && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

// 展开成对的图标 (w=白 给深色主题, d=近黑 给浅色主题)
const EXPANDED = ICONS.slice()
for (const p of PAIRS) {
  EXPANDED.push({ file: p.name + '_w', icon: p.icon, size: p.size, color: 'w' })
  EXPANDED.push({ file: p.name + '_d', icon: p.icon, size: p.size, color: 'd' })
}

// 浅色主题自动派生: 把每颗 _w / _m 图标再出一份浅底可读的版本.
// 页面侧约定: MI 用 _w/_m (深色主题), MI_D 是同一套键换成 _d/_dm (浅色主题),
// 模板只引用 MIc.xxx 由 computed 按当前明暗二选一 —— 这样"图标颜色"也跟着主题走,
// 而 <image> 只能吃位图、颜色烘死在 PNG 里, 只能靠"两版产物 + 运行时选一版".
for (const it of EXPANDED.slice()) {
  const m = /^(.*)_(w|m)$/.exec(it.file)
  if (!m) continue
  EXPANDED.push({ file: m[1] + (m[2] === 'w' ? '_d' : '_dm'), icon: it.icon, size: it.size, color: (m[2] === 'w' ? 'd' : 'dm') })
}

let ok = 0, bad = []
for (const it of EXPANDED) {
  const src = path.join(SRC, it.icon + '.svg')
  if (!fs.existsSync(src)) { bad.push(it.icon); continue }
  const out = path.join(OUT, it.file + '.png')
  if (DRY) { ok++; console.log('OK   ' + it.file + '  <=  ' + it.icon + '.svg'); continue }
  // 单 path 无 fill: 在根 svg 注入 fill + 精确宽高 (librsvg 按注入尺寸直接渲染, 不重采样)
  let svg = fs.readFileSync(src, 'utf8')
  // 根节点自带 width/height, 直接追加会 XML 报「Attribute height redefined」-> 先剥掉再注入
  svg = svg.replace(/<svg([^>]*)>/, function (m, attrs) {
    const a = attrs.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '').replace(/\sfill="[^"]*"/, '')
    return '<svg' + a + ' width="' + it.size + '" height="' + it.size + '" fill="' + COLORS[it.color] + '">'
  })
  await sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toFile(out)
  ok++
}
console.log('生成 ' + ok + ' 个 PNG -> ' + path.relative(REPO, OUT))
if (bad.length) { console.error('缺图标(检查 material-symbols 名字): ' + bad.join(', ')); process.exit(1) }
