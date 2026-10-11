// 静态绑定体检: 模板里绑定了一个**脚本里根本不存在**的标识符 = 静默失效.
//
// 为什么需要它 (真机案例 2026-10-11): feed.vue / dyn.vue 的 `:style="vcardStyle"` 在模板里
// 有 4 处引用, 而 computed 里从来没定义 —— Vue2 对 undefined 绑定不报错也不警告, 于是
// CSS 里写死的 `#141416` 照常生效, 浅色主题下"动态视频卡恒为黑". 这种错在离线门禁里
// 完全不可见 (validate 只看标签/图标, check-ui 只看配色算得出来), 只在真机被眼睛抓到.
//
// 判据刻意保守 (只查"脚本里一次都没出现"的裸标识符), 因此零误报:
//   - 单标识符绑定: :style="X" / :src="X" / :class="X" / :key="X"
//   - 数组 class 里的裸标识符: :class="['a', X ? 'b' : '']" (X 必须在脚本里出现过)
// 反例 (不查, 因为可能合法): 带点/带调用的表达式, `T.navPos` 这种成员访问已由"整串出现在脚本里"覆盖.
//
// 用法: node tools/check-bindings.mjs   (退出码非 0 = 有未定义绑定)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../ui/src/', import.meta.url)
const dirs = [new URL('pages/', SRC), new URL('components/', SRC)]
const files = []
for (const d of dirs) {
  const dir = fileURLToPath(d)
  if (!fs.existsSync(dir)) continue
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const f = path.join(dir, e.name, e.name + '.vue')
      if (fs.existsSync(f)) files.push(f)
    } else if (e.name.endsWith('.vue')) {
      files.push(path.join(dir, e.name))
    }
  }
}

let bad = 0
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const tEnd = src.lastIndexOf('</template>')
  const sStart = src.indexOf('<script')
  if (tEnd < 0 || sStart < 0) { console.log('SKIP (结构异常) ' + path.basename(f)); continue }
  const tmpl = src.slice(0, tEnd)
  const script = src.slice(sStart)
  const rel = path.relative(fileURLToPath(new URL('../ui/src/', import.meta.url)), f).replace(/\\/g, '/')
  const seen = new Set()
  const report = (name, why) => {
    if (seen.has(name)) return
    seen.add(name)
    bad++
    console.log('BAD  ' + rel + ' -> ' + name + ' (' + why + ')')
  }
  let m
  const re1 = /:(?:style|src|class|key)="([A-Za-z_$][\w$]*)"/g
  while ((m = re1.exec(tmpl))) {
    const n = m[1]
    if (script.indexOf(n) < 0) report(n, '模板绑定了裸标识符, 但脚本里没有这个名字')
  }
  const re2 = /:class="\[([^\]]*)\]"/g
  while ((m = re2.exec(tmpl))) {
    // 先把字符串字面量去掉 ('nav-' 这类里的 nav 不是标识符), 再取"前面不是 . "的裸标识符
    const expr = m[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    for (const n of (expr.match(/(?<![.\w$])[A-Za-z_$][\w$]*/g) || [])) {
      if (['true', 'false', 'null', 'undefined'].indexOf(n) >= 0) continue
      if (script.indexOf(n) < 0) report(n, '数组 class 里用了裸标识符, 脚本里没有这个名字')
    }
  }
}

console.log('')
console.log(bad === 0
  ? ('CHECK-BINDINGS PASSED (' + files.length + ' 个组件: 模板绑定名全部在脚本里存在)')
  : (bad + ' 处未定义绑定'))
process.exit(bad === 0 ? 0 : 1)
