// 消息中心服务 —— 分类读取 + 私信会话. 只做「请求 + 归一化」, 不碰 UI.
//
// 接口来源与状态:
//   回复  /x/msgfeed/reply      (已在 pages/msg 用过, 真机验证过需要 SESSDATA, 读取不需要 csrf)
//   @我   /x/msgfeed/at
//   赞    /x/msgfeed/like
//   系统  /x/msgfeed/sys_msg
//   会话列表 https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions?session_type=1&group_fold=1&unfollow_fold=0
//   会话消息 https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=<mid>&session_type=1&size=<n>
//   发送私信 POST https://api.vc.bilibili.com/web_im/v1/web_im/send_msg (表单: msg[sender_uid]/msg[receiver_id]/
//            msg[receiver_type]=1/msg[msg_type]=1/msg[content]/csrf/csrf_token)
// 未真机验证: at/like/sys_msg 三类与私信三个接口只在离线桩件里跑过; 字段名以 bilibili-API-collect
//   docs/message/** 与 PiliNara 的 lib/http/msg.dart 形状核对过, 真机首次进入需核对一次真实返回.
//
// 发送**绝不自动重试**: native 的 curl 固定带 --retry 1, POST 会被重放, 重复发私信不可接受。
// 所以这里只发一次, 失败把错误抛给页面, 由页面保留草稿并给「重试」入口.
import { bilinet } from './native.js'
import * as auth from './auth.js'

function hasAsync() { return !!(bilinet && typeof bilinet.httpGetAsync === 'function') }

function stripTags(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '') }

function fmtTime(sec) {
  const n = Number(sec) || 0
  if (!n) return ''
  function p(x) { return x < 10 ? '0' + x : '' + x }
  const d = new Date(n * 1000)
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
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

// 四类消息的公共归一化: id / 时间 / 用户 / 标题 / 正文 / 跳转 uri
function mapFeedItems(items) {
  const out = []
  const arr = items || []
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i] || {}
    const user = it.user || {}
    const item = it.item || {}
    let face = user.avatar || ''
    if (face.indexOf('//') === 0) face = 'https:' + face
    out.push({
      id: String(it.id || ''),
      time: Number(it.reply_time || it.at_time || it.like_time || it.time) || 0,
      uname: user.nickname || '',
      face: face,
      title: stripTags(item.title || ''),
      content: stripTags(item.target_reply_content || item.source_content || item.root_reply_content || item.content || ''),
      uri: item.uri || item.native_uri || '',
      raw: it
    })
  }
  return out
}

// 分类 -> 接口路径
const FEED_PATH = {
  reply: '/x/msgfeed/reply',
  at: '/x/msgfeed/at',
  like: '/x/msgfeed/like',
  sys: '/x/msgfeed/sys_msg'
}

export const MSG_TABS = [
  { k: 'reply', n: '回复' },
  { k: 'at', n: '@我' },
  { k: 'like', n: '赞' },
  { k: 'sys', n: '系统' },
  { k: 'im', n: '私信' }
]

/**
 * 分类消息列表 (游标分页): cursor 为上一页返回的 {id, time}, 首次传 null
 * @returns {Promise<{items:Array, cursor:Object|null, hasMore:boolean}>}
 */
export async function getMsgList(kind, cursor) {
  const path = FEED_PATH[kind]
  if (!path) throw new Error('未知的消息分类: ' + kind)
  let url = 'https://api.bilibili.com' + path + '?platform=web&web_location=333.40138'
  if (cursor && cursor.id) {
    url += '&id=' + encodeURIComponent(cursor.id)
    const t = cursor.time || ''
    if (kind === 'reply') url += '&reply_time=' + encodeURIComponent(t)
    else if (kind === 'at') url += '&at_time=' + encodeURIComponent(t)
    else if (kind === 'like') url += '&like_time=' + encodeURIComponent(t)
    else url += '&time=' + encodeURIComponent(t)
  }
  const body = await getJson(url)
  if (!body || body.code !== 0 || !body.data) throw new Error(msgErr(body, '消息'))
  const items = mapFeedItems(body.data.items)
  const c = body.data.cursor || null
  return {
    items: items,
    cursor: c,
    hasMore: !!(c && !c.is_end && !c.is_end_time)
  }
}

/**
 * 私信会话列表
 * @returns {Promise<Array<{talkerId, name, face, content, time, unread, timeText}>>}
 */
