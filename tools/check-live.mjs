// 离线公共行为回归: 直播间服务归一化 + 直播三页(列表/房间/播放器)的源码级契约
//
// 为什么需要它: 直播这条路跨了三个页面 + 一个服务模块, 真机验证成本高 (要有正在开播的房间),
// 而这里能钉死的是"公共行为"——接口归一化、字段兜底、开播态判定、弹幕去重,
// 以及播放器"直播态不许渲染进度条/不许走续播"这类一改就漂的契约.
//
// 桩件与加载方式照 tools/check-request-gate.mjs / tools/check-ui.mjs:
//   - globalThis.__bilinet 注入网络与文件系统;
//   - register('./esm-hooks.mjs') 把 'bilinet' 等原生模块名映射到桩件, 并让 .vue 的
//     <script> 能被 Node 真实 ESM 链接 (少写导出 / 写错模块名在这里就炸, 不用等装机黑屏).
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

// 静音被测服务的 console (services/log.js 无条件打 console.log), 断言输出走 ok/eq
const realLog = console.log
console.log = () => {}

const SRC = new URL('../ui/src/', import.meta.url).href
const readSrc = (rel) => fs.readFileSync(fileURLToPath(SRC + rel), 'utf8')
const body = (data) => JSON.stringify({ code: 0, data })

let pass = 0
let fails = 0
const failMsgs = []
function ok(cond, msg) { if (cond) { pass++; return } fails++; failMsgs.push(msg) }
function eq(a, b, msg) {
  try { assert.deepEqual(a, b); pass++ } catch (e) { fails++; failMsgs.push(msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')') }
}
function truthy(fn, msg) { try { ok(fn() === true, msg) } catch (e) { fails++; failMsgs.push(msg + ' -> ' + (e && e.message ? e.message : e)) } }

const live = await import(SRC + 'services/live.js')

// ================= 1. getRoomInfo 归一化 =================
// 接口依据 (真机 2026-10-11 实测): room/v1/Room/get_info + live_user/v1/UserInfo/get_anchor_in_room.
// getInfoByRoom 在本机恒 -352 (接口级风控, 带 Cookie/Referer/换 UA 都一样), 服务里已弃用 —— 这里也钉住"不再打它".
const ROOM = body({
  room_id: 1001, short_id: 77, title: ' 测试直播间 ',
  user_cover: '//i0.hdslb.com/cover.jpg', area_name: '英雄联盟', parent_area_name: '网络游戏',
  live_status: 1, online: 23456, attention: 98765, description: '今晚八点开黑'
})
const ANCHOR = body({ info: { uid: 9, uname: '主播甲', face: '//i0.hdslb.com/face.jpg' } })
const isAnchor = (url) => String(url).indexOf('get_anchor_in_room') >= 0
reply = (url) => (isAnchor(url) ? ANCHOR : ROOM)
reqUrls.length = 0
const info = await live.getRoomInfo(1001)
eq(info, {
  roomid: 1001, shortId: 77, title: '测试直播间',
  cover: 'https://i0.hdslb.com/cover.jpg', up: '主播甲', face: 'https://i0.hdslb.com/face.jpg',
  area: '英雄联盟', parentArea: '网络游戏', online: 23456, watched: 98765,
  liveStatus: 1, liveText: '直播中', live: true, notice: '今晚八点开黑'
}, 'getRoomInfo 归一化 (标题去空白 / 协议相对 URL 补 https)')
ok(/^https:\/\/api\.live\.bilibili\.com\/room\/v1\/Room\/get_info\?room_id=1001$/.test(reqUrls[0] || ''),
  '取房间信息走 room/v1/Room/get_info?room_id= (真机可用口), 实际 ' + reqUrls[0])
ok(reqUrls.some((u) => u.indexOf('get_anchor_in_room') >= 0), '主播名/头像走 get_anchor_in_room')
ok(!reqUrls.some((u) => u.indexOf('getInfoByRoom') >= 0), '不再请求本机恒 -352 的 getInfoByRoom')

