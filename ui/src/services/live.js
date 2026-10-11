// 直播间服务 —— 只做"取房间信息 + 归一化", 取流与弹幕继续复用 services/bili.js 的既有实现
// (那两条已在真机验证过 URL 与降级策略, 不在这里重复一套).
//
// 接口来源 (bilibili-API-collect: docs/live/info.md「获取直播间信息」):
//   GET https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=<短号或真实号>
//   响应: data.room_info{room_id,short_id,title,cover,area_name,parent_area_name,live_status,online}
//         data.anchor_info.base_info{uname,face}
//         data.watched_show.num (看过人数)
//   live_status: 0 未开播 / 1 直播中 / 2 轮播
// 未真机验证: getInfoByRoom 的字段命名以官方文档为准, 真机首次进入时应核对
//   「看过人数」是否下发 (缺失时我们显示为空, 不猜).
import { getLiveRoomPlayUrl, getLiveDanmaku } from './bili.js'
import { bilinet } from './native.js'
import { log } from './log.js'

async function getJson(url, timeoutSec) {
  const s = await bilinet.httpGetAsync(url, timeoutSec || 12)
  if (!s) throw new Error('请求失败 (空响应)')
  try { return JSON.parse(s) } catch (e) { throw new Error('接口返回非 JSON: ' + String(s).substring(0, 100)) }
}

const LIVE_STATUS_TEXT = { 0: '未开播', 1: '直播中', 2: '轮播中' }

export async function getRoomInfo(roomid) {
  const rid = String(roomid == null ? '' : roomid).trim()
  if (!rid) throw new Error('缺少直播间号')
  const url = 'https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=' + encodeURIComponent(rid)
  const body = await getJson(url)
  if (!body || body.code !== 0 || !body.data) {
    throw new Error((body && body.message) || ('直播间信息获取失败 code=' + (body && body.code)))
  }
  const d = body.data || {}
  const room = d.room_info || {}
  const anchor = (d.anchor_info && d.anchor_info.base_info) || {}
  const watched = (d.watched_show && d.watched_show.num) || 0
  const status = Number(room.live_status)
  const info = {
    roomid: Number(room.room_id) || Number(rid) || 0,
    shortId: Number(room.short_id) || 0,
    title: String(room.title || '').trim(),
    cover: String(room.cover || room.keyframe || ''),
    up: String(anchor.uname || ''),
    face: String(anchor.face || ''),
    area: String(room.area_name || ''),
    parentArea: String(room.parent_area_name || ''),
    online: Number(room.online) || 0,
    watched: Number(watched) || 0,
    liveStatus: status,
    liveText: LIVE_STATUS_TEXT[status] || '状态未知',
    live: status === 1,
    notice: String((d.room_info && d.room_info.description) || '')
  }
  try { log('直播间', 'room=' + info.roomid + ' ' + info.liveText + ' up=' + info.up) } catch (e) {}
  return info
}

// 直播取流 / 弹幕: 直接转出 bili.js 的实现, 免得调用方到处 import 两个模块
export { getLiveRoomPlayUrl, getLiveDanmaku }

// 人气排版 (列表/详情共用, 免得两处漂移)
export function onlineText(n) {
  const v = Number(n) || 0
  if (v >= 10000) return (v / 10000).toFixed(1) + '万'
  return String(v)
}
