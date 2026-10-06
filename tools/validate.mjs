// 静态体检: 图标引用 / 事件处理函数 / script 语法 / 补丁标记混入 / 生命周期位置 / 九宫格列数
// 由 .local/patch/validate.mjs 同步而来 (CI 只提交 tools/, 所以两份都要在)
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 路径自相对: 本地 (.local/patch 副本) 与 CI (tools/ 副本) 都能跑同一个文件
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', 'ui', 'src')
const PAGES = ROOT + '/pages'
const miDir = ROOT + '/assets/mi'
const have = new Set(fs.readdirSync(miDir))
const files = []
for (const d of fs.readdirSync(PAGES)) {
  const p = path.join(PAGES, d, d + '.vue')
  if (fs.existsSync(p)) files.push(p)
}
let bad = 0
const fail = (m) => { console.log('BAD  ' + m); bad++ }
const GLYPH = /[‹›▶⟳✓«»❚▾⌂]/
const tmp = path.join(HERE, '..', '..', '.local', 'patch', '_check.mjs')
for (const p of files) {
  const rel = path.basename(p)
  const src = fs.readFileSync(p, 'utf8')
  const tpl = (src.match(/<template>([\s\S]*?)<\/template>\s*\n\s*<script>/) || [null, src])[1]
  src.split(/\r?\n/).forEach((ln, i) => { if (GLYPH.test(ln)) fail(rel + ':' + (i + 1) + ' 残留字符图标 -> ' + ln.trim().slice(0, 80)) })
  // 源文件里绝不允许出现补丁文件的标记行 (0.9.58 教训: P1 补丁手滑写成 "--- FILE:",
  // 后半段补丁文本被当成 NEW 写进 page.vue, 模板里因此长出一颗真实可点的「评论」入口)
  src.split(/\r?\n/).forEach((ln, i) => { if (/^(?:===+|---) (?:FILE|OLD|NEW)\b/.test(ln.trim())) fail(rel + ':' + (i + 1) + ' 源文件混入补丁标记 -> ' + ln.trim().slice(0, 60)) })
  let m
  const reMI = /require\('\.\.\/\.\.\/assets\/mi\/([^']+)'\)/g
  while ((m = reMI.exec(src)) !== null) if (!have.has(m[1])) fail(rel + ' 引用不存在的图标 ' + m[1])
  if (!/const MI = \{/.test(src)) continue
  if (/MI\./.test(tpl) && !/const MI = \{/.test(src)) fail(rel + ' 模板用了 MI 但脚本没定义')
  const used = new Set()
  const reEv = /@(?:click|load|scroll|touchstart|touchmove|touchend)="([A-Za-z_$][\w$]*)\s*\(/g
  while ((m = reEv.exec(tpl)) !== null) used.add(m[1])
  for (const fn of used) {
    const re1 = new RegExp('(^|[\\s,{])' + fn + '\\s*\\(', 'm')
    const re2 = new RegExp('(^|[\\s,{])' + fn + '\\s*:', 'm')
    if (!re1.test(src) && !re2.test(src)) fail(rel + ' 事件处理函数未定义: ' + fn)
  }
  const sm = src.match(/<script>([\s\S]*?)<\/script>/)
  if (!sm) { fail(rel + ' 缺少 script 块'); continue }
  fs.writeFileSync(tmp, sm[1], 'utf8')
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }) } catch (e) { fail(rel + ' script 语法错误: ' + String(e.stderr).slice(0, 300)) }
}
for (const f of files.concat([ROOT + '/app.json'])) {
  const s = fs.readFileSync(f, 'utf8')
  if (/from 'imageviewer'/.test(s)) fail(path.basename(f) + ' 仍引用 imageviewer')
  if (/navTo\('comment'/.test(s)) fail(path.basename(f) + " 仍 navTo('comment')")
}
// 全量扫一遍 ui/src: 任何源文件含补丁标记都算失败 (上面只覆盖 pages/)
;(function walk (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!/\.(vue|js)$/.test(e.name)) continue
    const s = fs.readFileSync(p, 'utf8').split(/\r?\n/)
    for (let i = 0; i < s.length; i++) if (/^(?:===+|---) (?:FILE|OLD|NEW)\b/.test(s[i].trim())) fail(path.relative(ROOT, p) + ':' + (i + 1) + ' 源文件混入补丁标记')
  }
})(ROOT)   // ROOT 本身就是 ui/src
// 组件结构体检 (0.9.61 踩过): 一次补丁把 up.vue 的 "methods: {" 整个换成了 "computed: {",
// 于是全部方法变成计算属性 —— onShow 被当 getter 执行(日志照打), 然后 this.beginLoad()
// 调 undefined 抛错, 框架把页面弹掉, 现象是「点进去立刻退出/只放关闭动画」.
// node --check 查不出这种错(语法合法), 所以在这里断言:
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const rel2 = path.relative(ROOT, f).replace(/\\/g, '/')
  if (!/methods:\s*\{/.test(src)) { fail(rel2 + ' 缺少 methods: { 块 (方法会被当成计算属性)'); continue }
  const mi = src.search(/methods:\s*\{/)
  for (const life of ['onShow(', 'onUnload(', 'onNewOptions(']) {
    const li = src.indexOf(life)
    if (li >= 0 && li < mi) fail(rel2 + ' 的 ' + life + ' 出现在 methods 之外 (生命周期不会被调用)')
  }
}
// 九宫格列数必须来自共享常量 (0.9.59 踩过: GRID_CELL 从 288 改到 200, 而页面里的
// chunk(pics, 3) 列数还是硬编码 3 -> 3 列 × 200px 只占 618px, 右边一大片空白)
for (const rel of ['pages/feed/feed.vue', 'pages/dyn/dyn.vue']) {
  const f = ROOT + '/' + rel
  if (!fs.existsSync(f)) { fail(rel + ' 不存在'); continue }
  const s = fs.readFileSync(f, 'utf8')
  if (!/GRID_COLS/.test(s)) fail(rel + ' 未使用共享的 GRID_COLS (九宫格列数会与 GRID_CELL 漂移)')
}
console.log(bad === 0 ? 'VALIDATE PASSED (' + files.length + ' pages, ' + have.size + ' icons)' : bad + ' 个问题')