// 主播口失败不能挡整页: 房间信息已经拿到就该渲染 (真机上这就是 -352 会走到的分支)
reply = (url) => (isAnchor(url) ? JSON.stringify({ code: -352, message: '-352' }) : body({ room_id: 2100, title: '只有房间', live_status: 1 }))
const noAnchor = await live.getRoomInfo(2100)
eq([noAnchor.title, noAnchor.up, noAnchor.face, noAnchor.live], ['只有房间', '', '', true],
  '主播口失败时房间信息照常返回 (up/face 兜底空串)')

// 房间口失败 -> 退到第二个口 (getRoomPlayInfo v2, 真机同为 code=0)
let firstRoomUrl = null
reply = (url) => {
  if (isAnchor(url)) return ANCHOR
  if (String(url).indexOf('/room/v1/Room/get_info') >= 0) return JSON.stringify({ code: -352, message: '-352' })
  return body({ room_id: 2200, title: '备用口', live_status: 0, online: 5 })
}
const fallback = await live.getRoomInfo(2200)
eq([fallback.title, fallback.liveStatus], ['备用口', 0], '房间口被风控时退到 getRoomPlayInfo v2')
firstRoomUrl = reqUrls[0]
ok(String(firstRoomUrl).indexOf('/room/v1/Room/get_info') >= 0, '第一优先仍是 room/v1/Room/get_info')

reply = (url) => (isAnchor(url) ? ANCHOR : body({ live_status: 1 }))
const infoByShort = await live.getRoomInfo(2002)
eq([infoByShort.roomid, infoByShort.watched, infoByShort.online], [2002, 0, 0],
  'room_id 缺失时 roomid 回落成入参; attention 缺失记 0')

// ================= 2. 字段缺失兜底 =================
// 两个口都返回空壳: 纯兜底路径 (连主播口也失败, 才可能全空)
reply = (url) => (isAnchor(url) ? JSON.stringify({ code: -101, message: '账号未登录' }) : body({}))
eq(await live.getRoomInfo(3003), {
  roomid: 3003, shortId: 0, title: '', cover: '', up: '', face: '',
  area: '', parentArea: '', online: 0, watched: 0,
  liveStatus: -1, liveText: '状态未知', live: false, notice: ''
}, 'data 为空对象: 全字段兜底且不抛错 (roomid 回落成入参)')

reply = (url) => (isAnchor(url) ? ANCHOR : body({ title: '只有标题' }))
const partial = await live.getRoomInfo(3004)
eq([partial.title, partial.up, partial.cover, partial.online, partial.live], ['只有标题', '主播甲', '', 0, false],
  '房间只有 title: 其余字段各自兜底 (主播口拿到了就照常填)')

reply = () => JSON.stringify({ code: -400, message: '房间不存在' })
let thrown = null
try { await live.getRoomInfo(3005) } catch (e) { thrown = e }
ok(!!(thrown && /房间不存在/.test(thrown.message)), '两个口都失败时抛出可读原因 (不静默返回空)')
thrown = null
try { await live.getRoomInfo('') } catch (e) { thrown = e }
ok(thrown instanceof Error, '空 roomid 直接抛错 (不发无意义请求)')

// 旧 .so 没有异步方法时退回同步 httpGet (与 services/bili.js 同一约定)
const asyncGet = globalThis.__bilinet.httpGetAsync
delete globalThis.__bilinet.httpGetAsync
reply = (url) => (isAnchor(url) ? ANCHOR : body({ room_id: 4004, title: '同步口', live_status: 0 }))
const syncInfo = await live.getRoomInfo(4004)
eq([syncInfo.title, syncInfo.live], ['同步口', false], '没有 httpGetAsync 时退化为同步 httpGet')
globalThis.__bilinet.httpGetAsync = asyncGet

// ================= 3. liveStatus 判定 =================
const STATUS = [0, 1, 2]
const WANT = [['未开播', false], ['直播中', true], ['轮播中', false]]
for (let i = 0; i < STATUS.length; i++) {
  reply = (url) => (isAnchor(url) ? ANCHOR : body({ room_id: 5000 + i, live_status: STATUS[i] }))
  const rr = await live.getRoomInfo(5000 + i)
  eq([rr.liveStatus, rr.liveText, rr.live], [STATUS[i], WANT[i][0], WANT[i][1]], 'live_status=' + STATUS[i] + ' 判定')
}
reply = (url) => (isAnchor(url) ? ANCHOR : body({ room_id: 5100, live_status: 9 }))
const weird = await live.getRoomInfo(5100)
eq([weird.liveStatus, weird.liveText, weird.live], [9, '状态未知', false], '未知 live_status: 不当成开播')
eq(live.liveStateText(1), '直播中', 'liveStateText 归一化可单独复用')
eq(live.liveStateText(undefined), '状态未知', 'liveStateText 对缺失值不猜')


