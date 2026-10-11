// 直播间服务 —— 只做"取房间信息 + 归一化", 取流与弹幕继续复用 services/bili.js 的既有实现
// (那两条已在真机验证过 URL 与降级策略, 不在这里重复一套).
//
// 接口来源 (bilibili-API-collect docs/live/info.md, 但**接口选择按真机实测改了**, 见 getRoomInfo 注释):
//   GET https://api.live.bilibili.com/room/v1/Room/get_info?room_id=<号>          <- 本机可用
//   GET https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=<号>  <- 主播名/头像
//   (getInfoByRoom 在本机恒 -352, 已弃用)
//   响应: data.room_info{room_id,short_id,title,cover,area_name,parent_area_name,live_status,online,description}
//         data.anchor_info.base_info{uname,face}
//         data.watched_show.num (看过人数)
//   live_status: 0 未开播 / 1 直播中 / 2 轮播
//
// 未在真机验证 (只能拿真实开播房间确认, 本文件里全是显式兜底, 不猜服务端语义):
//   - 字段命名按官方文档 + 匿名 curl 结果, 真机首次进房间要核对 title/online/watched 是否下发;
//   - 匿名请求在个别网络出口可能被风控 (返回验证页 -> 这里抛「接口被风控拦截」);
//   - description 是否总为"公告" (很多房间为空), 为空时页面不渲染公告行;
//   - 短号进 / 真实号出: room_info.room_id 缺失时这里回落成入参, 是否符合 B 站行为待真机核对.
import { getLiveRoomPlayUrl, getLiveDanmaku } from './bili.js'
import { bilinet } from './native.js'
import { log } from './log.js'

function num(v, def) {
  const n = Number(v)
  return Number.isFinite(n) ? n : (def === undefined ? 0 : def)
}

// 协议相对 URL ('//i0.hdslb.com/x.jpg') 补 https —— 封面/头像都来自 B 站 CDN
function httpsUrl(u) {
  const s = String(u == null ? '' : u).trim()
  if (s === '') return ''
  return s.indexOf('//') === 0 ? 'https:' + s : s
}

// 同步/异步取 JSON: 旧 .so 没有 httpGetAsync 时退回同步 httpGet (与 services/bili.js 同一约定)
async function getJson(url, timeoutSec) {
  const to = timeoutSec || 12
  const s = (bilinet && typeof bilinet.httpGetAsync === 'function')
    ? await bilinet.httpGetAsync(url, to)
    : bilinet.httpGet(url, to)
  if (!s) throw new Error('请求失败 (空响应)')
  try {
    return JSON.parse(s)
  } catch (e) {
    if (String(s).indexOf('<!DOCTYPE') === 0 || String(s).indexOf('<html') === 0) {
      throw new Error('接口被风控拦截 (风控验证页)')
    }
    throw new Error('接口返回非 JSON: ' + String(s).substring(0, 100))
  }
}

const LIVE_STATUS_TEXT = { 0: '未开播', 1: '直播中', 2: '轮播中' }

/**
 * live_status 归一化: 缺失/非数字记成 -1 (未知) —— 绝不把"没拿到"当成"未开播"
 * @returns {'未开播'|'直播中'|'轮播中'|'状态未知'}
 */
export function liveStateText(status) {
  const n = Number(status)
  return Number.isFinite(n) ? (LIVE_STATUS_TEXT[n] || '状态未知') : '状态未知'
}

/**
 * 取直播间详情并归一化
 * @returns {Promise<{roomid:number,shortId:number,title:string,cover:string,up:string,face:string,
 *   area:string,parentArea:string,online:number,watched:number,liveStatus:number,
 *   liveText:string,live:boolean,notice:string}>}
 */
