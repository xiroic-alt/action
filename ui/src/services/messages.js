// 消息中心服务 —— 分类读取 + 私信会话 + 发送. 只做「请求 + 归一化」, 不碰 UI.
//
// ============================ 接口依据 ============================
// 每条 URL 都标了出处; 标「未真机验证」的表示本仓库内**没有真机抓包证据**,
// 只做过离线桩件回归, 首次上机需核对一次真实返回字段.
//
// [已真机验证] 回复  GET https://api.bilibili.com/x/msgfeed/reply
//   出处: 本仓库 pages/msg (0.9.62 起在用) 实测需要 SESSDATA, 读取类不需要 csrf;
//   返回 data.items[] + data.cursor{id,time,is_end}.
// [未真机验证] @我   GET https://api.bilibili.com/x/msgfeed/at
// [未真机验证] 赞    GET https://api.bilibili.com/x/msgfeed/like
// [未真机验证] 系统  GET https://api.bilibili.com/x/msgfeed/sys_msg
//   出处(形状): PiliNara .local/pilinara-reference/lib/http/api.dart:480-487
//     msgFeedReply='/x/msgfeed/reply' / msgFeedAt='/x/msgfeed/at' / msgFeedLike='/x/msgfeed/like',
//     系统通知走 'https://message.bilibili.com/x/sys-msg/query_notify_list?page_size=20&cursor=xxx';
//     lib/http/msg.dart:113-136 用 cursor+page_size, 返回 data 是**数组**(无 cursor 包一层).
//   本实现以任务指定的 /x/msgfeed/sys_msg 为主, 请求失败时回落到 PiliNara 的
//   message.bilibili.com/x/sys-msg/query_notify_list (两条都未真机验证).
// [未真机验证] 会话列表 GET https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions
//   ?session_type=1&group_fold=1&unfollow_fold=0&sort_rule=2
//   出处: PiliNara lib/http/api.dart:495-506 (注释里逐字给出这条 query, 含 sort_rule=2).
// [未真机验证] 会话消息 GET https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs
//   ?talker_id=<mid>&session_type=1&size=20
//   出处: PiliNara lib/http/api.dart:514-526 (注释给出 talker_id/session_type/size/web_location).
// [未真机验证] 发送私信 POST https://api.vc.bilibili.com/web_im/v1/web_im/send_msg
//   出处: PiliNara lib/http/api.dart:684 + lib/http/msg.dart:373-419 (被注释掉的发送实现,
//   给出表单字段清单: msg[sender_uid]/msg[receiver_id]/msg[receiver_type]/msg[msg_type]/
//   msg[msg_status]/msg[dev_id]/msg[timestamp]/msg[new_face_version]/msg[content] +
//   from_firework/build/mobi_app/csrf_token/csrf).
// [未真机验证] 昵称补全 GET https://api.vc.bilibili.com/account/v1/user/cards?uids=1,2
//   出处: PiliNara lib/http/api.dart:511-512 (sessionAccountList = tUrl + '/account/v1/user/cards').
// =================================================================
//
// 发送**绝不自动重试**: native 的 curl 固定带 --retry 1, POST 会被重放, 重复发私信
// 不可接受. 所以这里只发一次, 失败把错误抛给页面, 由页面保留草稿并给「重试」入口.
import { bilinet } from './native.js'
import * as auth from './auth.js'
// 回复类复用 bili.js 里已在真机跑通的实现 (本文件只做归一化, 不重复同一条 URL/游标逻辑)
import { getMsgReplies } from './bili.js'

function hasAsync() { return !!(bilinet && typeof bilinet.httpGetAsync === 'function') }

function stripTags(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '') }