// ================= 4. 弹幕去重 (8s 轮询的公共部分) =================
const filter = live.createDanmakuFilter(2)
eq(filter([{ id: '1', nick: 'a', text: 'x' }, { id: '2', nick: 'b', text: 'y' }]).map((d) => d.id), ['1', '2'],
  '弹幕过滤: 首轮全收')
eq(filter([{ id: '2' }, { id: '3' }]).map((d) => d.id), ['3'], '弹幕过滤: 重复 id 只出一次')
eq(filter([null, {}, { id: '4' }]).map((d) => d.id), ['4'], '弹幕过滤: 空条目跳过 (不抛错)')
eq(filter(null), [], '弹幕过滤: 非数组输入返回空')
// 上限只是"记住多少条 id", 超出后最旧的 id 会被忘掉 → 极端密集房间可能重出一条, 换来内存有界
eq(filter([{ id: '5' }, { id: '6' }]).map((d) => d.id), ['5', '6'], '弹幕过滤: 记忆上限内正常')

// ================= 5. 播放器: 直播态源码契约 =================
const player = readSrc('pages/player/player.vue')
const cfg = readSrc('services/config.js')
const setv = readSrc('pages/settings/settings.vue')
ok(/isLive\(\)\s*\{\s*return this\.mode === 'live'\s*\}/.test(player), 'player: isLive 由 options.mode 决定')
ok(/\(options\.mode === 'live' \|\| rid > 0\) \? 'live' : ''/.test(player), 'player: applyOptions 用 mode=live 或 roomid 判定直播态')
// 第二个参数是"候选线路序号" (直播起播失败时轮换), 取流仍然一律走 bili.js
ok(/getLiveRoomPlayUrl\(this\.roomid(, this\.liveSrcTry)?\)/.test(player) && /from '\.\.\/\.\.\/services\/bili\.js'/.test(player),
  'player: 直播取流走 bili.js 的 getLiveRoomPlayUrl')

const seekGate = player.indexOf('v-if="!isLive" class="seek"')
const seekEl = player.indexOf('<seekbar class="sbar"')
ok(seekGate > 0 && seekEl > seekGate, 'player: <seekbar> 元素只在 !isLive 分支内 (直播态不渲染进度条)')
eq((player.match(/<seekbar class="sbar"/g) || []).length, 1, 'player: 全文只有一个 <seekbar>')
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
// ★ 0.9.73 改成两条独立的契约 (以前共用一个 if 是错的):
//   历史记录: 只要点播且有 bvid 就写 —— **与 resumeOn 解耦** (关掉续播也要有历史);
//   断点续播: 读取仍受 resumeOn 控制 (它是"要不要接着上次放"的开关)。
ok(/if \(this\.bvid && this\.started && !this\.isLive\)/.test(player),
  'player: 本地历史写回与 resumeOn 解耦 (点播有 bvid 就记)')
ok(/if \(self\.resumeOn && !self\._resumeRead\)/.test(player), 'player: 断点续播读取仍受 resumeOn 控制')
ok(/setProgress\(this\.bvid, Math\.round\(ms \/ 1000\), Math\.round\(this\.durMs \/ 1000\), this\.histMeta\(\)\)/.test(player),
  'player: 写进度时一并落历史元数据 (标题/UP/封面)')
ok(/this\.recordHistory\(\)/.test(player), 'player: 起播即落一条历史 (点开就退也有记录)')

// ---- 音频输出路由 (蓝牙): 不调用 setAudioDeviceType 就永远只有扬声器 ----
// ---- 视频页固定深色 + 控制条间距 ----
ok(/function playerTokens/.test(player), 'player: 视频页用固定深色 token (不跟随浅色主题)')
ok(/T: playerTokens\(\)/.test(player), 'player: data 用 playerTokens()')
ok(!/T: tokens\(\)/.test(player), 'player: 不得再用跟随主题的 tokens()')
ok(/left: 820px/.test(player), 'player: 时间紧贴滑块 (left 820)')
ok(/width: 566px/.test(player), 'player: 滑块加宽到 566')

