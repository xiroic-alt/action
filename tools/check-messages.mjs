// 离线公共行为回归: 消息中心分类分页 (PiliNara 式) + 私信会话与发送
// 运行: node tools/check-messages.mjs     (退出码非 0 = 有断言失败)
//
// 覆盖方式: native 的原生 http* 由 globalThis.__bilinet 桩件接管, 登录态用 auth.saveLogin
// 合成, 页面对象经 tools/esm-hooks.mjs 真实加载 <script> 后手动驱动 —— 不触网、不写设备文件、
// 不对真人发任何消息 (POST 只落在桩件上).
import assert from 'node:assert/strict'
import { register } from 'node:module'
import fs from 'node:fs'

const print = console.log.bind(console)
console.log = () => {}
const realNow = Date.now
let now = 1700000000000
Date.now = () => now

let getReply = () => '{"code":0,"data":{}}'
let postReply = () => '{"code":0,"data":{}}'
let calls = []
function record (method, url, data, headers) {
  calls.push({ m: method, u: url, d: data, h: headers })
  return method === 'POST' ? postReply(url, data) : getReply(url)
}
globalThis.__bilinet = {
  readFile: () => '', writeFile: () => true, exec: () => '', mkdirs: () => true, dbOpen: () => false,
  httpGet: (u, t, h) => record('GET', u, null, h),
  httpGetAsync: (u, t, h) => Promise.resolve(record('GET', u, null, h)),
  httpPost: (u, d, t, h) => record('POST', u, d, h),
  httpPostAsync: (u, d, t, h) => Promise.resolve(record('POST', u, d, h))
}
globalThis.$falcon = { Page: class {}, eventMap: {}, navTo () {} }
globalThis.$page = { options: {}, finish () {}, $dom: {} }
register('./esm-hooks.mjs', import.meta.url)

const SRC = new URL('../ui/src/', import.meta.url)
const auth = await import(new URL('services/auth.js', SRC))
const msg = await import(new URL('services/messages.js', SRC))
const chatPage = await import(new URL('pages/chat/chat.vue', SRC))
const msgPage = await import(new URL('pages/msg/msg.vue', SRC))
auth.saveLogin('fixture-sess', 'fixture-csrf', '1741083')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const last = () => calls[calls.length - 1]
const hits = (frag) => calls.filter((c) => c.u.indexOf(frag) >= 0)

// 页面对象: data + methods + computed 一起搬到纯对象上 (computed 用 getter, 因为
// 每个分类各持一份列表/游标, 断言必须读的是"当前分类"的那一份)
function drive (mod) {
  const d = mod.default
  const vm = Object.assign({}, typeof d.data === 'function' ? d.data() : {}, d.methods || {})
  const c = d.computed || {}
  for (const k in c) Object.defineProperty(vm, k, { get: c[k].bind(vm), enumerable: true, configurable: true })
  vm.$page = globalThis.$page
  vm.$refs = {}
  return vm
}

const feed = (items, cursor) => JSON.stringify({ code: 0, data: { items: items, cursor: cursor } })
const replyItem = (id, who, text) => ({
  id: id, reply_time: 10 * id, user: { nickname: who, avatar: '//i0.hdslb.com/' + who + '.jpg' },
  item: { title: 'T' + id, target_reply_content: text, uri: 'https://www.bilibili.com/video/BV1xx411c7mD' }
})
const atItem = (id, who) => ({ id: id, at_time: 10 * id, user: { nickname: who, avatar: '//i1.hdslb.com/a.jpg' }, item: { source_content: '@' + who } })
const unread = () => JSON.stringify({ code: 0, data: { reply: 2, at: 1, like: 0, sys_msg: 1 } })

const tests = []
const test = (name, run) => tests.push({ name: name, run: run })