function fmtTime(sec) {
  const n = Number(sec) || 0
  if (!n) return ''
  function p(x) { return x < 10 ? '0' + x : '' + x }
  const d = new Date(n * 1000)
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// 'YYYY-MM-DD HH:MM:SS' -> 秒级时间戳 (QuickJS 不保证 Date.parse 能吃空格分隔的串)
function parseTimeText(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''))
  if (!m) return 0
  try {
    return Math.floor(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000)
  } catch (e) { return 0 }
}

function firstNum(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]]
    if (v != null && v !== '') { const n = Number(v); if (n) return n }
  }
  return 0
}

function num(v) { const n = Number(v); return isFinite(n) ? n : 0 }

// 头像统一: 协议补全 + 缩略尺寸 (与 services/bili.js 的 thumb 同规则; 已带 @ 的不重复追加)
function normFace(u) {
  let s = String(u || '')
  if (s.indexOf('//') === 0) s = 'https:' + s
  if (s.indexOf('http://') === 0) s = 'https://' + s.substring(7)
  if (s === '' || s.indexOf('@') > 0) return s
  return s + '@72w_72h_1c.jpg'
}

// 私信正文/系统通知正文可能是 JSON 串 ({"content":".."} / {"web":".."}), 拆不出来就原样用
function unwrapContent(raw) {
  const s = String(raw == null ? '' : raw)
  if (s === '' || s.charAt(0) !== '{') return s
  try {
    const j = JSON.parse(s)
    if (j && typeof j.content === 'string') return stripTags(j.content)
    if (j && typeof j.web === 'string') return stripTags(j.web)
    if (j && typeof j.text === 'string') return stripTags(j.text)
  } catch (e) {}
  return s
}

async function getJson(url, timeoutSec, extraHeaders) {
  const headers = []
  if (extraHeaders) for (let i = 0; i < extraHeaders.length; i++) headers.push(extraHeaders[i])
  if (auth.hasCookie()) headers.push(auth.cookieHeader())
  const s = hasAsync()
    ? await bilinet.httpGetAsync(url, timeoutSec || 15, headers.length ? headers : undefined)
    : bilinet.httpGet(url, timeoutSec || 15, headers.length ? headers : undefined)
  if (!s) throw new Error('请求失败 (空响应)')
  try { return JSON.parse(s) } catch (e) { throw new Error('接口返回非 JSON: ' + String(s).substring(0, 100)) }
}

function msgErr(body, label) {
  if (body && body.code === -101) return '未登录, 请先在「我的」里登录'
  return (body && body.message) || (label + ' 接口错误 code=' + (body && body.code))
}

// ============================ 分类读取 ============================

/** 四类通知 + 私信三个接口的 URL (归一化字段与出处见文件头) */
export const MSG_URLS = {
  reply: 'https://api.bilibili.com/x/msgfeed/reply',
  at: 'https://api.bilibili.com/x/msgfeed/at',
  like: 'https://api.bilibili.com/x/msgfeed/like',
  sys: 'https://api.bilibili.com/x/msgfeed/sys_msg',
  // 未真机验证: /x/msgfeed/sys_msg 失败时的回落 (PiliNara lib/http/msg.dart:113)
  sysFallback: 'https://message.bilibili.com/x/sys-msg/query_notify_list',
  sessions: 'https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions',
  sessionMsgs: 'https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs',
  sendMsg: 'https://api.vc.bilibili.com/web_im/v1/web_im/send_msg',
  userCards: 'https://api.vc.bilibili.com/account/v1/user/cards'
}

/** 分类 chip: 前四类走 /x/msgfeed/*, im 走会话列表 */
export const MSG_TABS = [
  { k: 'reply', n: '回复' },
  { k: 'at', n: '@我' },
  { k: 'like', n: '赞' },
  { k: 'sys', n: '系统' },
  { k: 'im', n: '私信会话' }
]

// 时间字段与列表容器在四类里不统一: reply_time / at_time / like_time; 系统是数组 + time_at
const TIME_KEYS = {
  reply: ['reply_time', 'time', 'timestamp'],
  at: ['at_time', 'time', 'timestamp'],
  like: ['like_time', 'time', 'timestamp'],
  sys: ['ts', 'time', 'timestamp']
}

