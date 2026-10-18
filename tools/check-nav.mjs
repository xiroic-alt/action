// 详情页入栈门禁: 防止任何入口硬编码 navTo('page').
//
// 真机 bug (2026-10-18, 用户报): 详情页A -> UP主页 -> 点另一个视频 -> 又回到视频A, 新视频进不去.
// 根因: 固件对**同名页**的 navTo 不是入栈, 而是让栈里已存在的那个实例上浮并沿用它的旧 options;
//   旧实例的 onShow 走 beginLoad(this.$page.options) 拿到的还是旧 bvid, 又被去重门槛挡住.
// 解法: 所有入口统一走 services/detail-ring.js 的 nextDetailName() 游标轮换;
//   详情页 onShow 把游标拨到自己名字的下一站 (固件没有查询页面栈的 API, 只能自我对齐).
//
// 这道门禁就是防"又有人(或又是我)随手写回 navTo('page')" —— 那种写法在单层场景下看着没问题,
// 只有在"详情 -> 别的页 -> 再进详情"时才炸, 靠人工回归极难发现.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../ui/src/', import.meta.url)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, SRC)), 'utf8')

let pass = 0
const fails = []
function ok(cond, msg) { if (cond) { pass++; return } fails.push(msg) }

// ---------- 1. detail-ring 的游标 API ----------
const ring = read('services/detail-ring.js')
ok(/export function nextDetailName\(\)/.test(ring), 'detail-ring: 导出 nextDetailName (入口统一取页面名)')
ok(/export function syncDetailCursor\(ownName\)/.test(ring), 'detail-ring: 导出 syncDetailCursor (详情页自我对齐)')
ok(/export function prevOf\(name\)/.test(ring), 'detail-ring: 导出 prevOf (由 next-page 反查自己的名字)')
ok(/var cursor = 0/.test(ring), 'detail-ring: 有全局游标')

// ---------- 2. 详情页必须对齐游标 ----------
const page = read('pages/page/page.vue')
ok(/syncDetailCursor\(_own\)[\s\S]{0,120}?prevOf\(this\.nextPage/.test(page) || /var _own = prevOf\(this\.nextPage/.test(page),
  'page.vue: onShow 用 prevOf(this.nextPage) 对齐游标')
ok(/import \{ syncDetailCursor, prevOf \} from '\.\.\/\.\.\/services\/detail-ring\.js'/.test(page),
  'page.vue: 引入游标 API')
ok(/syncDetailCursor\(name\)/.test(page), 'page.vue: 内部「相关推荐」跳转也同步游标')
ok(/\$falcon\.navTo\(name, \{ bvid: item\.bvid/.test(page), 'page.vue: openVideo 用轮换名 (不用硬编码)')

// ---------- 3. 所有入口都走游标, 不许硬编码 'page' ----------
const entries = [
  'pages/index/index.vue', 'pages/feed/feed.vue', 'pages/dyn/dyn.vue', 'pages/up/up.vue',
  'pages/fav/fav.vue', 'pages/history/history.vue', 'pages/toview/toview.vue', 'pages/msg/msg.vue',
  'pages/subreply/subreply.vue'
]
for (const p of entries) {
  const src = read(p)
  ok(!/\$falcon\.navTo\('page'/.test(src), p + ': 不硬编码 navTo(\'page\') (同名页会让旧实例上浮)')
  const hits = src.match(/\$falcon\.navTo\('up'/g) || []
  const direct = /\$falcon\.navTo\(nextDetailName\(\)/.test(src)
  // 只有"确实会进详情"的页面才必须用游标
  const opensVideo = /getUpVideos|getFavList|getHistoryList|getToViewList|getDynamicFeed|getDynamicSpace|getMsgList|getRecommendVideos/.test(src)
  if (direct || opensVideo) {
    ok(/import \{ nextDetailName \} from '\.\.\/\.\.\/services\/detail-ring\.js'/.test(src),
      p + ': 引入 nextDetailName')
  }
  void hits
}

// ---------- 4. 环本身没被改小/改乱 ----------
const m = /export var RING = \[([^\]]*)\]/.exec(ring)
ok(!!m, 'detail-ring: RING 数组仍可解析')
if (m) {
  const names = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  ok(names[0] === 'page', 'RING 第一项是 page')
  ok(names.length >= 8, 'RING 至少 8 个名字 (够"详情套详情"用)')
  ok(new Set(names).size === names.length, 'RING 名字不重复')
}

for (const f of fails) console.log('BAD  ' + f)
console.log('')
console.log(fails.length === 0
  ? ('CHECK-NAV PASSED (' + pass + ' 断言: 游标 API/详情页对齐/入口不硬编码/环完整性)')
  : (fails.length + ' 个断言失败 / 共 ' + (pass + fails.length)))
process.exit(fails.length === 0 ? 0 : 1)