ok(/setAudioDeviceType/.test(player), 'player: 起播后要切音频输出 (setAudioDeviceType)')
ok(/applyAudioRoute/.test(player), 'player: 存在音频输出判定')
// ★ 音频输出 type 枚举 = 二进制取证 (libfalcon-live.so 的 VideoPlayer::getAudioDeviceStr
//   跳转表 @0x4bbc10 -> .rodata @0x4ba8ad/8b5/8bf/8ca):
//     0/3 -> speaker · 1 -> tc_digital · 2 -> tc_analog · 4 -> bluealsa:DEV=<mac>
//   0.9.64 我按 "1=蓝牙" 猜, 实际选到 tc_digital -> 真机 "Could not open audio device
//   for playback", VOD 与直播一起挂. 这条断言就是防再猜一次.
ok(/AUDIO_TYPE_BLUETOOTH = 4/.test(player), 'player: 蓝牙 type=4 (跳转表取证: 4 -> bluealsa:DEV=)')
ok(!/AUDIO_TYPE_BLUETOOTH = 1/.test(player), 'player: 绝不用 type=1 (那是 tc_digital, 打不开设备)')
// bluetooth.getCurrentDevices() 会把"已配对但没连"的设备也列出来 —— "不接耳机也炸"就是这个原因
ok(/Connected: yes/.test(player), 'player: 只认 bluetoothctl 的 Connected: yes, 不信配对列表')
// 本机 bluez 5.58: `info`(不带地址) 未连接时报 "Missing device address argument",
// `devices Connected` 报 "Too many arguments" —— 必须枚举后逐个查 (真机验过)
ok(/bluetoothctl devices/.test(player) && /CONNECTED \(\[0-9A-Fa-f:\]\{17\}\)/.test(player),
  'player: 枚举已配对设备再逐个查 Connected (两种省事写法在本机都取不到)')
ok(/bluealsa:DEV=/.test(player), 'player: 日志回显 bluealsa:DEV=<mac> (排查用)')
// 真机 2026-10-17: bluez 会谎报连接状态 (hcitool con 有 ACL, bluetoothctl 说 Connected: no),
// 后果是"以为没连蓝牙 -> 不切输出 -> 声音还在扬声器", 且 bluealsa 建不出 A2DP PCM.
// 所以判据必须是两级: 先 bluez 扫, 再拿链路层真相交叉验证, 并补一次 connect 纠正.
ok(/hcitool con/.test(player), 'player: 用 hcitool con 的链路层真相交叉验证 bluez 状态')
ok(/bluetoothctl connect ' \+ link\[1\]/.test(player), 'player: 对谎报的设备补 connect 纠正')
// 低延迟档 (HFP/SCO): 插件只接受 [a2dp, sco] (BOGUS 对照实验真机验过)
ok(/btAudioMode/.test(player) && /',PROFILE=sco'/.test(player), 'player: 支持 SCO 低延迟档 (拼 bluealsa PROFILE)')
ok(/btAudioMode: \['a2dp', 'enum', \['a2dp', 'sco'\]\]/.test(cfg), 'config: btAudioMode 枚举 a2dp/sco')
ok(/k: 'btAudioMode'/.test(setv), 'settings: 蓝牙音频模式有可选行 (音质优先/低延迟)')
ok(/getCfg\('btaudioMs'\)/.test(player), 'player: 蓝牙音画补偿读设置页的 btaudioMs')
// bluealsa 的 PCM 认 device/profile/delay; libfalcon 只拼 DEV= -> 延迟被少报 -> 画面超前.
// 补偿必须拼成设备串的 DELAY=<µs> (插件键名已从 libasound_module_pcm_bluealsa.so 校验)
ok(/',DELAY=' \+ \(comp \* 1000\)/.test(player), 'player: 补偿拼成 bluealsa DELAY=<µs>')
// 真机对照实验 (aplay): DELAY=0 / -100000 / 2000000 都能建出 a2dpsrc/sink 并正常开播,
// 所以"声音超前就减小"这个方向可用 -> 不再夹负值
ok(!/Math\.max\(0, Math\.round\(comp\)\)/.test(player), 'player: 补偿不再夹负值 (插件接受负 delay, 已真机验证)')
ok(/comp = Math\.round\(comp\)/.test(player), 'player: 补偿只取整, 保留正负两个方向')
ok(/isFinite\(comp\)\) comp = 200/.test(player), 'player: 设置缺省时兜底 200ms')
ok(/execAsync\(SCAN_BT_CMD\)/.test(player) && /var SCAN_BT_CMD = /.test(player),
  'player: 蓝牙探测用 execAsync + 模块级命令常量 (同步 exec 冻主线程)')