// 赞是多人结构 (item.users[]), 昵称取前几个拼一下; 单人结构走 user.nickname
function unameOf(it) {
  const u = it.user || {}
  if (u.nickname) return String(u.nickname)
  const arr = it.users || []
  if (arr.length === 0) return ''
  const first = String((arr[0] && arr[0].nickname) || '')
  if (!first) return ''
  return arr.length > 1 ? (first + ' 等' + arr.length + '人') : first
}

function faceOf(it) {
  const u = it.user || {}
  if (u.avatar) return normFace(u.avatar)
  const arr = it.users || []
  return arr.length ? normFace(arr[0] && arr[0].avatar) : ''
}

/**
 * 一类通知的归一化: {id, time, timeText, uname, face, title, content, uri, cursor}
 * cursor 是该条自己的游标值 (回复/@我/赞 = 条目 id; 系统 = 条目 cursor), 供页面兜底翻页
 */
function mapFeedItems(list, kind) {
  const out = []
  const arr = list || []
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i] || {}
    const item = it.item || {}
    const time = firstNum(it, TIME_KEYS[kind] || TIME_KEYS.reply) || parseTimeText(it.time_at)
    const body = item.target_reply_content || item.source_content || item.root_reply_content ||
      item.content || (kind === 'sys' ? unwrapContent(it.content) : '')
    const cid = it.cursor != null && it.cursor !== '' ? it.cursor : it.id
    out.push({
      id: String(it.id == null ? '' : it.id),
      time: time,
      timeText: fmtTime(time),
      uname: unameOf(it),
      face: faceOf(it),
      title: stripTags(item.title || (kind === 'sys' ? it.title : '')),
      content: stripTags(typeof body === 'string' ? body : ''),
      uri: item.uri || item.native_uri || '',
      cursor: cid == null ? '' : String(cid)
    })
  }
  return out
}

function sysList(body) {
  if (Array.isArray(body)) return body
  if (body && Array.isArray(body.data)) return body.data
  if (body && body.data && Array.isArray(body.data.items)) return body.data.items
  return []
}

/**
 * 分类消息列表 (游标分页; 首次传 null)
 * @returns {Promise<{items:Array, cursor:Object|null, hasMore:boolean}>}
 *   cursor 原样透传服务端对象 {id, time, is_end}; 系统类是数组形态, 用最后一条的
 *   cursor 合成一个等价对象, 页面翻页协议因此四类一致.
 */