// ★ 真机取证 (2026-10-11, 序列号 9E11700007500215): getInfoByRoom 在本机被风控挡成
//   {"code":-352} —— 带 Cookie、带 Referer、换 UA、加 web_location 全部一样, 是接口级拦截,
//   不是登录态问题。同一次探测里 room/v1/Room/get_info 与 getRoomPlayInfo v2 都是 code=0,
//   所以信息面改走这两个可用口, 主播名/头像单独取 (get_anchor_in_room)。
//   老实现只打一条"信息失败"就整页空着 —— 那是把"接口被风控"当成了"房间不存在"。
function pickRoom(d) {
  const room = d || {}
  const raw = room.live_status
  const known = raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw))
  return {
    roomid: num(room.room_id, 0),
    shortId: num(room.short_id, 0),
    title: String(room.title || '').trim(),
    cover: httpsUrl(room.user_cover || room.cover || room.keyframe),
    area: String(room.area_name || ''),
    parentArea: String(room.parent_area_name || ''),
    online: num(room.online, 0),
    watched: num(room.attention, 0),
    notice: String(room.description || '').trim(),
    liveStatus: known ? Number(raw) : -1
  }
}

export async function getRoomInfo(roomid) {
  const rid = String(roomid == null ? '' : roomid).trim()
  if (!rid) throw new Error('缺少直播间号')
  // 两个信息口都是匿名可用; 谁先回就用谁, 全失败才报错
  const urls = [
    'https://api.live.bilibili.com/room/v1/Room/get_info?room_id=' + encodeURIComponent(rid),
    'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' + encodeURIComponent(rid)
      + '&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8'
  ]
  let base = null
  let lastErr = null
  for (let i = 0; i < urls.length; i++) {
    try {
      const body = await getJson(urls[i])
      if (body && body.code === 0 && body.data) { base = pickRoom(body.data); break }
      lastErr = new Error((body && (body.message || body.msg)) || ('直播间信息失败 code=' + (body && body.code)))
    } catch (e) { lastErr = e }
  }
  if (!base) throw (lastErr || new Error('直播间信息获取失败'))
  // 主播名/头像: 失败不挡整页 (房间信息已经拿到了)
  try {
    const a = await getJson('https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=' + encodeURIComponent(rid))
    const info = (a && a.code === 0 && a.data && a.data.info) || {}
    base.up = String(info.uname || '').trim()
    base.face = httpsUrl(info.face)
  } catch (e) {
    base.up = ''
    base.face = ''
    try { log('直播间', '主播信息失败 (不影响房间信息): ' + (e && e.message ? e.message : e)) } catch (e2) {}
  }
  if (!base.roomid) base.roomid = num(rid, 0)
  base.liveText = liveStateText(base.liveStatus)
  base.live = base.liveStatus === 1
  try { log('直播间', 'room=' + base.roomid + ' ' + base.liveText + ' up=' + base.up + ' online=' + base.online) } catch (e) {}
  return base
}

/**
 * 弹幕去重器: 8s 轮询 gethistory 每轮都给"最近 10 条", 绝大多数是上一轮已经出过的.
 * 只记最近 maxSeen 条 id (超出丢最旧的), 内存有界; 极端密集房间可能重出一条, 这是已知取舍.
 * @returns {(list:Array) => Array} 只返回本轮新增的弹幕
 */
export function createDanmakuFilter(maxSeen) {
  const cap = num(maxSeen, 400) || 400
  const seen = {}
  const order = []
  return function pick(list) {
    const out = []
    if (!list || typeof list.length !== 'number') return out
    for (let i = 0; i < list.length; i++) {
      const dm = list[i]
      if (!dm || dm.id === undefined || dm.id === null || dm.id === '') continue
      const key = 'd' + dm.id
      if (seen[key] === 1) continue
      seen[key] = 1
      order.push(key)
      if (order.length > cap) { try { delete seen[order.shift()] } catch (e) {} }
      out.push(dm)
    }
    return out
  }
}

// 直播取流 / 弹幕: 直接转出 bili.js 的实现, 免得调用方到处 import 两个模块
export { getLiveRoomPlayUrl, getLiveDanmaku }

// 人气排版 (列表/详情共用, 免得两处漂移)
export function onlineText(n) {
  const v = Number(n) || 0
  if (v >= 10000) return (v / 10000).toFixed(1) + '万'
  return String(v)
}