// ---------------- 1. 四类归一化 (含字段缺失兜底) ----------------
test('四类通知归一化成同一形状, 缺字段不抛错', async () => {
  calls = []
  getReply = (u) => {
    if (u.indexOf('/x/msgfeed/reply') >= 0) {
      return feed([{ id: 11, reply_time: 1700000000, user: { nickname: '甲', avatar: '//i0.hdslb.com/a.jpg' },
        item: { title: '视频标题', target_reply_content: '<b>回了什么</b>', uri: 'https://www.bilibili.com/video/BV1xx411c7mD' } }],
      { id: 11, time: 1700000000, is_end: false })
    }
    if (u.indexOf('/x/msgfeed/at') >= 0) {
      return feed([{ id: 21, at_time: 1700000100, user: { nickname: '乙', avatar: '//i1.hdslb.com/b.jpg' },
        item: { source_content: '在评论里 @ 了你', native_uri: 'bilibili://video/1' } }], { id: 21, time: 1700000100, is_end: true })
    }
    if (u.indexOf('/x/msgfeed/like') >= 0) {
      return feed([{ id: 31, like_time: 1700000200, counts: 3,
        users: [{ nickname: '丙', avatar: '//i2.hdslb.com/c.jpg' }, { nickname: '丁', avatar: '' }],
        item: { title: '被赞的稿件', native_uri: 'bilibili://video/1' } }], { id: 31, time: 1700000200 })
    }
    // 系统: data 直接是数组, content 是 JSON 串, 时间是字符串 (time_at)
    return JSON.stringify({ code: 0, data: [
      { id: 41, cursor: 4001, title: '系统通知', content: JSON.stringify({ web: '<i>维护公告</i>' }), time_at: '2026-10-11 08:09:10' },
      {}
    ] })
  }

  const reply = await msg.getMsgList('reply', null)
  assert.equal(reply.items.length, 1)
  assert.deepEqual(Object.keys(reply.items[0]).sort(),
    ['content', 'cursor', 'face', 'id', 'time', 'timeText', 'title', 'uname', 'uri'], '归一化字段集合')
  assert.equal(reply.items[0].id, '11')
  assert.equal(reply.items[0].uname, '甲')
  assert.equal(reply.items[0].content, '回了什么')
  assert.equal(reply.items[0].cursor, '11')
  assert.equal(reply.items[0].time, 1700000000)
  assert.equal(reply.items[0].face, 'https://i0.hdslb.com/a.jpg@72w_72h_1c.jpg')
  assert.equal(reply.hasMore, true)
  assert.match(hits('/x/msgfeed/reply')[0].u, /\/x\/msgfeed\/reply\?platform=web/)

  const at = await msg.getMsgList('at', null)
  assert.equal(at.items[0].uname, '乙')
  assert.equal(at.items[0].content, '在评论里 @ 了你')
  assert.equal(at.items[0].uri, 'bilibili://video/1')
  assert.equal(at.items[0].face, 'https://i1.hdslb.com/b.jpg@72w_72h_1c.jpg')
  assert.equal(at.hasMore, false)
  assert.equal(at.items[0].cursor, '21')

  const like = await msg.getMsgList('like', null)
  assert.equal(like.items[0].uname, '丙 等2人', '赞是多人结构 (users[])')
  assert.equal(like.items[0].title, '被赞的稿件')
  assert.equal(like.items[0].time, 1700000200)

  const sys = await msg.getMsgList('sys', null)
  assert.equal(sys.items.length, 2, 'data 是数组也要能吃下')
  assert.equal(sys.items[0].title, '系统通知')
  assert.equal(sys.items[0].content, '维护公告', 'content 里的 JSON 取 .web')
  assert.equal(sys.items[0].cursor, '4001')
  assert.equal(sys.items[0].time > 0, true, 'time_at 字符串要转成时间戳')
  assert.equal(sys.hasMore, false)
  assert.equal(sys.items[1].id, '')
  assert.equal(sys.items[1].uname, '')
  assert.equal(sys.items[1].face, '')
  assert.equal(sys.items[1].time, 0)
})

// ---------------- 2. 游标分页只追加不重复 (页面级) ----------------
test('分类分页: 游标只前进, 重复条目只留一条', async () => {
  calls = []
  getReply = (u) => {
    if (u.indexOf('/x/msgfeed/unread') >= 0) return unread()
    if (u.indexOf('/x/msgfeed/reply') >= 0) {
      if (u.indexOf('&id=') < 0) return feed([replyItem(1, 'A', 'a1'), replyItem(2, 'B', 'b1')], { id: 2, time: 20, is_end: false })
      return feed([replyItem(2, 'B', 'b1'), replyItem(3, 'C', 'c1')], { id: 3, time: 30, is_end: true })
    }
    return feed([], { is_end: true })
  }
  const vm = drive(msgPage)
  vm.logged = true
  vm.load(true)
  await sleep(120)
  assert.deepEqual(vm.items.map((i) => i.id), ['1', '2'])
  assert.equal(vm.hasMore, true)
  assert.equal(vm.unread.reply, 2, '未读计数照常拉取')
  vm.loadMore()
  await sleep(120)
  assert.deepEqual(vm.items.map((i) => i.id), ['1', '2', '3'], '只追加且去重')
  assert.equal(vm.hasMore, false)
  const rp = hits('/x/msgfeed/reply')
  assert.equal(rp.length, 2)
  assert.match(rp[1].u, /&id=2&reply_time=20/, '第二页带上一页返回的游标')
})

