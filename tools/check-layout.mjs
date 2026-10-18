// 布局门禁 (0.9.74 教训: "我的"页按钮超出屏幕)
//
// 事故: .entry-btn 原本是固定 width:200px + 左右各 12px 外边距 = 每个占 224px,
//   4 个按钮 896px 刚好放下; 给这一行加了第 5 个入口(本机记录)后 1120px, **超出 160px**.
//   固定宽度的"横向按钮行"只要多一个入口就炸, 而且只有真机/截图才看得出来.
//
// 为什么不写通用溢出检测: 网格布局(封面卡/九宫格)本来就该用固定宽度并靠换行排布,
//   通用规则会把它们全部误报. 所以这道门禁只钉两件确定的事:
//   1) 横向按钮行(多按钮, 不换行)必须靠 flex 均分, 不许写死宽度;
//   2) 任何单个元素都不许宽过逻辑屏幕(960).
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../ui/src/', import.meta.url)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, SRC)), 'utf8')

const SCREEN_W = 960
let pass = 0
const fails = []
function ok(cond, msg) { if (cond) { pass++; return } fails.push(msg) }

// 从 <style> 里取某个 class 的声明块
function ruleOf(src, cls) {
  const re = new RegExp('(?:^|\\n)\\s*\\.' + cls + '\\s*\\{([^}]*)\\}')
  const m = re.exec(src)
  return m ? m[1] : null
}
function pxOf(decl, prop) {
  if (!decl) return null
  const m = new RegExp(prop + '\\s*:\\s*([0-9.]+)px').exec(decl)
  return m ? Number(m[1]) : null
}

// ---------- 1. "我的"页横向按钮行 ----------
const mine = read('pages/index/index.vue')
const row = ruleOf(mine, 'entry-row')
const btn = ruleOf(mine, 'entry-btn')
ok(!!row && /flex-direction:\s*row/.test(row), '我的页 .entry-row 是横向行')
ok(!!btn, '我的页 .entry-btn 样式存在')
ok(!!btn && /flex:\s*1/.test(btn), '我的页 .entry-btn 用 flex:1 均分 (入口数量变化不再撑破)')
ok(pxOf(btn, 'width') === null, '我的页 .entry-btn 不写固定 width (这就是超屏的根因)')
// 按钮数量: 第 12 行是登录后才显示的入口区; 统计模板里的 entry-btn 个数
const btnCount = (mine.match(/class="entry-btn"/g) || []).length
ok(btnCount >= 5, '我的页入口数 >= 5 (本机记录/云端历史/收藏/稍后再看/我的关注 + 直播/消息/线路)')
// 若哪天有人把宽度写回来, 用实际数量算一遍是否放得下
const w = pxOf(btn, 'width')
const ml = pxOf(btn, 'margin-left') || 0
const mr = pxOf(btn, 'margin-right') || 0
if (w !== null) {
  ok(false, '我的页 .entry-btn 又写回固定宽度 ' + w + 'px, ' + btnCount + ' 个按钮需要 ' +
    (btnCount * (w + ml + mr)) + 'px > 屏幕 ' + SCREEN_W + 'px')
} else {
  ok(true, '按 flex 均分, ' + btnCount + ' 个入口可自适应')
}

// ---------- 1b. 回顶按钮不得压住底部发评栏 ----------
// 事故: BackTop 原本 right:12 bottom:12 高 44px, 而底部发评栏也是 44px 高且贴底,
//   于是「回到顶部」正好盖住「发送」(用户报的"回到顶部的按钮会挡住发送按钮").
//   契约: BackTop 必须有 lift 参数, 且凡是有 .postbar 又用了 BackTop 的页面都必须传 lift>=44.
const bt = read('components/back-top.vue')
ok(/lift:\s*\{ type: Number/.test(bt), 'back-top: 有 lift 参数 (向上抬升)')
ok(/bottom = \(12 \+ \(Number\(this\.lift\) \|\| 0\)\) \+ 'px'/.test(bt), 'back-top: bottom = 12 + lift')
ok(/boxStyle\(\)/.test(bt) && !/:style="T\.accentR"/.test(bt), 'back-top: 只留一个 :style 绑定 (两个会被框架丢掉一个)')

const hasPostbar = []
function scanPostbar(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = dir + '/' + f
    if (fs.statSync(p).isDirectory()) scanPostbar(p)
    else if (/\.vue$/.test(f)) {
      const s = fs.readFileSync(p, 'utf8')
      if (/class="postbar"/.test(s) && /<BackTop/.test(s)) hasPostbar.push(p)
    }
  }
}
scanPostbar(fileURLToPath(SRC))
ok(hasPostbar.length >= 3, '找到 ' + hasPostbar.length + ' 个"有发评栏又用回顶"的页面')
for (const p of hasPostbar) {
  const s = fs.readFileSync(p, 'utf8')
  const m = /<BackTop[^>]*:lift="(\d+)"/.exec(s)
  const rel = p.split(/[\\/]/).slice(-2).join('/')
  ok(!!m && Number(m[1]) >= 44, rel + ': 回顶按钮传了 lift>=' + 44 + ' (否则压住发送)')
}

// ---------- 2. 单元素不得宽过逻辑屏 ----------
let scanned = 0
const files = []
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = dir + '/' + f
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (/\.vue$/.test(f)) files.push(p)
  }
}
walk(fileURLToPath(SRC))
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [null, ''])[1]
  const re = /([^{}]+)\{([^}]*)\}/g
  let m
  while ((m = re.exec(style))) {
    const sel = m[1].trim()
    const w2 = pxOf(m[2], 'width')
    scanned++
    if (w2 !== null && w2 > SCREEN_W) {
      fails.push(f.split(/[\\/]/).slice(-2).join('/') + ' ' + sel + ' 宽度 ' + w2 + 'px 超过屏幕 ' + SCREEN_W + 'px')
    }
  }
}
ok(scanned > 100, '样式规则扫描覆盖足够多 (扫到 ' + scanned + ' 条)')

for (const f of fails) console.log('BAD  ' + f)
console.log('')
console.log(fails.length === 0
  ? ('CHECK-LAYOUT PASSED (' + pass + ' 断言: 横向按钮行用 flex / 无超屏元素 / 扫描 ' + scanned + ' 条规则)')
  : (fails.length + ' 个断言失败 / 共 ' + (pass + fails.length)))
process.exit(fails.length === 0 ? 0 : 1)
