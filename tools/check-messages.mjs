// 离线回归: 消息分类/私信归一化 + 发送只尝试一次
// 运行: node tools/check-messages.mjs
import assert from 'node:assert/strict'
import { register } from 'node:module'
import fs from 'node:fs'

let getReply, postReply
const calls = []
globalThis.__bilinet = {
  readFile: () => '', writeFile: () => true, exec: () => '', dbOpen: () => false,
  httpGet: (u) => { calls.push({ m: 'GET', u: u }); return getReply(u) },
  httpGetAsync: (u) => { calls.push({ m: 'GET', u: u }); return Promise.resolve(getReply(u)) },
  httpPost: (u, d) => { calls.push({ m: 'POST', u: u, d: d }); return postReply(u, d) },
  httpPostAsync: (u, d) => { calls.push({ m: 'POST', u: u, d: d }); return Promise.resolve(postReply(u, d)) }
}
globalThis.$falcon = { Page: class {}, eventMap: {} }
register('./esm-hooks.mjs', import.meta.url)
const auth = await import('../ui/src/services/auth.js')
const msg = await import('../ui/src/services/messages.js')
auth.saveLogin('fixture-sess', 'fixture-csrf', '1741083')

// 1) 分类列表归一化 + 游标
getReply = () => JSON.stringify({
  code: 0,
  data: {
    items: [{
      id: 11, reply_time: 1700000000,
      user: { nickname: '某人', avatar: '//i0.hdslb.com/a.jpg' },
      item: { title: '视频标题', target_reply_content: '<b>回了什么</b>', uri: 'https://www.bilibili.com/video/BV1xx411c7mD' }
    }],
    cursor: { id: 11, time: 1700000000, is_end: false }
  }
})
const r1 = await msg.getMsgList('reply', null)
assert.equal(r1.items.length, 1)
assert.equal(r1.items[0].uname, '某人')
assert.equal(r1.items[0].face, 'https://i0.hdslb.com/a.jpg')
assert.equal(r1.items[0].content, '回了什么')
assert.equal(r1.hasMore, true)
assert.match(calls[calls.length - 1].u, /\/x\/msgfeed\/reply/)
assert.doesNotMatch(calls[calls.length - 1].u, /&id=/, '首页不该带游标')

await msg.getMsgList('at', { id: 9, time: 123 })
assert.match(calls[calls.length - 1].u, /\/x\/msgfeed\/at/)
assert.match(calls[calls.length - 1].u, /&id=9/)
assert.match(calls[calls.length - 1].u, /&at_time=123/)

getReply = () => JSON.stringify({ code: 0, data: { items: [], cursor: { is_end: true } } })
assert.equal((await msg.getMsgList('sys', null)).hasMore, false)

// 2) 未知分类直接报错, 不发请求
const before = calls.length
await assert.rejects(msg.getMsgList('nope', null), /未知的消息分类/)
assert.equal(calls.length, before)

// 3) 会话列表: 正文是 JSON 串要拆出来
getReply = () => JSON.stringify({
  code: 0,
  data: {
    session_list: [{
      talker_id: 77, name: '好友', avatar: '//i2.hdslb.com/b.jpg',
      session_ts: 1700000100, unread_count: 2,
      last_msg: { content: JSON.stringify({ content: '在吗' }), timestamp: 1700000100 }
    }]
  }
})
const sess = await msg.getSessions()
assert.equal(sess.length, 1)
assert.equal(sess[0].talkerId, 77)
assert.equal(sess[0].content, '在吗')
assert.equal(sess[0].unread, 2)
assert.equal(sess[0].face, 'https://i2.hdslb.com/b.jpg')

// 4) 会话消息: 倒序下发 -> 升序渲染, fromMe 判定
getReply = () => JSON.stringify({
  code: 0,
  data: {
    max_seqno: 100,
    messages: [
      { msg_key: 'k2', msg_seqno: 12, sender_uid: 77, content: JSON.stringify({ content: '第二条' }), timestamp: 1700000200 },
      { msg_key: 'k1', msg_seqno: 11, sender_uid: 1741083, content: JSON.stringify({ content: '第一条' }), timestamp: 1700000100 }
    ]
  }
})
const sm = await msg.getSessionMsgs(77, 0)
assert.equal(sm.items.length, 2)
assert.equal(sm.items[0].text, '第一条')
assert.equal(sm.items[0].fromMe, true)
assert.equal(sm.items[1].fromMe, false)
assert.equal(sm.endSeq, 11)

// 5) 发送: 一次尝试 + 表单/ csrf 形态; 失败不重试
getReply = () => JSON.stringify({ code: 0, data: { msg_key: 1 } })
postReply = () => JSON.stringify({ code: 0, data: { msg_key: 1 } })
const c0 = calls.length
await msg.sendPrivateMsg(77, '你好')
const sent = calls.filter((c) => c.m === 'POST')
assert.equal(calls.length - c0, 1, '发送只允许一次原生调用')
assert.equal(sent.length, 1)
assert.match(sent[0].u, /web_im\/v1\/web_im\/send_msg/)
assert.match(sent[0].d, /receiver_id%5D=77/, '必须带上接收方 mid')
assert.match(sent[0].d, /csrf=fixture-csrf/, '必须带 csrf')
assert.match(sent[0].d, /content%5D=/, '必须带正文')

postReply = () => JSON.stringify({ code: -400, message: '被拒' })
const c1 = calls.length
await assert.rejects(msg.sendPrivateMsg(77, '再来'), /被拒/)
assert.equal(calls.length - c1, 1, '发送失败不得自动重试')

// 6) 契约: 会话页有草稿保留与失败提示; msg 页有分类与私信入口
const read = (p) => fs.readFileSync(new URL('../ui/src/pages/' + p, import.meta.url), 'utf8')
const chatSrc = read('chat/chat.vue')
assert.match(chatSrc, /draft/, '会话页必须有草稿状态')
assert.match(chatSrc, /发送失败/, '会话页必须给出失败提示')
assert.match(chatSrc, /createIME/, '会话页走系统输入法')
const msgSrc = read('msg/msg.vue')
assert.match(msgSrc, /MSG_TABS/, '消息页必须用共享的分类表')
assert.match(msgSrc, /getSessions/, '消息页必须有私信会话')
assert.match(msgSrc, /navTo\('chat'/, '消息页要能进会话页')
const appJson = JSON.parse(fs.readFileSync(new URL('../ui/src/app.json', import.meta.url), 'utf8'))
assert.equal(appJson.pages.chat, 'pages/chat/chat.vue')

console.log('PASS message categories, session normalization, single-attempt send')