export async function getMsgList(kind, cursor) {
  if (!MSG_URLS[kind] || kind === 'im') throw new Error('未知的消息分类: ' + kind)
  if (kind === 'reply') {
    // 回复: 走 bili.js 的 getMsgReplies (真机验证过需要 SESSDATA, 读取不需要 csrf),
    // 这里只把它已经归一化过的条目映射进本文件的公共形状.
    const r = await getMsgReplies(
      cursor && cursor.id ? String(cursor.id) : '',
      cursor && cursor.time != null ? String(cursor.time) : '')
    const rows = []
    for (let i = 0; i < r.items.length; i++) {
      const it = r.items[i]
      rows.push({
        id: String(it.id == null ? '' : it.id),
        time: num(it.time),
        timeText: fmtTime(num(it.time)),
        uname: String(it.uname || ''),
        face: normFace(it.face),
        title: stripTags(it.title),
        content: stripTags(it.content),
        uri: it.uri || '',
        cursor: String(it.id == null ? '' : it.id)
      })
    }
    const rc = r.cursor || null
    return { items: rows, cursor: rc, hasMore: !!(rc && !rc.is_end && !rc.is_end_time) }
  }
  const timeKey = (kind === 'reply' ? 'reply_time' : kind === 'at' ? 'at_time' : kind === 'like' ? 'like_time' : 'cursor')
  let url = MSG_URLS[kind] + '?platform=web&web_location=333.40138'
  if (kind === 'sys') url += '&page_size=20'
  if (cursor && cursor.id) {
    url += '&id=' + encodeURIComponent(cursor.id)
    if (kind !== 'sys') url += '&' + timeKey + '=' + encodeURIComponent(cursor.time == null ? '' : cursor.time)
  }
  let body = await getJson(url)
  // 系统通知的主口未真机验证: 明确失败 (非登录问题) 时回落到 PiliNara 记的那条口
  if (kind === 'sys' && body && body.code !== 0 && body.code !== -101) {
    const fb = MSG_URLS.sysFallback + '?page_size=20&mobi_app=web&build=0'
      + (cursor && cursor.id ? ('&cursor=' + encodeURIComponent(cursor.id)) : '')
    try { body = await getJson(fb) } catch (e) {}
  }
  if (!body || body.code !== 0) throw new Error(msgErr(body, '消息'))
  const list = sysList(body)   // 传整个 body: 系统类是 data 数组, 其余类是 data.items
  const items = mapFeedItems(list, kind)
  const c = (body.data && !Array.isArray(body.data) && body.data.cursor) || null
  let outCursor = c
  let hasMore = !!(c && !c.is_end && !c.is_end_time)
  if (kind === 'sys' || !c) {
    const tail = items.length ? items[items.length - 1] : null
    outCursor = tail && tail.cursor !== '' ? { id: tail.cursor, time: tail.time, is_end: false } : null
    hasMore = items.length >= 20
  }
  return { items: items, cursor: outCursor, hasMore: hasMore }
}

// ============================ 私信 ============================

/** 批量补昵称/头像 (会话列表没带名字时用; 失败不影响主流程, 由调用方 try/catch) */
async function fillUserCards(list) {
  const need = []
  for (let i = 0; i < list.length && need.length < 50; i++) {
    if (list[i].talkerId && (!list[i].name || !list[i].face)) need.push(list[i].talkerId)
  }
  if (need.length === 0) return
  const body = await getJson(MSG_URLS.userCards + '?uids=' + need.join(',') + '&build=0&mobi_app=web')
  const map = (body && body.data) || {}
  for (let i = 0; i < list.length; i++) {
    const c = map[String(list[i].talkerId)]
    if (!c) continue
    if (!list[i].name && c.name) list[i].name = String(c.name)
    if (!list[i].face && c.face) list[i].face = normFace(c.face)
  }
}

/**
 * 私信会话列表
 * @returns {Promise<Array<{talkerId, name, face, content, time, timeText, unread}>>}
 */
export async function getSessions() {
  // 出处: PiliNara lib/http/api.dart:495-506 (query 与 sort_rule 逐字来自其注释)
  const url = MSG_URLS.sessions + '?session_type=1&group_fold=1&unfollow_fold=0&sort_rule=2&build=0&mobi_app=web'
  const body = await getJson(url)
  if (body && body.code && body.code !== 0) throw new Error(msgErr(body, '会话'))
  const list = (body && body.data && body.data.session_list) || []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {}
    const last = s.last_msg || {}
    const ts = num(s.session_ts) || num(last.timestamp)
    out.push({
      talkerId: num(s.talker_id),
      name: String(s.name || s.talker_name || ''),
      face: normFace(s.avatar || s.face || ''),
      content: unwrapContent(last.content).substring(0, 60),
      time: ts,
      timeText: fmtTime(ts),
      unread: num(s.unread_count)
    })
  }
  try { await fillUserCards(out) } catch (e) {}
  return out
}

/**
 * 会话内消息 (接口按时间倒序下发, 这里统一成升序)
 * @param {number} talkerId 对方 mid
 * @param {number} endSeq 0 = 最近一页; 其余传上一页返回的 endSeq 往回翻
 * @returns {Promise<{items:Array, endSeq:number, hasMore:boolean}>}
 */
