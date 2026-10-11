// 离线公共行为回归: 直播间服务归一化 + 直播三页(列表/房间/播放器)的源码级契约
//
// 为什么需要它: 直播这条路跨了三个页面和一个服务模块, 真机验证成本高 (要开播的房间),
// 而这里能钉死的是"公共行为"——接口归一化、字段兜底、开播态判定、弹幕去重、
// 以及播放器"直播态不许出现进度条/续播"这类一改就漂的契约.
//
// 桩件与加载方式照 tools/check-request-gate.mjs / tools/check-ui.mjs:
//   - globalThis.__bilinet 注入网络与文件系统;
//   - register('./esm-hooks.mjs') 把 'bilinet' 等原生模块名映射到桩件, 并让 .vue 的
//     <script> 能被 Node 真实 ESM 链接 (少写导出/写错模块名会在这里炸, 而不是装机黑屏).
//
// 用法: node tools/check-live.mjs   (退出码非 0 = 有断言失败, CI 可直接拦)

import assert from 'node:assert/strict'
import { register } from 'node:module'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---- 设备侧桩件: 网络按 URL 路由, 文件系统放内存 ----
const disk = new Map()
const reqUrls = []
let reply = () => ''
globalThis.__bilinet = {
  readFile: (p) => (disk.has(p) ? disk.get(p) : ''),
  writeFile: (p, d) => { disk.set(p, String(d)); return true },
  deleteFile: (p) => disk.delete(p),
  mkdirs: () => true,
  fileExists: (p) => disk.has(p),
  exec: () => '',
  dbOpen: () => false, dbExec: () => true, dbQuery: () => '[]', dbClose: () => true,
  httpGet: (url) => { reqUrls.push(url); return reply(url) },
  httpGetAsync: (url) => { reqUrls.push(url); return Promise.resolve(reply(url)) },
  httpPost: () => '', httpPostAsync: () => Promise.resolve('')
}
globalThis.$falcon = {
  Page: class Page {}, App: class App {},
  navTo() {}, navBack() {}, finish() {},
  on() { return 0 }, off() {}, trigger() {}, eventMap: {},
  env: { custom: { $set() {}, $get() { return {} } } }
}
globalThis.$page = { options: {}, finish() {}, setTimeout, clearTimeout, setInterval, clearInterval }

register('./esm-hooks.mjs', import.meta.url)

const SRC = new URL('../ui/src/', import.meta.url).href
const readSrc = (rel) => fs.readFileSync(fileURLToPath(SRC + rel), 'utf8')
const body = (data) => JSON.stringify({ code: 0, data })

let pass = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pass++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++ }

const live = await import(SRC + 'services/live.js')

// ================= 1. getRoomInfo 归一化 =================
// 接口依据: xlive/web-room/v1/index/getInfoByRoom?room_id=<真实号或短号>
const ROOM = body({
  room_info: {
    room_id: 1001, short_id: 77, title: ' 测试直播间 ',
    cover: '//i0.hdslb.com/cover.jpg', area_name: '英雄联盟', parent_area_name: '网络游戏',
    live_status: 1, online: 23456, description: '今晚八点开黑'
  },
  anchor_info: { base_info: { uname: '主播甲', face: '//i0.hdslb.com/face.jpg' } },
  watched_show: { num: 98765 }
})
reply = () => ROOM
reqUrls.length = 0
const info = await live.getRoomInfo(1001)
eq(info, {
  roomid: 1001, shortId: 77, title: '测试直播间',
  cover: 'https://i0.hdslb.com/cover.jpg', up: '主播甲', face: 'https://i0.hdslb.com/face.jpg',
  area: '英雄联盟', parentArea: '网络游戏', online: 23456, watched: 98765,
  liveStatus: 1, liveText: '直播中', live: true, notice: '今晚八点开黑'
}, 'getRoomInfo 归一化 (标题去空白 / 协议相对 URL 补 https)')
ok(reqUrls[0].indexOf('api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=1001') > 0,
  '取房间信息走 getInfoByRoom?room_id= (接口依据), 实际 ' + reqUrls[0])