// ---------------- 3. 每类独立游标 ----------------
test('每个分类各自持有列表与游标, 切回来接着翻', async () => {
  calls = []
  getReply = (u) => {
    if (u.indexOf('/x/msgfeed/unread') >= 0) return unread()
    if (u.indexOf('/x/msgfeed/reply') >= 0) return feed([replyItem(1, 'A', 'a1')], { id: 1, time: 10, is_end: false })
    if (u.indexOf('/x/msgfeed/at') >= 0) return feed([atItem(9, 'X')], { id: 9, time: 90, is_end: false })
    return feed([], { is_end: true })
  }
  const vm = drive(msgPage)
  vm.logged = true
  vm.load(true)
  await sleep(120)
  assert.deepEqual(vm.items.map((i) => i.id), ['1'])
  vm.setTab('at')
  await sleep(120)
  assert.deepEqual(vm.items.map((i) => i.id), ['9'], '切到 @我: 显示 @我 自己的列表')
  const atCalls = hits('/x/msgfeed/at')
  assert.equal(atCalls.length, 1)
  assert.doesNotMatch(atCalls[0].u, /&id=/, '@我 首页不带游标')
  vm.setTab('reply')
  assert.deepEqual(vm.items.map((i) => i.id), ['1'], '切回回复: 已加载的页不丢')
  const before = hits('/x/msgfeed/reply').length
  vm.loadMore()
  await sleep(120)
  assert.equal(hits('/x/msgfeed/reply').length - before, 1, '续翻只发一次列表请求 (不是重置成首页)')
  const rp = hits('/x/msgfeed/reply')
  assert.match(rp[rp.length - 1].u, /\/x\/msgfeed\/reply\?.*&id=1&reply_time=10/, '续翻用回复分类自己的游标')
})

// ---------------- 4. 发送私信: URL / 表单 / csrf ----------------
test('发送私信: URL、表单字段与 csrf 形态', async () => {
  calls = []
  postReply = () => JSON.stringify({ code: 0, data: { msg_key: 1 } })
  const r = await msg.sendPrivateMsg(77, '你好')
  assert.equal(r.ok, true)
  const posts = calls.filter((c) => c.m === 'POST')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].u, 'https://api.vc.bilibili.com/web_im/v1/web_im/send_msg')
  assert.equal(posts[0].u, msg.MSG_URLS.sendMsg)
  const f = posts[0].d
  assert.match(f, /^msg%5Bsender_uid%5D=1741083/, '带发送方 mid')
  assert.match(f, /&msg%5Breceiver_id%5D=77/, '带接收方 mid')
  assert.match(f, /&msg%5Breceiver_type%5D=1/)
  assert.match(f, /&msg%5Bmsg_type%5D=1/)
  assert.match(f, /&msg%5Bmsg_status%5D=0/)
  assert.match(f, /&msg%5Bdev_id%5D=[0-9a-f-]{32,}/, 'dev_id (服务端按它去重)')
  assert.match(f, /&msg%5Btimestamp%5D=\d{10}/)
  assert.match(f, /&msg%5Bnew_face_version%5D=1/)
  assert.match(f, /&msg%5Bcontent%5D=%7B%22content%22%3A%22%E4%BD%A0%E5%A5%BD%22%7D/, '正文是 {"content":...}')
  assert.match(f, /&from_firework=0/)
  assert.match(f, /&build=0&mobi_app=web/)
  assert.match(f, /&csrf=fixture-csrf/)
  assert.match(f, /&csrf_token=fixture-csrf/)
  assert.equal(posts[0].h[0], 'Content-Type: application/x-www-form-urlencoded')
  assert.match(posts[0].h[1], /Cookie: SESSDATA=fixture-sess/)
  const n = calls.length
  await assert.rejects(msg.sendPrivateMsg(77, '   '), /内容为空/)
  assert.equal(calls.length, n, '空内容不发请求')
})