export async function getSessionMsgs(talkerId, endSeq) {
  const tid = num(talkerId)
  if (!tid) throw new Error('缺少会话对象 mid')
  const url = MSG_URLS.sessionMsgs + '?talker_id=' + tid
    + '&session_type=1&size=20&build=0&mobi_app=web&web_location=333.1296'
    + (endSeq ? ('&end_seqno=' + num(endSeq)) : '')
  const body = await getJson(url)
  if (!body || body.code !== 0) throw new Error(msgErr(body, '会话消息'))
  const d = body.data || {}
  const list = d.messages || []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {}
    items.push({
      msgKey: String(m.msg_key || m.msg_seqno || i),
      seqno: num(m.msg_seqno),
      fromMe: num(m.sender_uid) === num(auth.getMid()),
      text: unwrapContent(m.content),
      time: num(m.timestamp),
      timeText: fmtTime(num(m.timestamp))
    })
  }
  items.sort(function (a, b) { return a.seqno - b.seqno })
  const min = items.length ? items[0].seqno : 0
  const hasMore = d.has_more !== undefined
    ? num(d.has_more) === 1
    : (items.length >= 20 && min > 1)
  return { items: items, endSeq: min, hasMore: !!hasMore }
}

// dev_id: 服务端按它做发送去重. QuickJS 没有 crypto.randomUUID, 自己拼 v4 形态.
function makeDevId() {
  const hex = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 32; i++) {
    s += hex.charAt(Math.floor(Math.random() * 16))
    if (i === 7 || i === 11 || i === 15) s += '-'
  }
  return s
}

/**
 * 发送私信 —— 只尝试一次, 不自动重试 (native 的 curl --retry 会重放 POST).
 * 失败把原因抛给页面, 由页面保留草稿并给「重试」入口. 未真机验证.
 */
export async function sendPrivateMsg(talkerId, text) {
  const tid = num(talkerId)
  const content = String(text == null ? '' : text)
  if (!tid) throw new Error('缺少会话对象 mid')
  if (content.trim() === '') throw new Error('内容为空')
  const csrf = auth.getCsrf()
  const mid = auth.getMid() || '0'
  const form = 'msg%5Bsender_uid%5D=' + encodeURIComponent(mid)
    + '&msg%5Breceiver_id%5D=' + encodeURIComponent(String(tid))
    + '&msg%5Breceiver_type%5D=1'
    + '&msg%5Bmsg_type%5D=1'
    + '&msg%5Bmsg_status%5D=0'
    + '&msg%5Bdev_id%5D=' + encodeURIComponent(makeDevId())
    + '&msg%5Btimestamp%5D=' + Math.floor(Date.now() / 1000)
    + '&msg%5Bnew_face_version%5D=1'
    + '&msg%5Bcontent%5D=' + encodeURIComponent(JSON.stringify({ content: content }))
    + '&from_firework=0'
    + '&build=0&mobi_app=web'
    + '&csrf=' + encodeURIComponent(csrf)
    + '&csrf_token=' + encodeURIComponent(csrf)
  const headers = ['Content-Type: application/x-www-form-urlencoded']
  if (auth.hasCookie()) headers.push(auth.cookieHeader())
  const s = hasAsync() && typeof bilinet.httpPostAsync === 'function'
    ? await bilinet.httpPostAsync(MSG_URLS.sendMsg, form, 15, headers)
    : bilinet.httpPost(MSG_URLS.sendMsg, form, 15, headers)
  if (!s) throw new Error('发送失败 (空响应)')
  let body = null
  try { body = JSON.parse(s) } catch (e) { throw new Error('发送返回非 JSON: ' + String(s).substring(0, 80)) }
  if (!body || body.code !== 0) throw new Error(msgErr(body, '发送'))
  return { ok: true }
}

export { fmtTime, unwrapContent, normFace }