// 短号进真实号出: room_info 只给了运行时字段时, roomid 回落成入参
reply = () => body({ room_info: { room_id: 2002, live_status: 1 }, anchor_info: { base_info: { uname: '乙' } } })
const infoByShort = await live.getRoomInfo(2002)
eq(infoByShort.roomid, 2002, 'roomid 从 room_info 取')
eq(infoByShort.watched, 0, '没有 watched_show 时看过人数为 0')

// ================= 2. 字段缺失兜底 =================
reply = () => body({})
const bare = await live.getRoomInfo(3003)
eq(bare, {
  roomid: 3003, shortId: 0, title: '', cover: '', up: '', face: '',
  area: '', parentArea: '', online: 0, watched: 0,
  liveStatus: -1, liveText: '状态未知', live: false, notice: ''
}, 'data 为空对象: 全字段兜底且不抛错 (roomid 回落成入参)')

reply = () => body({ room_info: { title: '只有标题' } })
const partial = await live.getRoomInfo(3004)
eq([partial.title, partial.up, partial.cover, partial.online, partial.live], ['只有标题', '', '', 0, false],
  'room_info 只有 title: 其余字段各自兜底')

reply = () => JSON.stringify({ code: -400, message: '房间不存在' })
let thrown = null
try { await live.getRoomInfo(3005) } catch (e) { thrown = e }
ok(thrown && /房间不存在/.test(thrown.message), '业务 code != 0 抛出可读原因 (不静默返回空)')
thrown = null
try { await live.getRoomInfo('') } catch (e) { thrown = e }
ok(thrown instanceof Error, '空 roomid 直接抛错 (不发无意义请求)')

// 旧 .so 没有异步方法时退回同步 httpGet (与 services/bili.js 同一约定)
const asyncGet = globalThis.__bilinet.httpGetAsync
delete globalThis.__bilinet.httpGetAsync
reply = () => body({ room_info: { room_id: 4004, title: '同步口', live_status: 0 } })
const syncInfo = await live.getRoomInfo(4004)
eq([syncInfo.title, syncInfo.live], ['同步口', false], '没有 httpGetAsync 时退化为同步 httpGet')
globalThis.__bilinet.httpGetAsync = asyncGet

// ================= 3. liveStatus 判定 =================
const STATUS = [0, 1, 2]
const WANT = [['未开播', false], ['直播中', true], ['轮播中', false]]
for (let i = 0; i < STATUS.length; i++) {
  reply = () => body({ room_info: { room_id: 5000 + i, live_status: STATUS[i] } })
  const r = await live.getRoomInfo(5000 + i)
  eq([r.liveStatus, r.liveText, r.live], [STATUS[i], WANT[i][0], WANT[i][1]],
    'live_status=' + STATUS[i] + ' 判定')
}
reply = () => body({ room_info: { room_id: 5100, live_status: 9 } })
const weird = await live.getRoomInfo(5100)
eq([weird.liveStatus, weird.liveText, weird.live], [9, '状态未知', false], '未知 live_status: 不当成开播')
eq(live.liveStateText(1), '直播中', 'liveStateText 归一化可单独复用')

// ================= 4. 弹幕去重 (8s 轮询的公共部分) =================
const filter = live.createDanmakuFilter(2)
eq(filter([{ id: '1', nick: 'a', text: 'x' }, { id: '2', nick: 'b', text: 'y' }]).map((d) => d.id), ['1', '2'],
  '弹幕过滤: 首轮全收')
eq(filter([{ id: '2' }, { id: '3' }]).map((d) => d.id), ['3'], '弹幕过滤: 重复 id 只出一次')
eq(filter([null, {}, { id: '4' }]).map((d) => d.id), ['4'], '弹幕过滤: 空条目跳过 (不抛错)')
eq(filter(null), [], '弹幕过滤: 非数组输入返回空')
// 上限只是"记住多少条 id", 超出后旧 id 会被忘掉 → 极端密集房间可能重出一条, 内存不涨
const capped = filter([{ id: '5' }, { id: '6' }])
eq(capped.map((d) => d.id), ['5', '6'], '弹幕过滤: 记忆上限内正常')

