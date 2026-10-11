// Offline public-contract checks; native I/O and login state are synthetic.
// Run: node tools/check-request-gate.mjs
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { createHash } from 'node:crypto'

const print = console.log.bind(console)
console.log = () => {}
const realNow = Date.now
let now = 1700000000000
Date.now = () => now
let getReply
let postReply
let calls = []
function record(method, url, timeout, headers, data) {
  calls.push({ method, url, timeout, headers, data })
  return method === 'POST' ? postReply(url, data, timeout, headers) : getReply(url, timeout, headers)
}
globalThis.__bilinet = {
  readFile: () => '', writeFile: () => true, exec: () => '', dbOpen: () => false,
  httpGet: (url, timeout, headers) => record('GET', url, timeout, headers),
  httpGetAsync: (url, timeout, headers) => record('GET', url, timeout, headers),
  httpPost: (url, data, timeout, headers) => record('POST', url, timeout, headers, data),
  httpPostAsync: (url, data, timeout, headers) => record('POST', url, timeout, headers, data)
}
register('./esm-hooks.mjs', import.meta.url)
const src = new URL('../ui/src/services/', import.meta.url)
const auth = await import(new URL('auth.js', src))
const config = await import(new URL('config.js', src))
let instance = 0
const tests = []
const test = (name, run) => tests.push({ name, run })
const body = (data) => JSON.stringify({ code: 0, data })
const nav = (img = 'a'.repeat(32), sub = 'b'.repeat(32)) => JSON.stringify({
  code: -101, data: { wbi_img: { img_url: 'https://example.invalid/' + img + '.png', sub_url: 'https://example.invalid/' + sub + '.png' } }
})
const recommend = (title) => body({ item: [{ bvid: 'BV_TEST', title, owner: {}, stat: {} }] })
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function login(name) { auth.saveLogin('fixture-' + name, 'fixture-csrf', 'fixture-mid') }
async function fresh() {
  calls = []
  now += 100000
  auth.clearLogin()
  config.setCfg('httpTimeout', 15)
  getReply = (url) => url.includes('/nav') ? nav() : body({ follower: 7 })
  postReply = () => body({})
  return import(new URL('bili.js?request-gate-check=' + (++instance), src))
}

test('identical pending GETs share one native request; settled GETs run again', async () => {
  const bili = await fresh()
  const d = deferred()
  getReply = () => d.promise
  const a = bili.getUpFans(42), b = bili.getUpFans(42)
  await tick()
  const count = calls.length
  d.resolve(body({ follower: 123 }))
  assert.deepEqual(await Promise.all([a, b]), ['123', '123'])
  assert.equal(count, 1)
  await bili.getUpFans(42)
  assert.equal(calls.length, 2)
})

test('different URLs stay independent', async () => {
  const bili = await fresh()
  const d = deferred()
  getReply = () => d.promise
  const all = Promise.all([bili.getUpFans(1), bili.getUpFans(2)])
  await tick()
  d.resolve(body({ follower: 1 }))
  await all
  assert.equal(calls.length, 2)
})

test('anonymous and changed same-mid sessions use separate pending requests', async () => {
  const bili = await fresh()
  const d = deferred()
  getReply = () => d.promise
  const a = bili.getUpFans(1)
  login('A')
  const b = bili.getUpFans(1)
  login('B')
  const c = bili.getUpFans(1)
  await tick()
  d.resolve(body({ follower: 1 }))
  await Promise.all([a, b, c])
  assert.equal(calls.length, 3)
  assert.equal(calls[0].headers, undefined)
  assert.ok(calls[1].headers[0].includes('fixture-A'))
  assert.ok(calls[2].headers[0].includes('fixture-B'))
})

test('effective timeout isolates identical GETs', async () => {
  const bili = await fresh()
  const d = deferred()
  getReply = () => d.promise
  const a = bili.getPlayUrlRaw('BV_TIMEOUT', 1, { noCache: true })
  config.setCfg('httpTimeout', 30)
  const b = bili.getPlayUrlRaw('BV_TIMEOUT', 1, { noCache: true })
  await tick()
  d.resolve(body({ durl: [{ url: 'https://example.invalid/video.mp4' }] }))
  await Promise.all([a, b])
  assert.deepEqual(calls.map((x) => x.timeout), [15, 30])
})