// ★★ 血泪约束 (真机炸过两次: 0.9.64 / 0.9.71): native 的 setAudioDeviceType 内部是
//   unInstallAlsasink()/installAlsasink(); 管线未建时调用 -> "Could not open audio device
//   for playback", 而且该错误是**全局**的, 之后连扬声器播放也一起挂.
//   所以 setAudioDeviceType 只允许在 state=4 (playing=true, 管线已建) 时发.
ok(!/applyAudioRoute\(\{/.test(player), 'player: play(0) 之前绝不调 applyAudioRoute (管线未建时会打坏音频设备)')
ok(/if \(!this\.playing\) return/.test(player), 'player: applyAudioRoute 有 playing 硬守卫')
ok(/if \(gen !== self\.generation \|\| !self\.\$page\) return\n        self\.startPlay\(gen\)/.test(player.replace(/\r/g,'')),
  'player: 定时器只做 startPlay, 不掺音频切换')
ok(/视频就绪 t=\+/.test(player) && /PLAYING t=\+/.test(player), 'player: 起播时间线日志 (取流/视频就绪/PLAYING 带 ms 偏移)')
ok(!/bilinet\.exec\(/.test(player), 'player: 不许出现同步 exec')
ok(/audioProbed = false/.test(player), 'player: 换源后要重新判定输出设备')

ok(/liveReconnect: function/.test(player) && /reconnectCount >= 3/.test(player), 'player: 断流重连有次数上限 (有限次)')
ok(/liveReconnect: function[\s\S]{0,400}var gen = \+\+this\.generation/.test(player), 'player: 每次重连换 generation')
ok(/setTimer\(this, 1500, function \(\) \{ if \(gen === self\.generation\) self\.fetchAndOpen\(gen\) \}\)/.test(player),
  'player: 过期重连回调不复活 (定时器里有 generation 守卫)')
ok(/onUnload: function[\s\S]{0,300}this\.generation\+\+/.test(player), 'player: onUnload 递增 generation 让在途回调失效')
ok(/liveStartedAt = 0[\s\S]{0,120}reconnectCount = 0/.test(player), 'player: 换房间/换源时归零已播时长与重连预算')

ok(/getVideoDetail\(this\.bvid\)/.test(player) && /getPlayUrl\(self\.bvid, cid\)/.test(player),
  'player: 点播取流路径保留')
ok(/if \(self\.resumeOn && !self\._resumeRead\)/.test(player), 'player: 点播断点续播保留')
ok(/fitRect\(e\.video_width, e\.video_height\)/.test(player), 'player: 画面几何 (hole 与画面贴合) 直播/点播共用')

// ================= 6. 列表页: 不再内嵌播放 =================
const livePage = readSrc('pages/live/live.vue')
ok(!/<video\b/.test(livePage), 'live.vue: 已删除内嵌 <video>')
ok(!/<hole\b/.test(livePage), 'live.vue: 已删除内嵌 <hole>')
ok(!/vrectStyle|fitRect|reloadRoom|startDanmaku/.test(livePage), 'live.vue: 已删除内嵌播放的几何/重连/弹幕逻辑')
ok(/\$falcon\.navTo\('room', \{ roomid: String\(r\.roomid\), title: r\.title \}\)/.test(livePage),
  'live.vue: 点房间卡片进独立直播间页')
ok(/searchLive\(kw, nextPage\)/.test(livePage), 'live.vue: 保留搜索')
ok(/hotAreas/.test(livePage) && /tip\(/.test(livePage), 'live.vue: 保留分区快捷与状态提示')

// ================= 7. 房间页: 信息 + 弹幕轮询 + 两个动作 =================
const roomPage = readSrc('pages/room/room.vue')
ok(/import \{[^}]*getRoomInfo[^}]*\} from '\.\.\/\.\.\/services\/live\.js'/.test(roomPage), 'room.vue: 走 services/live.js')
ok(/getLiveDanmaku/.test(roomPage), 'room.vue: 弹幕走 getLiveDanmaku')
ok(/DM_INTERVAL_MS = 8000/.test(roomPage) && /setInterval\(tick, DM_INTERVAL_MS\)/.test(roomPage), 'room.vue: 弹幕 8s 轮询')
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
ok(/未开播[\s\S]{0,40}刷新|点「刷新」重试/.test(roomPage), 'room.vue: 未开播给出可重试提示而不是空白')

// ================= 8. 三个页面脚本可被真实 ES 链接 =================
const mods = [['room', await import(SRC + 'pages/room/room.vue')],
  ['player', await import(SRC + 'pages/player/player.vue')],
  ['live', await import(SRC + 'pages/live/live.vue')]]
for (const [name, mod] of mods) {
  const d = mod.default
  ok(!!(d && typeof d === 'object' && d.name === name), name + '.vue: default 导出且 name 与页面名一致')
  ok(!!(d.methods && typeof d.methods.onShow === 'function'), name + '.vue: onShow 挂在 methods 里')
  ok(!!(d.methods && typeof d.methods.onUnload === 'function'), name + '.vue: onUnload 挂在 methods 里')
  ok(!d.onShow && !d.onUnload && !(d.methods && d.methods.onHide === undefined && d.onHide), name + '.vue: 生命周期没漏到组件根级 (0.9.61 事故)')
}
ok(typeof mods[1][1].default.methods.onNewOptions === 'function', 'player.vue: onNewOptions 挂在 methods 里')
ok(mods[1][1].default.methods.liveReconnect !== undefined, 'player.vue: liveReconnect 成功链接 (命名导出没漏)')
ok(mods[0][1].default.methods.startDanmaku !== undefined && mods[1][1].default.methods.startDanmaku === undefined,
  'room.vue 有 startDanmaku, player.vue 没有 (职责没串)')

// ================= 9. 直播态识别的真实行为 (不是只读源码) =================
const PM = mods[1][1].default.methods
function mkVm() { const vm = {}; for (const k in PM) vm[k] = PM[k]; return vm }
const vm1 = mkVm(); vm1.applyOptions({ roomid: '123' })
eq([vm1.mode, vm1.roomid], ['live', 123], 'player: 只带 roomid 也进直播态')
const vm2 = mkVm(); vm2.applyOptions({ bvid: 'BV1TEST', page: '2', title: 'x' })
eq([vm2.mode, vm2.roomid, vm2.bvid, vm2.pageNo], ['', 0, 'BV1TEST', 2], 'player: 点播 options 不进直播态且字段照旧')
const vm3 = mkVm()
vm3.applyOptions({ mode: 'live', roomid: '111' })
vm3.liveStartedAt = 111; vm3.liveElapsedSec = 600; vm3.reconnectCount = 3
vm3.applyOptions({ mode: 'live', roomid: '222' })
eq([vm3.liveStartedAt, vm3.liveElapsedSec, vm3.reconnectCount], [0, 0, 0], 'player: 换房间归零已播时长与重连预算')
const vm4 = mkVm()
vm4.applyOptions({ mode: 'live', roomid: '333' })
vm4.reconnectCount = 2
vm4.applyOptions({ mode: 'live', roomid: '333' })
eq(vm4.reconnectCount, 2, 'player: 同一房间重复 applyOptions 不重置重连预算')
const PC = mods[1][1].default.computed
eq(PC.isLive.call(vm4), true, 'player: isLive 计算属性在直播 options 下为真')
eq(PC.isLive.call(mkVm()), false, 'player: 空 options 下 isLive 为假 (点播默认)')

// ================= 10. 房间页弹幕轮询的真实行为 =================
// 用替换 globalThis.setInterval 的办法把"8s 定时器"握在手里, 手动驱动 tick,
// 不去等真实 8 秒 —— 覆盖的是页面自己的轮询/去重/停止逻辑, 不是 bili.js 的取值逻辑.
const RM = mods[0][1].default.methods
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
let captured = null
globalThis.setInterval = (fn, ms) => { captured = { fn, ms }; return 7 }
globalThis.clearInterval = () => { captured = null }
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)) }