// ---------------- 5. 发送失败: 不自动重试 + 保留草稿 ----------------
test('发送失败: 一次请求、草稿保留、可手动重试', async () => {
  calls = []
  const vm = drive(chatPage)
  vm.talkerId = 77
  vm.name = '好友'
  vm.draft = '你好'
  vm.msgs = []
  postReply = () => JSON.stringify({ code: -400, message: '被风控' })
  await vm.send()
  assert.equal(calls.filter((c) => c.m === 'POST').length, 1, '失败不得自动重放 POST')
  assert.equal(vm.draft, '你好', '失败必须保留草稿')
  assert.match(vm.status, /被风控/, '必须给出失败原因')
  assert.equal(vm.sending, false, '失败后要能再次点发送')
  assert.equal(vm.failed, true, '要给出可重试状态')
  assert.equal(vm.msgs.length, 0, '失败不得就地追加')
  postReply = () => JSON.stringify({ code: 0, data: { msg_key: 9 } })
  await vm.send()
  assert.equal(calls.filter((c) => c.m === 'POST').length, 2, '两次手动点击 = 两次请求 (没有额外自动重试)')
  assert.equal(vm.draft, '', '成功后清空草稿')
  assert.equal(vm.failed, false)
  assert.equal(vm.msgs.length, 1, '成功后就地追加')
  assert.equal(vm.msgs[0].fromMe, true)
  assert.equal(vm.msgs[0].text, '你好')
})

// ---------------- 6. 会话消息游标 ----------------
test('会话消息: 倒序转升序, 游标指向更早的一页', async () => {
  calls = []
  getReply = () => JSON.stringify({ code: 0, data: { has_more: 1, max_seqno: 100, messages: [
    { msg_key: 'k12', msg_seqno: 12, sender_uid: 1741083, content: JSON.stringify({ content: 'm12' }), timestamp: 1700000012 },
    { msg_key: 'k11', msg_seqno: 11, sender_uid: 77, content: JSON.stringify({ content: 'm11' }), timestamp: 1700000011 }
  ] } })
  const p1 = await msg.getSessionMsgs(77, 0)
  assert.deepEqual(p1.items.map((i) => i.seqno), [11, 12], '接口倒序 -> 页面升序')
  assert.equal(p1.items[0].fromMe, false)
  assert.equal(p1.items[1].fromMe, true)
  assert.equal(p1.endSeq, 11, '游标 = 本页最早的 seqno')
  assert.equal(p1.hasMore, true)
  assert.match(last().u, /svr_sync\/v1\/svr_sync\/fetch_session_msgs\?talker_id=77&session_type=1&size=20/)
  assert.doesNotMatch(last().u, /end_seqno/, '首页不带翻页游标')
  await msg.getSessionMsgs(77, p1.endSeq)
  assert.match(last().u, /&end_seqno=11/, '向上翻页带上一页游标')
  getReply = () => JSON.stringify({ code: 0, data: { has_more: 0, messages: [] } })
  const p2 = await msg.getSessionMsgs(77, 11)
  assert.equal(p2.hasMore, false, '服务端说没有更多就停')
  assert.equal(p2.items.length, 0)
})

