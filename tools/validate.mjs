// 静态体检 #1: 语法 / 页面注册 / 资源引用 / 事件绑定 / 禁用 API
//
// 这台笔不能本地打包 (没有 aarch64 工具链), 所以语法错只能等云端 CI 才暴露.
// 本门禁在烧 CI 之前把最廉价的错误拦掉.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let problems = 0
const bad = (m) => { console.log('BAD  ' + m); problems++ }

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(path.join(ROOT, 'src'), [])
const jsFiles = files.filter((f) => f.endsWith('.js'))
const vueFiles = files.filter((f) => f.endsWith('.vue'))

// ---- 1. JS / Vue script 语法 (用 vm.Script 做真实的 ESM 语法解析) ----
// 注意: SourceTextModule 需要 --experimental-vm-modules, 所以改用 "把 import/export 换成空" 的
// 语法探针: 只验语法结构, 不验模块链接. 链接错误由 check-core 的真实 import 覆盖.
function syntaxOk(src, label) {
  const probe = src
    .replace(/^\s*import\s+[^;\n]*from\s*['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'const __d = ')
    .replace(/^\s*export\s+(async\s+)?function\s/gm, '$1function ')
    .replace(/^\s*export\s+(const|let|var|class)\s/gm, '$1 ')
    // export { a, b } from 'x' / export * from 'x' —— 整行去掉 (re-export 是模块链接, 不是语句)
    .replace(/^\s*export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^\s*export\s*\*\s*from\s*['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?/gm, '')
  try { new vm.Script(probe, { filename: label }); return true } catch (e) {
    bad(label + ' 语法错误: ' + e.message)
    return false
  }
}
for (const f of jsFiles) syntaxOk(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f))

// ---- 2. 页面注册 ----
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'app.json'), 'utf8'))
for (const [name, rel] of Object.entries(appJson.pages || {})) {
  if (!fs.existsSync(path.join(ROOT, 'src', rel))) bad('app.json 注册的页面不存在: ' + name + ' -> ' + rel)
}

// ---- 3. require 资源 ----
const pngNames = new Set()
const requireRe = /require\(['"]([^'"]+\.(?:png|jpg|jpeg|svg))['"]\)/g
for (const f of [...jsFiles, ...vueFiles]) {
  const src = fs.readFileSync(f, 'utf8')
  let m
  while ((m = requireRe.exec(src)) !== null) {
    pngNames.add(m[1])
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) bad(path.relative(ROOT, f) + ' 资源不存在: ' + m[1])
  }
}