const dmFeed = (ids) => JSON.stringify({
  code: 0,
  data: { room: ids.map((id) => ({ id_str: id, nickname: '观众' + id, text: '弹幕' + id, timeline: 't' })) }
})
let dmRound = 0
reply = (url) => (url.indexOf('/dM/gethistory') >= 0 ? dmFeed(dmRound++ === 0 ? ['1', '2'] : ['1', '2', '3']) : body({}))

const roomVm = { roomid: 12345, danmus: [], dmTimer: null, statusTimer: null, info: { live: true } }
for (const k in RM) roomVm[k] = RM[k]
RM.startDanmaku.call(roomVm)
ok(!!(captured && captured.ms === 8000), 'room.vue: 弹幕轮询注册 8s 定时器 (实际 ' + (captured && captured.ms) + ')')
await flush()
eq(roomVm.danmus.length, 0, 'room.vue: 首轮只建索引, 不刷屏')
captured.fn()
await flush()
eq(roomVm.danmus.map((d) => d.id), ['3'], 'room.vue: 第二轮只追加新增弹幕 (重复 id 不出第二次)')
RM.stopDanmaku.call(roomVm)
ok(captured === null && roomVm.dmTimer === null, 'room.vue: stopDanmaku 清掉定时器 (卸载/离页后不再轮询)')
globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval


