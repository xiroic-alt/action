// 本地观看历史门禁 (0.9.73)
//
// 用户要求: "添加一下本地历史记录, 不要上传 b 站", 并且"本地的不要和云端历史记录放一个页面".
// 这道门禁守三件事:
//   1) **不上传**: 全仓库不允许出现任何 history/report 之类的上报调用;
//   2) **两个页面**: 本地记录(localhistory) 与 云端历史(history) 是两个独立页面, 入口分开;
//   3) **真行为**: 用真的存储实现跑一遍(带内存 fs 桩), 验证记录/排序/删除/清空/元数据更新.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../ui/src/', import.meta.url)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, SRC)), 'utf8')

let pass = 0
const fails = []
function ok(cond, msg) { if (cond) { pass++; return } fails.push(msg) }

// ---------- 1. 绝不上传 ----------
// ★ 只禁**上报/心跳**这类"往服务端写观看行为"的接口.
//   注意别误伤: x/web-interface/history/search 是**读取**云端历史 (history 页在用),
//   它与"上传本机记录"无关 —— 第一版正则把它当上报, 是断言写宽了.
const FORBIDDEN = [
  /x\/v2\/history\/report/i,      // 官方"上报观看进度"接口
  /history\/report/i,
  /\/heartbeat\b/i,                // 心跳
  /\/so\/click\/report/i,          // 点击上报
  /archive\/click/i,               // 稿件点击上报
  /player\/report/i
]
const allVue = []
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = dir + '/' + f
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(js|vue)$/.test(f)) allVue.push(p)
  }
}
walk(fileURLToPath(SRC))
for (const f of allVue) {
  const src = fs.readFileSync(f, 'utf8')
  for (const re of FORBIDDEN) {
    if (re.test(src)) { fails.push('发现上报调用 ' + re + ' 于 ' + f.replace(/\\/g, '/')); }
  }
}
ok(true, '上报扫描执行完毕')

// ---------- 2. 两个页面互不混合 ----------
const localHash = read('pages/localhistory/localhistory.vue')
const cloudHash = read('pages/history/history.vue')
ok(/本机记录/.test(localHash), 'localhistory: 标题是本机记录')
ok(!/getHistoryList/.test(localHash), 'localhistory: 不调用云端历史接口 getHistoryList')
ok(!/listHistory/.test(cloudHash), 'history(云端): 不使用本地 listHistory')
ok(/不会上传/.test(localHash), 'localhistory: 界面明确告知"不会上传到 b 站"')
const appJson = JSON.parse(read('app.json'))
ok(!!appJson.pages.localhistory && !!appJson.pages.history, 'app.json: localhistory 与 history 分别注册')
ok(appJson.pages.localhistory !== appJson.pages.history, 'app.json: 两者不是同一个页面文件')
const mine = read('pages/index/index.vue')
ok(/openListPage\('localhistory'\)/.test(mine), '我的页: 有「本机记录」入口')
ok(/openListPage\('history'\)/.test(mine), '我的页: 有「云端历史」入口')

// ---------- 3. 存储层真行为 (内存 fs 桩) ----------
const progressSrc = read('services/progress.js')
// 把 import 换成桩: 直接在一个临时模块里求值
const stub = 'data:text/javascript,' + encodeURIComponent(
  'export const bilinet = { _m: {}, readFile(p) { return this._m[p] || "" }, writeFile(p, s) { this._m[p] = s } }\n' +
  'export const logDebug = () => {}\n')
const patched = progressSrc
  .replace(/import \{ bilinet \} from '\.\/native\.js'/, "import { bilinet } from '" + stub + "'")
  .replace(/import \{ logDebug \} from '\.\/log\.js'/, "import { logDebug } from '" + stub + "'")
const tmp = new URL('data:text/javascript,' + encodeURIComponent(patched))
const P = await import(tmp.href)

P.clearHistory()
assert.deepEqual(P.listHistory(), [], '空历史: 初始为空')
pass++

P.setProgress('BV1', 30, 300, { title: '视频一', author: 'UP一', pic: 'c1.jpg', durText: '5:00' })
let list = P.listHistory()
assert.equal(list.length, 1, '记录一条')
assert.equal(list[0].title, '视频一', '元数据写入')
assert.equal(list[0].pos, 30, '进度写入')
pass += 3

P.setProgress('BV2', 60, 600, { title: '视频二' })
P.setProgress('BV3', 10, 100, { title: '视频三' })
list = P.listHistory()
assert.deepEqual(list.map((x) => x.bvid), ['BV3', 'BV2', 'BV1'], '最近观看排最前')
pass++

// 刚点开就退出 (进度 < 5s): 仍然要出现在历史里, 但进度是 0
P.setProgress('BV4', 1, 400, { title: '刚点开' })
list = P.listHistory()
assert.equal(list[0].bvid, 'BV4', '进度太小也进历史 (看过一眼就要记住)')
assert.equal(list[0].pos, 0, '进度太小则记 0, 不影响续播')
pass += 2

// 看完 (接近结尾): 进度归零但仍在历史
P.setProgress('BV1', 299, 300, { title: '视频一' })
list = P.listHistory()
const bv1 = list.filter((x) => x.bvid === 'BV1')[0]
assert.ok(bv1, '看完后仍留在历史里')
assert.equal(bv1.pos, 0, '看完后进度归零')
pass += 2

// 删除一条
P.delHistory('BV2')
list = P.listHistory()
assert.equal(list.filter((x) => x.bvid === 'BV2').length, 0, '删除生效')
assert.equal(P.getProgress('BV2'), 0, '删除连续播点一起清掉')
pass += 2

// 元数据更新 (同一视频再进, 标题变了要跟着变)
P.setProgress('BV3', 20, 100, { title: '视频三(改名)' })
list = P.listHistory()
assert.equal(list.filter((x) => x.bvid === 'BV3')[0].title, '视频三(改名)', '元数据可更新')
pass++

// 清空
P.clearHistory()
assert.deepEqual(P.listHistory(), [], '清空后为空')
assert.equal(P.historyCount(), 0, 'count 归零')
pass += 2

// 上限: 不能无限涨
for (let i = 0; i < 260; i++) P.setProgress('BX' + i, 10, 100, { title: 'x' })
ok(P.historyCount() <= 200, '历史条数有上限 (<=200)')

for (const f of fails) console.log('BAD  ' + f)
console.log('')
console.log(fails.length === 0
  ? ('CHECK-LOCALHISTORY PASSED (' + pass + ' 断言: 不上传/两页分离/存储真行为/上限)')
  : (fails.length + ' 个断言失败 / 共 ' + (pass + fails.length)))
process.exit(fails.length === 0 ? 0 : 1)