export async function getSessions() {
  const url = 'https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions?session_type=1&group_fold=1&unfollow_fold=0&sort_rule=2&build=0&mobi_app=web'
  const body = await getJson(url)
  if (!body) throw new Error('会话接口无响应')
  if (body.code !== 0) throw new Error(msgErr(body, '会话'))
  const list = (body.data && body.data.session_list) || []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {}
    const last = s.last_msg || {}
    let face = s.avatar || ''
    if (face.indexOf('//') === 0) face = 'https:' + face
    let content = String(last.content || '')
    // 私信正文是 JSON 串 ({"content":"..."}), 解析失败就原样显示
    try {
      const j = JSON.parse(content)
      if (j && typeof j.content === 'string') content = j.content
    } catch (e) {}
    out.push({
      talkerId: Number(s.talker_id) || 0,
      name: String(s.name || s.talker_name || ''),
      face: face,
      content: stripTags(content).substring(0, 60),
      time: Number(s.session_ts || last.timestamp) || 0,
      timeText: fmtTime(Number(s.session_ts || last.timestamp) || 0),
      unread: Number(s.unread_count) || 0
    })
  }
  return out
}

/**
 * 会话内消息 (倒序翻页): endSeq=0 取最近一页
 * @returns {Promise<{items:Array, endSeq:number, hasMore:boolean}>}
 */
export async function getSessionMsgs(talkerId, endSeq) {
  const tid = Number(talkerId) || 0
  if (!tid) throw new Error('缺少会话对象 mid')
  const url = 'https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=' + tid
    + '&session_type=1&size=20&build=0&mobi_app=web' + (endSeq ? ('&end_seqno=' + Number(endSeq)) : '')
  const body = await getJson(url)
  if (!body || body.code !== 0) throw new Error(msgErr(body, '会话消息'))
  const d = body.data || {}
  const list = d.messages || []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {}
    let text = String(m.content || '')
    try { const j = JSON.parse(text); if (j && typeof j.content === 'string') text = j.content } catch (e) {}
    items.push({
      msgKey: String(m.msg_key || m.msg_seqno || i),
      seqno: Number(m.msg_seqno) || 0,
      fromMe: Number(m.sender_uid) === Number(auth.getMid()),
      text: text,
      time: Number(m.timestamp) || 0,
      timeText: fmtTime(Number(m.timestamp) || 0)
    })
  }
  // 接口按时间倒序下发, 统一升序交给页面渲染
  items.reverse()
  const end = Number(d.max_seqno) || 0
  const min = items.length ? items[0].seqno : 0
  return { items: items, endSeq: min, hasMore: !!(items.length >= 20 && end && min > 1) }
}

/**
 * 发送私信 —— 只尝试一次, 不自动重试 (curl --retry 会重放 POST)
 */
export async function sendPrivateMsg(talkerId, text) {
  const tid = Number(talkerId) || 0
  const content = String(text == null ? '' : text)
  if (!tid) throw new Error('缺少会话对象 mid')
  if (content.trim() === '') throw new Error('内容为空')
  const csrf = auth.getCsrf()
  const form = 'msg%5Bsender_uid%5D=' + encodeURIComponent(String(auth.getMid() || 0))
    + '&msg%5Breceiver_id%5D=' + encodeURIComponent(String(tid))
    + '&msg%5Breceiver_type%5D=1'
    + '&msg%5Bmsg_type%5D=1'
    + '&msg%5Bcontent%5D=' + encodeURIComponent(JSON.stringify({ content: content }))
    + '&csrf=' + encodeURIComponent(csrf)
    + '&csrf_token=' + encodeURIComponent(csrf)
    + '&build=0&mobi_app=web'
  const headers = ['Content-Type: application/x-www-form-urlencoded']
  if (auth.hasCookie()) headers.push(auth.cookieHeader())
  const url = 'https://api.vc.bilibili.com/web_im/v1/web_im/send_msg'
  const s = hasAsync() && typeof bilinet.httpPostAsync === 'function'
    ? await bilinet.httpPostAsync(url, form, 15, headers)
    : bilinet.httpPost(url, form, 15, headers)
  if (!s) throw new Error('发送失败 (空响应)')
  let body = null
  try { body = JSON.parse(s) } catch (e) { throw new Error('发送返回非 JSON: ' + String(s).substring(0, 80)) }
  if (!body || body.code !== 0) throw new Error(msgErr(body, '发送'))
  return { ok: true }
}

export { fmtTime }
