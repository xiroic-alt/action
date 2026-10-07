// 静态体检: 图标引用 / 事件处理函数 / script 语法 / 补丁标记混入 / 生命周期位置 / 九宫格列数
// 由 .local/patch/validate.mjs 同步而来 (CI 只提交 tools/, 所以两份都要在)
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

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
// 语法检查的临时文件必须写到系统临时目录: CI 上没有 .local/ (它被 gitignore),
// 写到仓库里会 ENOENT 直接让构建失败.
const tmp = path.join(os.tmpdir(), 'bilibilipan-validate-check.mjs')
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
  // <text> 里嵌 <span>/<image> 等子元素: 本机只有 <richtext> 支持内联子节点.
  // 写错的后果不是"样式不对", 而是**整个应用进程被干掉** (0.9.62 lines 页实测:
  // miniapp_cli start 后 start failed, App 从 memoryApp 里消失).
  {
    const reText = /<text\b[^>]*>([\s\S]*?)<\/text>/g
    let tm
    while ((tm = reText.exec(tpl)) !== null) {
      if (/<(span|image|richtext)\b/.test(tm[1])) {
        fail(rel + ' <text> 里嵌了内联子元素 (只有 <richtext> 支持): ' + tm[1].slice(0, 40))
        break
      }
    }
  }

  // 模板里裸调"import 进来的函数"会在渲染期炸整页 (0.9.62 settings 页 Elm=0 的真因):
  // Vue 模板只能访问**实例上的**属性 —— 方法/计算属性/data. 这里把每个模板调用名
  // 拿出来, 如果它在 import 列表里出现, 就判失败.
  const imported = new Set()
  const reImp = /import\s+(?:\*\s+as\s+([\w$]+)|\{([^}]*)\}|([\w$]+))\s+from/g
  let im
  while ((im = reImp.exec(src)) !== null) {
    if (im[1]) imported.add(im[1])
    if (im[2]) im[2].split(',').forEach((x) => { const n = x.split(' as ').pop().trim(); if (n) imported.add(n) })
    if (im[3]) imported.add(im[3])
  }
  const called = new Set()
  const reCall = /[:@][\w:.-]+="\s*([A-Za-z_$][\w$]*)\s*\(/g
  let cm
  while ((cm = reCall.exec(tpl)) !== null) called.add(cm[1])
  for (const fn of called) {
    if (imported.has(fn)) fail(rel + ' 模板里裸调 import 进来的 ' + fn + '() —— 必须包成 methods 里的方法')
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
// ---- 详情页副本环: 副本必须是生成器输出, 且每个环位都在 app.json 里登记 ----
// 背景: 固件对同名页 navTo 只替换不入栈, 所以"详情套详情"要靠换页面名 (见
// ui/src/services/detail-ring.js). 副本文件是**生成产物** —— 手改一份就漂移,
// 这条门禁负责在烧 CI 之前拦住.
try {
  execFileSync(process.execPath, [path.join(HERE, 'gen-detail-ring.mjs'), '--check'], { stdio: 'pipe', encoding: 'utf8' })
  const ringSrc = fs.readFileSync(ROOT + '/services/detail-ring.js', 'utf8')
  const ring = (ringSrc.match(/'page[0-9]*'/g) || []).map((s) => s.split(String.fromCharCode(39)).join(''))
  const appJson = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'ui', 'src', 'app.json'), 'utf8'))
  for (const nm of ring) {
    if (!appJson.pages || appJson.pages[nm] === undefined) fail('详情环位 ' + nm + ' 没有在 app.json 里登记')
  }
  if (ring.length < 2) fail('详情环至少要两个环位, 否则详情套详情仍然入不了栈')
} catch (e) {
  fail('详情页副本与生成器输出不一致 (跑 node tools/gen-detail-ring.mjs) -> ' + String(e.stdout || e.message || e).slice(0, 160))
}
console.log(bad === 0 ? 'VALIDATE PASSED (' + files.length + ' pages, ' + have.size + ' icons)' : bad + ' 个问题')