// ================= 11. 直播发现: 推荐 / 关注 (两条真机取证过的接口) =================
// 被弃用的一条是 xlive/web-interface/v1/second/getList (热门分区榜) —— 本机恒 -352,
// 与 getInfoByRoom 同款风控. 这里钉死"不许退回它", 免得下次图省事又接上.
const liveSvc = await import(SRC + 'services/live.js')
reply = (url) => {
  if (url.indexOf('room/v1/room/get_user_recommend') >= 0) {
    return JSON.stringify({ code: 0, msg: 'ok', data: [
      { roomid: 6650029, title: '【直播】2026IVL秋季赛', uname: '第五人格赛事', face: '//i2.hdslb.com/f.jpg',
        online: 1076663, user_cover: '//i0.hdslb.com/c.jpg', system_cover: '//i0.hdslb.com/k.jpg', areaName: '赛事' },
      { roomid: 0, title: '脏数据 (roomid<=0)' }
    ] })
  }
  if (url.indexOf('relation/v1/feed/feed_list') >= 0) {
    return JSON.stringify({ code: 0, data: { results: 1, page: '1', pagesize: '20', list: [
      { roomid: 164725, title: '请user查看最新动态', uname: '机器工具人', face: '//i0.hdslb.com/f2.jpg',
        pic: '//i0.hdslb.com/p.jpg', online: 1031 }
    ] } })
  }
  if (url.indexOf('second/getList') >= 0) return JSON.stringify({ code: -352, message: '-352' })
  return body({})
}
const recRooms = await liveSvc.getRecommendRooms(1)
eq(recRooms.length, 1, '推荐: 过滤 roomid<=0 的脏数据')
eq([recRooms[0].roomid, recRooms[0].up, recRooms[0].online], [6650029, '第五人格赛事', 1076663],
  '推荐: roomid/uname/online 归一化')
eq(recRooms[0].cover.indexOf('https://'), 0, '推荐: 协议相对封面补成 https')
eq(recRooms[0].area, '赛事', '推荐: 分区名透传')
const fdRooms = await liveSvc.getFollowedLives(1)
eq([fdRooms.length, fdRooms[0].roomid, fdRooms[0].up, fdRooms[0].online], [1, 164725, '机器工具人', 1031],
  '关注: 读 data.list 并归一化')
ok(reqUrls.some((u) => u.indexOf('room/v1/room/get_user_recommend?page=1&page_size=20') >= 0),
  '推荐接口与参数 (真机 code:0)')