// ================= 5. 播放器: 直播态源码契约 =================
const player = readSrc('pages/player/player.vue')
ok(/isLive\(\)\s*\{\s*return this\.mode === 'live'\s*\}/.test(player), 'player: isLive 由 options.mode 决定')
ok(/this\.mode = options\.mode === 'live' \? 'live' : ''/.test(player), 'player: applyOptions 识别 mode=live')
ok(/getLiveRoomPlayUrl\(this\.roomid\)/.test(player) && /from '\.\.\/\.\.\/services\/bili\.js'/.test(player),
  'player: 直播取流走 bili.js 的 getLiveRoomPlayUrl')

const seekGate = player.indexOf('v-if="!isLive" class="seek"')
const seekbarAt = player.indexOf('<seekbar')
ok(seekGate > 0 && seekbarAt > seekGate, 'player: <seekbar> 只在 !isLive 分支内 (直播态不渲染进度条)')
ok(/v-if="!isLive" class="cbtn cbtn-mini" @click="seekBack"/.test(player), 'player: 快退按钮直播态不渲染')
ok(/v-if="!isLive" class="cbtn cbtn-mini cbtn-mini-last" @click="seekForward"/.test(player), 'player: 快进按钮直播态不渲染')
ok(player.indexOf('v-else class="time"') > seekGate, 'player: 时长文本与进度条同一分支 (直播态不渲染)')
ok(/v-if="isLive" class="time">已播 \{\{ liveElapsedText \}\}/.test(player), 'player: 直播态显示已播时长')
ok(/v-if="isLive" class="nav-tag">直播</.test(player), 'player: 显示「直播」标识')

ok(/if \(this\.isLive\) \{ this\.appliedOnce = true; return \}/.test(player),
  'player: 直播跳过倍速/续播/跳片头 (applyOnce 直接返回)')
const liveBranchAt = player.indexOf('if (this.isLive) {')
ok(liveBranchAt > 0 && player.indexOf('getProgress(self.bvid)') > liveBranchAt,
  'player: 直播分支在读续播进度之前 return')
ok(/if \(this\.resumeOn && this\.bvid && this\.started\)/.test(player),
  'player: 续播写回仍限点播 (有 bvid 才写)')

ok(/liveReconnect: function/.test(player) && /reconnectCount >= 3/.test(player), 'player: 断流重连有次数上限 (有限次)')
ok(/liveReconnect: function[\s\S]{0,400}var gen = \+\+this\.generation/.test(player), 'player: 每次重连换 generation')
ok(/setTimer\(this, 1500, function \(\) \{ if \(gen === self\.generation\) self\.fetchAndOpen\(gen\) \}\)/.test(player),
  'player: 过期重连回调不复活 (generation 守卫在定时器里)')
ok(/onUnload: function[\s\S]{0,300}this\.generation\+\+/.test(player), 'player: onUnload 递增 generation 让在途回调失效')

ok(/getVideoDetail\(self\.bvid\)/.test(player) && /getPlayUrl\(self\.bvid, cid\)/.test(player),
  'player: 点播取流路径保留')
ok(/if \(self\.resumeOn && !self\._resumeRead\)/.test(player), 'player: 点播断点续播保留')
ok(/fitRect\(e\.video_width, e\.video_height\)/.test(player), 'player: 画面几何 (hole 与画面贴合) 直播/点播共用且未改')

// ================= 6. 列表页: 不再内嵌播放 =================
const livePage = readSrc('pages/live/live.vue')
ok(!/<video\b/.test(livePage), 'live.vue: 已删除内嵌 <video>')
ok(!/<hole\b/.test(livePage), 'live.vue: 已删除内嵌 <hole>')
ok(!/vrectStyle|fitRect|reloadRoom|stopDanmaku/.test(livePage), 'live.vue: 已删除内嵌播放的几何/重连/弹幕逻辑')
ok(/\$falcon\.navTo\('room', \{ roomid: String\(r\.roomid\), title: r\.title \}\)/.test(livePage),
  'live.vue: 点房间卡片进独立直播间页')