// ---------------- 7. 会话列表归一化 + 昵称补全失败不致命 ----------------
test('会话列表: 归一化, 昵称补全失败不影响列表', async () => {
  calls = []
  let cardsDown = false
  getReply = (u) => {
    if (u.indexOf('/account/v1/user/cards') >= 0) {
      if (cardsDown) throw new Error('cards 挂了')
      // ★ 真机取证 (2026-10-11): account/v1/user/cards 的 data 是**数组** [{mid,name,face}],
      // 不是 map —— 桩件原先按 map 写, 会把"只认数组"的实现误判成失败.
      return JSON.stringify({ code: 0, data: [{ mid: 77, name: '好友名', face: '//i2.hdslb.com/f.jpg' }] })
    }
    return JSON.stringify({ code: 0, data: { session_list: [{
      talker_id: 77, unread_count: 2,
      // session_ts 真机是**微秒**; 秒级值放在 last_msg.timestamp (真机同款)
      session_ts: 1700000100000000,
      last_msg: { content: JSON.stringify({ content: '在吗' }), timestamp: 1700000100, msg_type: 1 }
    }] } })
  }
  const list = await msg.getSessions()
  await new Promise((res) => setImmediate(res))   // 昵称补全是异步补的, 等它 settle
  assert.equal(list.length, 1)
  assert.equal(list[0].talkerId, 77)
  assert.equal(list[0].content, '在吗', '私信正文是 JSON 串, 要拆出来')
  assert.equal(list[0].unread, 2)
  assert.equal(list[0].name, '好友名')
  assert.equal(list[0].face, 'https://i2.hdslb.com/f.jpg@72w_72h_1c.jpg')
  assert.match(hits('/session_svr/v1/session_svr/get_sessions')[0].u,
    /get_sessions\?session_type=1&group_fold=1&unfollow_fold=0/)
  cardsDown = true
  const l2 = await msg.getSessions()
  await new Promise((res) => setImmediate(res))
  assert.equal(l2.length, 1, '昵称接口挂了也要给出会话列表')
  assert.equal(l2[0].name, '')
})

// ---------------- 8. 接口 URL 依据 ----------------
test('接口 URL 与任务书给定的一致', () => {
  assert.equal(msg.MSG_URLS.reply, 'https://api.bilibili.com/x/msgfeed/reply')
  assert.equal(msg.MSG_URLS.at, 'https://api.bilibili.com/x/msgfeed/at')
  assert.equal(msg.MSG_URLS.like, 'https://api.bilibili.com/x/msgfeed/like')
  assert.equal(msg.MSG_URLS.sys, 'https://api.bilibili.com/x/msgfeed/sys_msg')
  assert.equal(msg.MSG_URLS.sessions, 'https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions')
  assert.equal(msg.MSG_URLS.sessionMsgs, 'https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs')
  assert.equal(msg.MSG_URLS.sendMsg, 'https://api.vc.bilibili.com/web_im/v1/web_im/send_msg')
  assert.deepEqual(msg.MSG_TABS.map((t) => t.n), ['回复', '@我', '赞', '系统', '私信会话'])
})