test('shared transport rejection cleans up and preserves retry', async () => {
  const bili = await fresh()
  const d = deferred(), failure = new Error('synthetic network failure')
  getReply = () => d.promise
  const all = Promise.allSettled([bili.getUpFans(1), bili.getUpFans(1)])
  await tick()
  const count = calls.length
  d.reject(failure)
  const results = await all
  assert.ok(results.every((r) => r.status === 'rejected' && r.reason === failure))
  getReply = () => body({ follower: 9 })
  assert.equal(await bili.getUpFans(1), '9')
  assert.equal(count, 1)
  assert.equal(calls.length, 2)
})

test('empty or invalid JSON bodies and business failures remain retryable', async () => {
  const bili = await fresh()
  for (const reply of ['', '<html>fixture</html>', '{broken', '{"code":-412}']) {
    getReply = () => reply
    await assert.rejects(bili.getRecommend(1))
  }
  getReply = () => recommend('valid')
  assert.equal((await bili.getRecommend(1))[0].title, 'valid')
  assert.equal(calls.length, 5)
})

test('identical POST operations always execute separately', async () => {
  const bili = await fresh()
  login('A')
  const d = deferred()
  postReply = () => d.promise
  const all = Promise.all([bili.likeVideo(1, true), bili.likeVideo(1, true)])
  await tick()
  d.resolve(body({}))
  await all
  assert.equal(calls.filter((x) => x.method === 'POST').length, 2)
})

test('synchronous fallback also coalesces GETs and preserves headers', async () => {
  const bili = await fresh()
  login('A')
  const asyncGet = globalThis.__bilinet.httpGetAsync
  delete globalThis.__bilinet.httpGetAsync
  try {
    const all = await Promise.all([bili.getUpFans(7), bili.getUpFans(7)])
    assert.deepEqual(all, ['7', '7'])
    assert.equal(calls.length, 1)
    assert.ok(calls[0].headers[0].includes('fixture-A'))
  } finally { globalThis.__bilinet.httpGetAsync = asyncGet }
})

test('result cache stays within 64 entries and retains recently used entries', async () => {
  const bili = await fresh()
  getReply = (url) => recommend(new URL(url).searchParams.get('fresh_idx'))
  for (let page = 1; page <= 64; page++) await bili.getRecommend(page)
  await bili.getRecommend(1)
  await bili.getRecommend(65)
  await bili.getRecommend(1)
  assert.equal(calls.length, 65)
  await bili.getRecommend(2)
  assert.equal(calls.length, 66)
})

test('cache TTL expires at the boundary and on clock rollback', async () => {
  const bili = await fresh()
  getReply = () => recommend(String(calls.length))
  await bili.getRecommend(1)
  now += 59999
  await bili.getRecommend(1)
  assert.equal(calls.length, 1)
  now++
  await bili.getRecommend(1)
  assert.equal(calls.length, 2)
  now -= 1000
  await bili.getRecommend(1)
  assert.equal(calls.length, 3)
})

test('result cache clears on same-mid session rotation and logout', async () => {
  const bili = await fresh()
  login('A')
  getReply = (url, timeout, headers) => recommend(headers ? headers[0].includes('fixture-A') ? 'A' : 'B' : 'anonymous')
  assert.equal((await bili.getRecommend(1))[0].title, 'A')
  login('B')
  assert.equal((await bili.getRecommend(1))[0].title, 'B')
  auth.clearLogin()
  assert.equal((await bili.getRecommend(1))[0].title, 'anonymous')
  assert.equal(calls.length, 3)
})

test('late old-account completion never poisons current result cache', async () => {
  const bili = await fresh()
  const old = deferred()
  login('A')
  getReply = (url, timeout, headers) => headers[0].includes('fixture-A') ? old.promise : recommend('B')
  const a = bili.getRecommend(1)
  await tick()
  login('B')
  assert.equal((await bili.getRecommend(1))[0].title, 'B')
  old.resolve(recommend('A'))
  assert.equal((await a)[0].title, 'A')
  assert.equal((await bili.getRecommend(1))[0].title, 'B')
  assert.equal(calls.length, 2)
})