ok(/searchLive\(kw, 1\)/.test(livePage), 'live.vue: 保留搜索')
ok(/hotAreas/.test(livePage) && /tip\(/.test(livePage), 'live.vue: 保留分区快捷与状态提示')

// ================= 7. 房间页: 信息 + 弹幕轮询 + 两个动作 =================
const roomPage = readSrc('pages/room/room.vue')
ok(/import \{[^}]*getRoomInfo[^}]*\} from '\.\.\/\.\.\/services\/live\.js'/.test(roomPage), 'room.vue: 走 services/live.js')
ok(/getLiveDanmaku/.test(roomPage), 'room.vue: 弹幕走 getLiveDanmaku')
ok(/DM_INTERVAL_MS = 8000/.test(roomPage) && /setInterval\(tick, DM_INTERVAL_MS\)/.test(roomPage),
  'room.vue: 弹幕 8s 轮询')
ok(/createDanmakuFilter/.test(roomPage), 'room.vue: 弹幕去重走 live.js 的过滤器')
ok(/onUnload\(\)\s*\{[\s\S]{0,200}stopDanmaku\(\)/.test(roomPage), 'room.vue: 卸载即停轮询')
ok(/onHide\(\)\s*\{[\s\S]{0,120}stopDanmaku\(\)/.test(roomPage), 'room.vue: 离开可见即停轮询')
ok(/info\.notice/.test(roomPage) && /noticeText/.test(roomPage), 'room.vue: 展示公告')
ok(/info\.liveText/.test(roomPage), 'room.vue: 展示开播状态')
ok(/onlineText\(this\.info\.online\)/.test(roomPage) && /info\.watched/.test(roomPage), 'room.vue: 展示人气/看过')
ok(/info\.area/.test(roomPage) && /info\.parentArea/.test(roomPage), 'room.vue: 展示分区')
ok(/\$falcon\.navTo\('player', \{ mode: 'live', roomid: String\(this\.roomid\)/.test(roomPage),
  'room.vue: 「用播放器播放」把直播态交给统一播放器')
ok(/@click="reload"/.test(roomPage) && /刷新/.test(roomPage), 'room.vue: 有「刷新」动作')
ok(/未开播|试播/.test(roomPage), 'room.vue: 未开播有可读提示而不是空白')

// ================= 8. 三个页面脚本可被真实 ES 链接 =================
const mods = [['room', await import(SRC + 'pages/room/room.vue')],
  ['player', await import(SRC + 'pages/player/player.vue')],
  ['live', await import(SRC + 'pages/live/live.vue')]]
for (const [name, mod] of mods) {
  const d = mod.default
  ok(d && typeof d === 'object' && d.name === name, name + '.vue: default 导出且 name 与页面名一致')
  ok(d.methods && typeof d.methods.onShow === 'function', name + '.vue: onShow 挂在 methods 里')
  ok(d.methods && typeof d.methods.onUnload === 'function', name + '.vue: onUnload 挂在 methods 里')
  ok(!d.onShow && !d.onUnload && !d.onHide, name + '.vue: 生命周期没有漏到组件根级 (0.9.61 事故)')
}
ok(typeof mods[1][1].default.methods.onNewOptions === 'function', 'player.vue: onNewOptions 挂在 methods 里')
ok(mods[1][1].default.methods.liveReconnect !== undefined, 'player.vue: liveReconnect 成功链接 (命名导出没漏)')
ok(mods[1][1].default.methods.startDanmaku === undefined && mods[0][1].default.methods.startDanmaku !== undefined,
  'room.vue 有 startDanmaku, player.vue 没有')

console.log('PASS live room info normalization, missing-field fallbacks, live_status mapping, '
  + 'danmaku dedupe, player live-mode source contract, list page has no inline player, room/player/live ES link '
  + '(' + pass + ' assertions)')