// ---------------- 9. 页面契约 ----------------
test('页面契约: 分类 tab / 私信入口 / 草稿 / 生命周期位置', async () => {
  const read = (p) => fs.readFileSync(new URL('../ui/src/pages/' + p, import.meta.url), 'utf8')
  const chatSrc = read('chat/chat.vue')
  assert.match(chatSrc, /createIME/, '会话页走公共输入法封装')
  assert.match(chatSrc, /draft/, '会话页必须有草稿状态')
  assert.match(chatSrc, /onNewOptions/, '同名页重新 navTo 要能换会话对象')
  assert.match(chatSrc, /onUnload/, '退出要销毁输入法会话')
  const msgSrc = read('msg/msg.vue')
  assert.match(msgSrc, /MSG_TABS/, '消息页用共享分类表')
  assert.match(msgSrc, /getSessions/, '消息页有私信会话')
  assert.match(msgSrc, /navTo\('chat'/, '消息页能进会话页')
  assert.match(msgSrc, /itemsBy/, '消息页每类各持一份列表/游标')
  assert.match(chatPage.default.name === 'chat' ? 'chat' : 'x', /chat/)
  const appJson = JSON.parse(fs.readFileSync(new URL('../ui/src/app.json', import.meta.url), 'utf8'))
  assert.equal(appJson.pages.chat, 'pages/chat/chat.vue')
})


// ---------------- 10. 真机形态回归 (2026-10-11 三处真 bug) ----------------
// 这一节的桩件**照抄真机响应形态**, 不是"好走"的形态:
//   赞的列表在 data.total.items (旧实现只看 data.items -> 页面永远"没有此类消息");
//   系统主口返回 HTML 错误页 (旧实现 JSON.parse 直接抛 -> 永远看不到回落口);
//   系统会话的名/头像在 account_info (这些虚拟 mid 查不到 user/cards)。
test('真机形态: 赞在 data.total.items / 系统主口 HTML 要回落 / 系统会话名走 account_info', async () => {
  calls = []
  getReply = (u) => {
    if (u.indexOf('/x/msgfeed/unread') >= 0) return unread()
    if (u.indexOf('/x/msgfeed/like') >= 0) {
      return JSON.stringify({ code: 0, data: {
        latest: { items: [], last_view_at: 1 },
        total: {
          cursor: { is_end: false, id: 9001, time: 1789258592 },
          items: [{ id: 9001, like_time: 1789258592, counts: 3,
            users: [{ nickname: '丙', avatar: '//i2.hdslb.com/c.jpg' }],
            item: { title: '被赞的稿件', desc: '', uri: 'https://www.bilibili.com/video/BV1xx411c7mD' } }]
        }
      } })
    }
    if (u.indexOf('/x/msgfeed/sys_msg') >= 0) {
      return '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">\n<html lang="zh-cn"><head><title>出错啦! - bilibili.com</title></head></html>'
    }
    if (u.indexOf('message.bilibili.com/x/sys-msg/query_notify_list') >= 0) {
      return JSON.stringify({ code: 0, data: [
        { id: 20458189, cursor: 1782552697895022800, publisher: { name: '', mid: 0 }, type: 4,
          title: '您已通过LV6试炼',
          content: '恭喜，您已通过LV6试炼。#{点击查看试炼结果>>}{https://www.bilibili.com/h5/senior-newbie/pass}',
          source: { name: '' }, time_at: '2026-06-27 17:31:37' }
      ] })
    }
    return feed([], { is_end: true })
  }

  const like = await msg.getMsgList('like', null)
  assert.equal(like.items.length, 1, '赞的列表在 data.total.items (旧实现恒为空)')
  assert.equal(like.items[0].uname, '丙')
  assert.equal(like.items[0].title, '被赞的稿件')
  assert.equal(like.hasMore, true, '赞的游标在 data.total.cursor')
  const like2 = await msg.getMsgList('like', like.cursor)
  assert.match(hits('/x/msgfeed/like')[1].u, /&id=9001&like_time=1789258592/, '续翻用 total.cursor')
  assert.equal(like2.items.length, 1)

  const sys = await msg.getMsgList('sys', null)
  assert.equal(hits('/x/msgfeed/sys_msg').length, 1, '系统先试主口')
  assert.equal(hits('message.bilibili.com/x/sys-msg/query_notify_list').length, 1,
    '主口返回非 JSON 时也必须回落 (旧实现直接抛"接口返回非 JSON")')
  assert.equal(sys.items.length, 1)
  assert.equal(sys.items[0].title, '您已通过LV6试炼')
  assert.equal(sys.items[0].content, '恭喜，您已通过LV6试炼。点击查看试炼结果>>', '清掉 #{...}{url} 富文本标记')
  assert.equal(sys.items[0].time > 0, true, 'time_at 字符串转时间戳')

  getReply = (u) => {
    if (u.indexOf('/session_svr/v1/session_svr/get_sessions') >= 0) {
      return JSON.stringify({ code: 0, data: { session_list: [
        { talker_id: 844424930131957, session_type: 1, system_msg_type: 7, session_ts: 1762052282353535,
          account_info: { name: '预约通知', pic_url: 'https://i0.hdslb.com/bfs/activity-plat/x.png' },
          last_msg: { msg_type: 10, content: JSON.stringify({ title: '直播已开始', text: '快来围观' }) } }
      ] } })
    }
    return JSON.stringify({ code: 0, data: [] })
  }
  const sess = await msg.getSessions()
  assert.equal(sess[0].name, '预约通知', '系统会话名走 account_info.name (这些 mid 查不到 user/cards)')
  assert.equal(sess[0].face, 'https://i0.hdslb.com/bfs/activity-plat/x.png', 'png 头像不套 @xx.jpg 缩略后缀')
  assert.equal(sess[0].content, '[直播] 快来围观')
  assert.notEqual(sess[0].timeText, '')
})

let passed = 0
try {
  for (const t of tests) {
    try { await t.run(); passed++; print('PASS ' + t.name) }
    catch (e) { print('FAIL ' + t.name + ': ' + (e && e.message ? e.message : e)) }
  }
} finally {
  Date.now = realNow
  console.log = print
}
print('CHECK-MESSAGES ' + passed + '/' + tests.length + ' passed')
process.exitCode = passed === tests.length ? 0 : 1