// ---- 4. Vue: script 语法 + 事件绑定 + 图标引用 ----
for (const f of vueFiles) {
  const src = fs.readFileSync(f, 'utf8')
  const s = src.indexOf('<script>')
  const e = src.indexOf('</script>')
  if (s < 0) bad(path.relative(ROOT, f) + ' 缺 <script>')
  const script = (s >= 0 && e > s) ? src.slice(s + 8, e) : ''
  if (script) syntaxOk(script, path.relative(ROOT, f) + ' <script>')
  const tpl = src.slice(0, src.indexOf('<template>') >= 0 ? src.indexOf('</template>') : 0)

  // 事件处理函数必须在 script 里出现 (methods/computed/data 任一)
  const handlers = new Set()
  const evRe = /@(?:click|touchstart|touchend|touchmove|scroll|change|changing|state|info|position|complete|error|reselect|select|open|avatar|search)\s*=\s*"([^"(]+)\(?/g
  let m
  while ((m = evRe.exec(tpl)) !== null) handlers.add(m[1].trim())
  for (const h of handlers) {
    if (!h || h.startsWith('$')) continue
    const re = new RegExp('(?:^|[\\s{,])' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:(]', 'm')
    if (!re.test(script)) bad(path.relative(ROOT, f) + ' 事件函数未定义: ' + h)
  }
}

// ---- 5. 禁用 API (Falcon 不是浏览器) ----
// 只检查**运行时**代码; 注释里提到这些词是正常的说明
const FORBIDDEN = [
  [/\bdocument\.\w/, 'document (Falcon 没有浏览器 DOM)'],
  [/\bwindow\.\w/, 'window (Falcon 没有浏览器 window)'],
  [/(?<![.\w])localStorage\b/, 'localStorage (用 core/store.js)'],
  [/(?<![.\w])fetch\(/, 'fetch (用 core/net.js)'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest (用 core/net.js)']
]
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
for (const f of [...jsFiles, ...vueFiles]) {
  const raw = fs.readFileSync(f, 'utf8')
  const src = stripComments(raw)
  for (const [re, label] of FORBIDDEN) if (re.test(src)) bad(path.relative(ROOT, f) + ' 用了禁用的 ' + label)
}

// ---- 样式类完整性 (真机踩过: class 不在 <style> 里 = 0 尺寸 = 用户看不到) ----
for (const f of vueFiles) {
  const t = fs.readFileSync(f, 'utf8')
  const cut = t.indexOf('<script>')
  const tpl = cut > 0 ? t.slice(0, cut) : t
  const styleIdx = t.indexOf('<style')
  const style = styleIdx >= 0 ? t.slice(styleIdx) : ''
  const used = new Set()
  for (const m of tpl.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c && /^[A-Za-z_][\w-]*$/.test(c)) used.add(c)
  }
  const defined = new Set()
  for (const m of style.matchAll(/\.([A-Za-z_][\w-]*)/g)) defined.add(m[1])
  const missing = [...used].filter((c) => !defined.has(c))
  if (missing.length) bad(path.relative(ROOT, f) + ' 样式类未定义 (元素会 0 尺寸/不可见): ' + missing.join(','))
}

// ---- Vue2 data 键命名 (真机踩过: _gen 未代理 -> ++undefined = NaN -> 页面永远卡加载) ----
// Vue 2 不会把 data 里以 _ 或 $ 开头的键代理到 this 上, 读写都是 undefined.
for (const f of vueFiles) {
  const t = fs.readFileSync(f, 'utf8')
  const di = t.indexOf('data()')
  if (di < 0) continue
  const block = t.slice(di, di + 2500)
  for (const m of block.matchAll(/^\s{6}([_$]\w+)\s*:/gm)) {
    bad(path.relative(ROOT, f) + ' data() 里有 ' + m[1] + ' —— Vue2 不代理 _/$ 开头的键, this.' + m[1] + ' 恒为 undefined')
  }
}

// ---- 设计 token 键存在性 (真机踩过: SCREEN.safeSpace 不存在 -> 宽度算成 NaN -> 卡片宽度永远默认值) ----
{
  const tk = fs.readFileSync(path.join(ROOT, 'src/design/tokens.js'), 'utf8')
  const keysOf = (name) => {
    const m = tk.match(new RegExp('(?:const|export const)\\s+' + name + '\\s*=\\s*\\{([\\s\\S]*?)\\}'))
    if (!m) return null
    const out = new Set()
    for (const kv of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) out.add(kv[1])
    return out
  }
  const sets = { SCREEN: keysOf('SCREEN'), SPEC: keysOf('SPEC'), SPACE: keysOf('SPACE'), TYPE: keysOf('TYPE') }
  for (const [fname, set] of Object.entries(sets)) {
    if (!set) continue
    for (const f of [...jsFiles, ...vueFiles]) {
      const t = fs.readFileSync(f, 'utf8')
      // 只查真正从 design/tokens.js 导入该名字的文件 (项目里 config.js 有同名的 SPEC, 会误报)
      const imp = t.match(/import\s*\{([^}]*)\}\s*from\s*'[^']*design\/tokens\.js'/)
      if (!imp) continue
      const imported = imp[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop())
      if (imported.indexOf(fname) < 0) continue
      for (const m of t.matchAll(new RegExp('\\b' + fname + '\\.([A-Za-z_$][\\w$]*)', 'g'))) {
        if (!set.has(m[1])) bad(path.relative(ROOT, f) + ' ' + fname + '.' + m[1] + ' 不是 tokens.js 里的键 (会得到 undefined/NaN)')
      }
    }
  }
}

// ---- emoji 字体格式 (真机结论: 框架只渲染 glyf 轮廓字形) ----
// COLR/CPAL -> 字形轮廓为空, 屏幕上什么都没有
// CBDT/CBLC -> 纯位图没有 glyf, 全部落到 .notdef (缺字框)
{
  const fp = path.join(ROOT, 'libs/Twemoji.ttf')
  if (!fs.existsSync(fp)) bad('缺少 libs/Twemoji.ttf (emoji 字体)')
  else {
    const buf = fs.readFileSync(fp)
    const tag = (t) => buf.indexOf(Buffer.from(t, 'latin1')) >= 0
    if (!tag('glyf')) bad('libs/Twemoji.ttf 没有 glyf 表 —— 框架渲染不出来, emoji 会变成空白/缺字框')
    if (tag('COLR')) bad('libs/Twemoji.ttf 含 COLR (彩色矢量) —— 框架不支持, 必须用单色轮廓字体')
    if (tag('CBDT')) bad('libs/Twemoji.ttf 含 CBDT (彩色位图) —— 框架不支持, 必须用单色轮廓字体')
  }
}

// ---- 图标变体必须真的不同 (真机踩过: 生成器算了颜色却没用, 47 个图标全是纯黑) ----
{
  const miDir = path.join(ROOT, 'src/assets/mi')
  if (fs.existsSync(miDir)) {
    const files = fs.readdirSync(miDir).filter((f) => f.endsWith('.png'))
    const byBase = {}
    for (const f of files) {
      const m = f.match(/^(.*)_(w|d|p|m)\.png$/)
      if (!m) continue
      byKey(m[1], m[2], fs.readFileSync(path.join(miDir, f)))
    }
    function byKey(base, variant, buf) {
      if (!byBase[base]) byBase[base] = {}
      byBase[base][variant] = buf
    }
    for (const base of Object.keys(byBase)) {
      const g = byBase[base]
      if (g.w && g.d && g.w.equals(g.d)) bad('图标 ' + base + ' 的 _w 与 _d 内容完全相同 —— 着色没生效, 深色主题下会看不见')
    }
  }
}

// ---- 子组件必须导入并注册 (用了 <RichText> 却没注册, 运行时整块不渲染且不报错) ----
for (const f of vueFiles) {
  const t = fs.readFileSync(f, 'utf8')
  const tpl = t.slice(0, t.indexOf('<script>'))
  for (const m of tpl.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
    const name = m[1]
    const imported = new RegExp("import\\s+" + name + "\\s+from").test(t)
    const registered = new RegExp("components:\\s*\\{[^}]*\\b" + name + "\\b").test(t)
    if (!imported) bad(path.relative(ROOT, f) + ' 用了 <' + name + '> 但没有 import')
    else if (!registered) bad(path.relative(ROOT, f) + ' 用了 <' + name + '> 但 components 里没注册')
  }
}

// ---- 页面参数必须在 onShow 里也能读到 (设备框架只转发 onShow, mounted 不保证触发) ----
for (const f of vueFiles) {
  const t = fs.readFileSync(f, 'utf8')
  if (t.indexOf('$page.options') < 0) continue
  const m = t.match(/mounted\(\) \{([\s\S]*?)\n  \},/)
  if (m && m[1].indexOf('$page.options') >= 0) {
    bad(path.relative(ROOT, f) + ' 只在 mounted 里读 $page.options —— 设备上 mounted 不一定被调用, 参数会恒为空')
  }
}

console.log(problems === 0
  ? 'VALIDATE PASSED (' + jsFiles.length + ' js / ' + vueFiles.length + ' vue / ' + pngNames.size + ' 图标引用 / ' + Object.keys(appJson.pages || {}).length + ' 页面)'
  : problems + ' 个问题')
process.exit(problems ? 1 : 0)