test('fresh dynamic request bypasses in-flight reads and wins cache ordering', async () => {
  const bili = await fresh()
  login('A')
  const old = deferred(), refresh = deferred()
  getReply = () => calls.length === 1 ? old.promise : refresh.promise
  const a = bili.getDynamicFeed('', 'all')
  await tick()
  const b = bili.getDynamicFeed('', 'all', true)
  await tick()
  const count = calls.length
  refresh.resolve(body({ items: [], offset: 'new' }))
  old.resolve(body({ items: [], offset: 'old' }))
  await Promise.all([a, b])
  assert.equal(count, 2)
  assert.equal((await bili.getDynamicFeed('', 'all')).offset, 'new')
})

test('fresh space request bypasses in-flight reads', async () => {
  const bili = await fresh()
  const d = deferred()
  getReply = () => d.promise
  const all = Promise.all([bili.getDynamicSpace(1, ''), bili.getDynamicSpace(1, '', true)])
  await tick()
  d.resolve(body({ items: [] }))
  await all
  assert.equal(calls.length, 2)
})

test('comment cache is read before transport; fresh comments still fetch', async () => {
  const bili = await fresh()
  getReply = () => body({ replies: [], page: { count: calls.length } })
  assert.equal((await bili.getReplies(1, 1, [], 'time')).total, 1)
  assert.equal((await bili.getReplies(1, 1, [], 'time')).total, 1)
  assert.equal(calls.length, 1)
  assert.equal((await bili.getReplies(1, 1, [], 'time', true)).total, 2)
})

test('WBI callers share one nav fetch and sign their own parameters', async () => {
  const bili = await fresh()
  const d = deferred()
  getReply = (url) => url.includes('/nav') ? d.promise : body({ result: { live_room: [] } })
  const all = Promise.all([bili.searchLive('one', 1), bili.searchLive('two', 1)])
  await tick()
  const count = calls.filter((x) => x.url.includes('/nav')).length
  d.resolve(nav('a'.repeat(32), 'a'.repeat(32)))
  await all
  assert.equal(count, 1)
  const signed = calls.filter((x) => x.url.includes('/wbi/'))
  assert.equal(signed.length, 2)
  for (const call of signed) {
    const query = new URL(call.url).search.slice(1)
    const [unsigned, rid] = query.split('&w_rid=')
    assert.equal(rid, createHash('md5').update(unsigned + 'a'.repeat(32)).digest('hex'))
  }
})

test('WBI invalid payload is rejected and never cached', async () => {
  const bili = await fresh()
  getReply = (url) => url.includes('/nav') ? nav('', '') : body({ result: { live_room: [] } })
  await assert.rejects(bili.searchLive('bad', 1))
  getReply = (url) => url.includes('/nav') ? nav() : body({ result: { live_room: [] } })
  await bili.searchLive('retry', 1)
  assert.equal(calls.filter((x) => x.url.includes('/nav')).length, 2)
})

test('WBI failure retries; expired keys refetch; signed URLs are regenerated', async () => {
  const bili = await fresh()
  getReply = () => Promise.reject(new Error('nav fixture failure'))
  await assert.rejects(bili.searchLive('retry', 1))
  getReply = (url) => url.includes('/nav') ? nav() : body({ result: { live_room: [] } })
  await bili.searchLive('same', 1)
  const first = calls[calls.length - 1].url
  now += 1000
  await bili.searchLive('same', 1)
  const second = calls[calls.length - 1].url
  assert.ok(first !== second)
  now += 12 * 3600000
  await bili.searchLive('same', 1)
  assert.equal(calls.filter((x) => x.url.includes('/nav')).length, 3)
})

let passed = 0
try {
  for (const { name, run } of tests) {
    try { await run(); passed++; print('PASS ' + name) }
    catch (error) { print('FAIL ' + name + ': ' + error.message) }
  }
} finally {
  Date.now = realNow
  console.log = print
}
print('CHECK-REQUEST-GATE ' + passed + '/' + tests.length + ' passed')
process.exitCode = passed === tests.length ? 0 : 1