ok(reqUrls.some((u) => u.indexOf('relation/v1/feed/feed_list?page=1&pagesize=20') >= 0),
  '关注接口与参数 (真机 code:0)')
try { await liveSvc.getRecommendRooms(1) } catch (e) {}
// 只看代码行: 注释里会提到这个被弃用的接口 (解释为什么不退回去)
const liveSvcCode = readSrc('services/live.js').split('\n').filter((ln) => ln.trim().indexOf('//') !== 0).join('\n')
ok(!/second\/getList/.test(liveSvcCode), 'live.js: 不许退回被风控的 second/getList')

// live.vue: 三个入口 + 各自的数据源
ok(/getRecommendRooms/.test(livePage) && /getFollowedLives/.test(livePage), 'live.vue: 用推荐/关注两个接口')
ok(/'推荐'/.test(livePage) && /'关注'/.test(livePage) && /'搜索'/.test(livePage), 'live.vue: 三入口 (推荐/关注/搜索)')
ok(/hasCookie/.test(livePage) && /登录后才能看到关注的主播/.test(livePage), 'live.vue: 关注需要登录时给明确提示')
ok(/loaded: \{ rec: false, follow: false, search: false \}/.test(livePage), 'live.vue: 三个分类各自记"已加载"')

// player: 直播起播看门狗 (真机现象: 取流成功但元素从不进 PLAYING, 界面永久停在"缓冲中")
ok(/armLiveWatchdog/.test(player) && /disarmLiveWatchdog/.test(player), 'player: 直播起播看门狗与解除')
// 真机实测起播要 ~60s: 看门狗必须是"静默 N 秒才换线", 不能用固定超时打断能起播的流
ok(/liveProgressAt = Date.now\(\)[\s\S]{0,200}setTicker\(this, 6000/.test(player)
  || /setTicker\(this, 6000[\s\S]{0,400}liveProgressAt/.test(player), 'player: 看门狗周期检查 + 进度时间戳')
ok(/idle < 25000/.test(player), 'player: 只有连续静默 25s 才换线路 (不是固定超时)')
ok(!/setTimer\(this, 12000, function \(\) \{\s*\n\s*self\.liveWatchdog = null/.test(player), 'player: 已去掉 12s 固定超时看门狗')
ok(/getLiveRoomPlayUrl\(this\.roomid, this\.liveSrcTry\)/.test(player), 'player: 换线路靠线路序号')
const bufFn = (player.match(/onEvtBuffer: function \(e\) \{[\s\S]*?\n    \},/) || [''])[0]
ok(/if \(this\.isLive\) \{/.test(bufFn) && /缓冲中…/.test(bufFn), 'player: 直播只报"缓冲中…", 不报数字')
ok(bufFn.indexOf("'缓冲中 ' + p + '%'") > bufFn.indexOf('this.isLive'),
  'player: 数字百分比在直播早返回之后才可能执行 (HLS 滑动窗口会长期停在 99%)')
ok(/liveLastState/.test(player), 'player: 直播 state 变化写进设备日志 (便于真机定位)')
// 真机 2026-10-11 15:09: 直播 state 以 4->3->2->3->4 每秒约 5 次抖动 = 画面 1s 就卡.
// 这不是 JS 造成的, 但 JS 侧必须能自救: 抖到阈值换下一条候选协议, 且只换一次.
ok(/this\.liveFlapN > 8/.test(player) && /nowMs - this\.liveFlapAt > 15000/.test(player),
  'player: 直播状态抖动检测 (阈值 + 15s 节流)')
ok(/this\.liveSrcTry < 2/.test(player), 'player: 抖动换线最多换两条 (不无限循环)')

console.log = realLog
for (const m of failMsgs) realLog('BAD  ' + m)
realLog('')
realLog(fails === 0
  ? ('CHECK-LIVE PASSED (' + pass + ' 断言: 房间信息归一化/字段兜底/开播态判定/弹幕去重/播放器直播契约/列表页无内嵌播放/三页真实链接)')
  : (fails + ' 个断言失败 / 共 ' + (pass + fails)))
process.exit(fails === 0 ? 0 : 1)