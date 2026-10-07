// 哔哩哔哩网络服务
// 传输层: bilinet 原生模块 httpGet (popen 调设备自带 /bin/curl,
//   固定浏览器 UA + Referer https://www.bilibili.com), 同步返回响应体字符串.
// 真机实测背景 (home 项目 src/utils/api.js 结论, 同型号设备):
//   - 系统 http JSAPI 不发送自定义 header, UA/Referer 全丢,
//     wbi 类/风控敏感接口返回 v_voucher 空壳 (code=0 无 data)
//   - curl 携带浏览器 UA + Referer 后, popular/view/search/space 全部正常
//   - 无 Cookie 态 (无 buvid3) 反而绕开部分风控, 故不再取手指纹

import { bilinet } from './native.js'
import * as auth from './auth.js'
import { log, logError, logDebug } from './log.js'
import { getCfg } from './config.js'
import { applyHost, currentHost } from './lines.js'

// 网络默认超时来自设置 (设置页「请求超时」), 显式传 timeoutSec 的调用不受影响
function defTimeout() {
  const v = getCfg('httpTimeout')
  return (typeof v === 'number' && v >= 5 && v <= 60) ? v : 15
}

function hasHttp() {
  return !!(bilinet && typeof bilinet.httpGet === 'function')
}

// 同步原生 GET -> JSON body; 服务器返回什么就透传什么, 业务 code 由调用方判断.
// 登录态存在时自动携带 Cookie 头 (动态/评论/用户信息等登录接口依赖).
function getJson(url, timeoutSec) {
  const headers = auth.hasCookie() ? [auth.cookieHeader()] : undefined
  const s = headers
    ? bilinet.httpGet(url, timeoutSec || 15, headers)
    : bilinet.httpGet(url, timeoutSec || 15)
  logDebug('网络', 'GET ' + url.replace(/(&|\?)w_rid=[^&]+/, '').replace(/(&|\?)wts=[^&]+/, '') + ' -> ' + (s ? s.length : 0) + 'B')
  if (!s) { logError('网络', 'GET 空响应: ' + url); throw new Error('请求失败 (空响应)') }
  try {
    return JSON.parse(s)
  } catch (e) {
    // 非 JSON: 风控 HTML 页 / 网关错误页等, 透出真实开头便于诊断
    logError('网络', '非 JSON body: ' + String(s).substring(0, 300))
    if (String(s).indexOf('<!DOCTYPE') === 0 || String(s).indexOf('<html') === 0) {
      throw new Error('接口被风控拦截 (风控验证页)')
    }
    throw new Error('接口返回非 JSON: ' + String(s).substring(0, 120))
  }
}

// 同步原生 POST 表单 -> JSON body (评论发送等需要登录 + csrf 的接口)
function postJson(url, data, timeoutSec) {
  const headers = ['Content-Type: application/x-www-form-urlencoded']
  if (auth.hasCookie()) headers.push(auth.cookieHeader())
  const s = bilinet.httpPost(url, data, timeoutSec || 15, headers)
  logDebug('网络', 'POST ' + url.substring(0, 80) + ' -> ' + (s ? s.length : 0) + 'B')
  if (!s) throw new Error('请求失败 (空响应)')
  try {
    return JSON.parse(s)
  } catch (e) {
    throw new Error('接口返回非 JSON: ' + String(s).substring(0, 120))
  }

}
// ================= 异步 HTTP (v6: 不阻塞主线程) =================
// 同步版 httpGet/httpPost 会阻塞 QuickJS 主线程 (curl 最长 timeout 秒) —— 页面渲染/触摸全卡住,
// 所以页面加载一律走异步版: 原生在工作线程跑 curl, Promise 在 JS 线程 resolve.
// 好处: 页面可以先渲染 + 显示「加载中…」, 数据到了再填, 请求之间互不干扰.
// 旧 .so 没有异步方法时自动退化为同步实现 (保证向后兼容).
function hasHttpAsync() {
  return !!(bilinet && typeof bilinet.httpGetAsync === 'function')
}

async function getJsonAsync(url, timeoutSec) {
  if (!hasHttpAsync()) return getJson(url, timeoutSec)
  const headers = auth.hasCookie() ? [auth.cookieHeader()] : undefined
  const to = timeoutSec || defTimeout()
  const s = headers
    ? await bilinet.httpGetAsync(url, to, headers)
    : await bilinet.httpGetAsync(url, to)
  logDebug('网络', 'GET ' + url.replace(/(&|\?)w_rid=[^&]+/, '').replace(/(&|\?)wts=[^&]+/, '') + ' -> ' + (s ? s.length : 0) + 'B')
  if (!s) { logError('网络', '空响应: ' + url); throw new Error('请求失败 (空响应)') }
  try {
    return JSON.parse(s)
  } catch (e) {
    logError('网络', '非 JSON body: ' + String(s).substring(0, 300))
    if (String(s).indexOf('<!DOCTYPE') === 0 || String(s).indexOf('<html') === 0) {
      throw new Error('接口被风控拦截 (风控验证页)')
    }
    throw new Error('接口返回非 JSON: ' + String(s).substring(0, 120))
  }
}

async function postJsonAsync(url, data, timeoutSec) {
  if (!hasHttpAsync() || typeof bilinet.httpPostAsync !== 'function') return postJson(url, data, timeoutSec)
  const headers = ['Content-Type: application/x-www-form-urlencoded']
  if (auth.hasCookie()) headers.push(auth.cookieHeader())
  const s = await bilinet.httpPostAsync(url, data, timeoutSec || defTimeout(), headers)
  logDebug('网络', 'POST ' + url.substring(0, 80) + ' -> ' + (s ? s.length : 0) + 'B')
  if (!s) throw new Error('请求失败 (空响应)')
  try {
    return JSON.parse(s)
  } catch (e) {
    throw new Error('接口返回非 JSON: ' + String(s).substring(0, 120))
  }
}


// 结果缓存 (减少重复请求 = 直接降低风控触发率)
const resultCache = {} // key -> { at, data }
function cacheGet(key, ttlMs) {
  const c = resultCache[key]
  if (c && Date.now() - c.at < ttlMs) return c.data
  return null
}
function cacheSet(key, data) {
  resultCache[key] = { at: Date.now(), data: data }
}

// ================= wbi 签名 (与官方文档 misc/sign/wbi.md 一致) =================
const WBI_MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24,
  55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52]
let wbiKeys = null
let wbiKeysAt = 0

// ---- 纯 JS MD5 (QuickJS 20200705 无字符串 hash; 固件 crypto 只有 hashFile) ----
function md5Utf8(str) {
  // UTF-8 编码为字节数组 (含代理对处理)
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++ }
    }
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
    else if (c < 0x10000) { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
    else { bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
  }
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff)

  const w = []
  for (let i = 0; i < bytes.length; i += 4) {
    w.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24))
  }

  function add(x, y) {
    const l = (x & 0xffff) + (y & 0xffff)
    return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff)
  }
  function rol(n, s) { return (n << s) | (n >>> (32 - s)) }
  function F(x, y, z) { return (x & y) | (~x & z) }
  function G(x, y, z) { return (x & z) | (y & ~z) }
  function H(x, y, z) { return x ^ y ^ z }
  function I(x, y, z) { return y ^ (x | ~z) }
  function step(fn, a, b, c, d, x, s, t) { return add(rol(add(add(a, fn(b, c, d)), add(x, t)), s), b) }

  const T = []
  for (let i = 1; i <= 64; i++) T.push(Math.floor(Math.abs(Math.sin(i)) * 4294967296))
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const FN = [F, G, H, I]

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476
  for (let k = 0; k < w.length; k += 16) {
    const aa = a, bb = b, cc = c, dd = d
    for (let round = 0; round < 4; round++) {
      const f = FN[round]
      const s = [S[round * 4], S[round * 4 + 1], S[round * 4 + 2], S[round * 4 + 3]]
      for (let j = 0; j < 16; j++) {
        let idx
        if (round === 0) idx = j
        else if (round === 1) idx = (5 * j + 1) % 16
        else if (round === 2) idx = (3 * j + 5) % 16
        else idx = (7 * j) % 16
        const x = w[k + idx]
        const t = T[round * 16 + j]
        if (j % 4 === 0) a = step(f, a, b, c, d, x, s[0], t)
        else if (j % 4 === 1) d = step(f, d, a, b, c, x, s[1], t)
        else if (j % 4 === 2) c = step(f, c, d, a, x, s[2], t)
        else b = step(f, b, c, d, a, x, s[3], t)
      }
    }
    a = add(a, aa); b = add(b, bb); c = add(c, cc); d = add(d, dd)
  }
  function hexWord(n) {
    let s = ''
    for (let i = 0; i < 4; i++) s += ('0' + ((n >> (i * 8)) & 0xff).toString(16)).slice(-2)
    return s
  }
  return hexWord(a) + hexWord(b) + hexWord(c) + hexWord(d)
}

async function getWbiKeys() {
  // nav 匿名可访问, 返回 wbi_img 图片地址, key 缓存 12h (随官方前端节奏)
  if (wbiKeys && Date.now() - wbiKeysAt < 12 * 3600 * 1000) return wbiKeys
  const body = await getJsonAsync('https://api.bilibili.com/x/web-interface/nav', 10)
  // 匿名 nav 返回 code=-101(账号未登录), 但 data.wbi_img 仍然有效
  if (!body || !body.data || !body.data.wbi_img) {
    throw new Error('wbi key 获取失败 (code=' + (body && body.code) + ')')
  }
  const imgUrl = body.data.wbi_img.img_url
  const subUrl = body.data.wbi_img.sub_url
  const imgKey = imgUrl.substring(imgUrl.lastIndexOf('/') + 1).split('.')[0]
  const subKey = subUrl.substring(subUrl.lastIndexOf('/') + 1).split('.')[0]
  const orig = imgKey + subKey
  let mixin = ''
  for (let i = 0; i < 32; i++) mixin += orig.charAt(WBI_MIXIN_TAB[i])
  wbiKeys = mixin
  wbiKeysAt = Date.now()
  logDebug('网络', 'wbi key 获取成功')
  return wbiKeys
}

function encodeURIComponentRFC3986(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, '')
}

// 返回带签名的完整 query 串: k=v&k=v&wts=..&w_rid=md5(...)
async function wbiQuery(params) {
  const mixin = await getWbiKeys()
  const p = {}
  for (const k in params) p[k] = params[k]
  p.wts = Math.floor(Date.now() / 1000)
  const keys = Object.keys(p).sort()
  const pairs = []
  for (let i = 0; i < keys.length; i++) {
    pairs.push(encodeURIComponentRFC3986(keys[i]) + '=' + encodeURIComponentRFC3986(p[keys[i]]))
  }
  const qs = pairs.join('&')
  return qs + '&w_rid=' + md5Utf8(qs + mixin)
}

function stripTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, '')
}

function formatPlay(n) {
  const num = Number(n) || 0
  // B 站对部分视频隐藏播放量, 返回 -1 (动态流 stat.play 常见), 显示 '--'
  if (num < 0) return '--'
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return String(num)
}

// QuickJS 20200705 不保证 Date.prototype.toISOString, 手工格式化
function formatDate(epochSec) {
  if (!epochSec) return ''
  const dt = new Date(epochSec * 1000)
  function pad(n) { return n < 10 ? '0' + n : '' + n }
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())
}

function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return m + ':' + (r < 10 ? '0' : '') + r
}

// 取流口 -> playurl 的 query 参数.
// 本机内置 <video> 只吃单一 http(s) 源的 mp4 (durl), DASH(fnval=16) 需要音视频双源, 用不了.
const SOURCE_QUERY = {
  // platform=html5: 官方 H5 口, 直接给 mp4 durl. 实测同一 cid 下 size 与 web 口完全一致.
  html5: '&qn=32&fnval=0&fnver=0&fourk=0&platform=html5&high_quality=1',
  // 网页口: 同源不同参数, 少量稿件 H5 口没有而它有
  web: '&qn=64&fnval=0&fnver=0&fourk=0'
}

function normalizeUrl(u) {
  let s = String(u || '')
  if (s.indexOf('//') === 0) s = 'https:' + s
  if (s.indexOf('http://') === 0) s = 'https://' + s.substring(7)
  return s
}

/**
 * 取播放地址 (只做"取地址", 不套用线路设置) —— 测速页要拿原始地址自己换 host.
 * @param {string} bvid
 * @param {number} cid
 * @param {{source?:string, noCache?:boolean}} [opts]
 * @returns {Promise<{url:string, duration:number, size:number, quality:number, backup:string}>}
 *   duration 毫秒 (timelength), size 字节
 */
export async function getPlayUrlRaw(bvid, cid, opts) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const o = opts || {}
  const src = SOURCE_QUERY[o.source] ? o.source : 'html5'
  const ckey = 'playurl:' + bvid + ':' + cid + ':' + src
  if (!o.noCache) {
    const cached = cacheGet(ckey, 600000)
    if (cached) return cached
  }
  const url = 'https://api.bilibili.com/x/player/playurl?bvid=' + encodeURIComponent(bvid)
    + '&cid=' + encodeURIComponent(cid) + SOURCE_QUERY[src]
  const body = await getJsonAsync(url, defTimeout())
  if (body.code !== 0 || !body.data) {
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('播放地址接口错误 code=' + body.code))
  }
  const durl = body.data.durl || []
  if (durl.length === 0 || !durl[0].url) throw new Error('没有可用的 MP4 播放地址')
  const d0 = durl[0]
  const out = {
    url: normalizeUrl(d0.url),
    backup: d0.backup_url && d0.backup_url.length ? normalizeUrl(d0.backup_url[0]) : '',
    duration: Number(body.data.timelength) || Number(d0.length) || 0,
    size: Number(d0.size) || 0,
    quality: Number(body.data.quality) || 0
  }
  if (!o.noCache) cacheSet(ckey, out)
  return out
}

/**
 * 取播放地址 (套用设置里的线路): 取流口 -> 备用地址 -> CDN host 替换.
 * @returns {Promise<{url:string, duration:number, size:number, quality:number, host:string, source:string}>}
 */
export async function getPlayUrl(bvid, cid, opts) {
  const o = opts || {}
  const want = o.source || getCfg('playSource') || 'auto'
  const host = currentHost()          // '' = 用接口返回的 host, 不替换
  const chain = []
  if (want === 'backup') chain.push('html5')
  else if (want === 'auto') { chain.push('html5'); if (getCfg('autoFallback')) chain.push('web') }
  else chain.push(want)

  let lastErr = null
  for (let i = 0; i < chain.length; i++) {
    try {
      const raw = await getPlayUrlRaw(bvid, cid, { source: chain[i] })
      let url = raw.url
      if (want === 'backup' && raw.backup) url = raw.backup
      url = applyHost(url, host)
      const h = url.replace(/^https?:\/\//, '').split('/')[0]
      log('播放', '取流口=' + chain[i] + ' host=' + h + ' size=' + Math.round(raw.size / 1024) + 'KB')
      return { url: url, duration: raw.duration, size: raw.size, quality: raw.quality, host: h, source: chain[i] }
    } catch (e) {
      lastErr = e
      logError('播放', '取流口 ' + chain[i] + ' 失败: ' + (e && e.message ? e.message : e))
    }
  }
  throw lastErr || new Error('没有可用的播放地址')
}

// ================= 直播 (参考 56dz/PenBili 的功能面, 接口按本机实测重选) =================
// 实测结论 (真机 curl, 2026-10-05):
//   - 搜索直播间: 必须走 **WBI 签名的 wbi/search/type?search_type=live**;
//     不带签名直连 search/type 返回风控 HTML, second/getList 返回 -352.
//   - 取流: xlive/web-room/v2/index/getRoomPlayInfo 匿名可用 (无需 Cookie),
//     鉴权在 URL 签名 (deadline/upsig) 里. 每档给 http_stream/flv 与 http_hls/ts|fmp4.
//   - 弹幕: 全量要 WebSocket, 本机没有 (QuickJS 无 ws, 解包还要 zlib/brotli).
//     降级方案是 /dM/gethistory —— 只有最近 10 条, 密集房间会丢, 只能做"最新弹幕条".
//   - 无登录态下 getRoomPlayInfo / gethistory 都能用.

/**
 * 搜索直播间 (WBI 签名)
 * @returns {Promise<Array<{roomid:number,title:string,up:string,online:number,cover:string,area:string}>>}
 */
export async function searchLive(keyword, page) {
  const qs = await wbiQuery({
    search_type: 'live',
    keyword: keyword,
    order: 'totalrank',
    page: page || 1,
    page_size: 20
  })
  const body = await getJsonAsync('https://api.bilibili.com/x/web-interface/wbi/search/type?' + qs, defTimeout())
  if (body.code !== 0 || !body.data) throw new Error(body.message || ('直播搜索失败 code=' + body.code))
  const res = body.data.result || {}
  // 匿名时 result 可能是对象 (带 live_room 数组) 也可能是空数组
  const arr = (res && res.live_room) ? res.live_room : []
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i]
    const rid = Number(it.roomid) || 0
    if (rid <= 0) continue
    let cover = it.cover || it.user_cover || ''
    if (cover.indexOf('//') === 0) cover = 'https:' + cover
    out.push({
      roomid: rid,
      title: stripTags(it.title || ''),
      up: it.uname || '',
      online: Number(it.online) || 0,
      cover: thumb(cover, 360, 224),
      area: it.cate_name || it.area_name || ''
    })
  }
  return out
}

// 直播协议优先级: HLS(m3u8) 对"直播"最稳 (可断点重连), 其次 FLV.
// 编码只取 avc: 本机硬解只保证 H.264, hevc 档在部分机型会静默失败.
var LIVE_PREF = [['http_hls', 'ts', 'avc'], ['http_hls', 'fmp4', 'avc'], ['http_stream', 'flv', 'avc']]

/**
 * 取直播间播放地址
 * @returns {Promise<{url:string, protocol:string, qn:number}>}
 */
export async function getLiveRoomPlayUrl(roomId) {
  const url = 'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id='
    + encodeURIComponent(roomId) + '&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8'
  const body = await getJsonAsync(url, defTimeout())
  if (body.code !== 0 || !body.data) throw new Error(body.message || ('直播间信息失败 code=' + body.code))
  const d = body.data
  if (!d.playurl_info || !d.playurl_info.playurl) {
    throw new Error(d.live_status === 0 || d.live_status === 2 ? '主播未开播' : '没有直播流 (可能已结束)')
  }
  const streams = d.playurl_info.playurl.stream || []
  function pick(pn, fn, cn) {
    for (let i = 0; i < streams.length; i++) {
      if (streams[i].protocol_name !== pn) continue
      const formats = streams[i].format || []
      for (let j = 0; j < formats.length; j++) {
        if (formats[j].format_name !== fn) continue
        const codecs = formats[j].codec || []
        for (let k = 0; k < codecs.length; k++) {
          if (codecs[k].codec_name !== cn) continue
          const c = codecs[k]
          const ui = c.url_info && c.url_info[0]
          if (!ui) continue
          return { url: ui.host + c.base_url + ui.extra, protocol: pn + '/' + fn, qn: Number(c.current_qn) || 0 }
        }
      }
    }
    return null
  }
  for (let i = 0; i < LIVE_PREF.length; i++) {
    const hit = pick(LIVE_PREF[i][0], LIVE_PREF[i][1], LIVE_PREF[i][2])
    if (hit) {
      log('直播', 'room=' + roomId + ' 线路=' + hit.protocol + ' qn=' + hit.qn)
      return hit
    }
  }
  throw new Error('没有可播放的直播流 (本机只保证 H.264)')
}

/**
 * 直播弹幕 (降级版: 只取最近 10 条)
 * WebSocket 全量方案在本机不可行 (QuickJS 无 ws + zlib/brotli 解包), 见 HANDOVER.
 */
export async function getLiveDanmaku(roomId) {
  const url = 'https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=' + encodeURIComponent(roomId)
  const body = await getJsonAsync(url, defTimeout())
  if (body.code !== 0 || !body.data) return []
  const room = body.data.room || []
  const out = []
  for (let i = 0; i < room.length; i++) {
    const it = room[i]
    let t = it.text || ''
    let nick = it.nickname || (it.user && it.user.base && it.user.base.name) || ''
    if (!t) continue
    out.push({ id: it.id_str || (nick + '|' + t + '|' + it.timeline), nick: nick, text: t, time: it.timeline || '' })
  }
  return out
}

// ================= 消息中心 (需登录; 读取类不需要 csrf) =================
// 接口面参考 56dz/PenBili 研究 + bilibili-API-collect: /x/msgfeed/unread 给未读计数,
// /x/msgfeed/reply 给「回复我的」列表 (游标 id + reply_time).
export async function getMsgUnread() {
  const body = await getJsonAsync('https://api.bilibili.com/x/msgfeed/unread', defTimeout())
  if (body.code !== 0 || !body.data) throw new Error(msgErr(body))
  const d = body.data
  return {
    at: Number(d.at) || 0,
    reply: Number(d.reply) || 0,
    like: Number(d.like) || 0,
    sys: Number(d.sys_msg) || 0,
    up: Number(d.up) || 0,
    total: (Number(d.at) || 0) + (Number(d.reply) || 0) + (Number(d.like) || 0) + (Number(d.sys_msg) || 0)
  }
}

export async function getMsgReplies(id, time) {
  let url = 'https://api.bilibili.com/x/msgfeed/reply?platform=web&web_location=333.40138'
  if (id) url += '&id=' + encodeURIComponent(id) + '&reply_time=' + encodeURIComponent(time || '')
  const body = await getJsonAsync(url, defTimeout())
  if (body.code !== 0 || !body.data) throw new Error(msgErr(body))
  const d = body.data
  const items = d.items || []
  const out = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const user = it.user || {}
    const item = it.item || {}
    let face = user.avatar || ''
    if (face.indexOf('//') === 0) face = 'https:' + face
    out.push({
      id: String(it.id || ''),
      time: Number(it.reply_time) || 0,
      uname: user.nickname || '',
      face: thumb(face, 72, 72),
      title: item.title || '',
      // 优先显示"对方回了什么", 没有就退回原文
      content: stripTags(item.target_reply_content || item.source_content || item.root_reply_content || ''),
      bvid: item.subject_id ? '' : '',
      oid: item.subject_id || 0,
      uri: item.uri || item.native_uri || ''
    })
  }
  return { items: out, cursor: d.cursor || null }
}

function msgErr(body) {
  if (body && body.code === -101) return '未登录, 请先在「我的」里登录'
  return (body && body.message) || ('消息接口错误 code=' + (body && body.code))
}


// B站图片服务按需裁切 (大幅缩短列表首次渲染的下载+解码耗时)
// 图片质量档 (设置页「图片质量」): 请求尺寸 = 显示尺寸 x 系数.
// 设备 image 组件按最终尺寸采样, 所以省流档直接请求更小的图 (带宽/解码一起降),
// 高清档请求更大的图让缩放余量更足.
const IMG_SCALE = { low: 0.72, std: 1, high: 1.6 }

function thumb(url, w, h) {
  if (!url) return ''
  if (url.indexOf('//') === 0) url = 'https:' + url
  // 设备 image 组件对 http:// 的加载不可靠 (0.8.6 动态封面不显示的主嫌疑),
  // 统一升级成 https —— B 站图床 i0.hdslb.com 支持 https, 无兼容风险.
  if (url.indexOf('http://') === 0) url = 'https://' + url.substring(7)
  // 已经是缩略尺寸的不重复追加
  if (url.indexOf('@') > 0) return url
  const k = IMG_SCALE[getCfg('imgQuality')] || 1
  const tw = Math.max(64, Math.round(Number(w) * k))
  const th = Math.max(36, Math.round(Number(h) * k))
  return url + '@' + tw + 'w_' + th + 'h_1c.jpg'
}

// 详情页封面: 只限宽度, 保留原始比例 (不能用 _1c 裁切版本, 否则 16:9 会被压成 16:10 裁掉两边)
function thumbAspect(url, w) {
  if (!url) return ''
  if (url.indexOf('//') === 0) url = 'https:' + url
  if (url.indexOf('http://') === 0) url = 'https://' + url.substring(7)
  if (url.indexOf('@') > 0) return url
  return url + '@' + w + 'w.jpg'
}

// ================= 评论表情 (B 站 emote 优先 + unicode emoji 内置图) =================

// 内置图未覆盖的 emoji 走 twemoji CDN (真机实测可达: 200 + 806B), 兜底不再显示空白.
const TWEMOJI_CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/'

// unicode emoji 设备字体渲染不出 (豆腐块), 常用的转成内置 PNG (CLI 编译时打包进应用,
// 不依赖网络/CDN —— 防止系统不显示). key 为 twemoji 文件名 (不带 .png).
// B 站独有表情优先级更高: content.emote 有映射的 (含 emoji 字符 key) 一律走 B 站 CDN 图.
// 内置映射由页面层传入 (scanEmoji 的 builtin 参数) —— aiot-cli 只编译 .vue 文件里的
// require png, .js 文件里的 require 原样保留会在 QuickJS 运行时崩掉 (无 require 函数).

// 「强 emoji」码点 (转图片); ©®™ 等弱符号单独出现时保持文本
function isStrongEmoji(cp) {
  return (cp >= 0x1f000 && cp <= 0x1ffff) ||   // 主体 emoji (含 🤣 ⭐ 等)
    (cp >= 0x2600 && cp <= 0x27bf) ||           // ☀ ❤ ✨ 等
    (cp >= 0x2b00 && cp <= 0x2bff) ||           // ⭐ ⬆ 等
    (cp >= 0x231a && cp <= 0x231b) || cp === 0x2328 ||
    (cp >= 0x23e9 && cp <= 0x23fa) || cp === 0x24c2 ||
    (cp >= 0x25aa && cp <= 0x25fe) ||           // ▶ ▪ 等
    (cp >= 0x2934 && cp <= 0x2935) ||
    cp === 0x3030 || cp === 0x303d || cp === 0x3297 || cp === 0x3299
}

// emoji 序列的起始码点 (含 ©®™, 它们带变体选择符时是 emoji)
function isEmojiStart(cp) {
  return isStrongEmoji(cp) || cp === 0x00a9 || cp === 0x00ae || cp === 0x2122
}

// 连接符/选择符 (并入当前 emoji 序列)
function isEmojiJoiner(cp) {
  return cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e || cp === 0x20e3
}

// 文本段追加 (过滤空段)
function pushText(segs, s) {
  if (s) segs.push({ t: 0, v: s })
}

// 扫描文本: unicode emoji 转 twemoji 图片段, 其余为文字段.
// segment: { t:0, v:文字 } | { t:1, v:图URL, w, h }
function scanEmoji(text, segs, builtin) {
  if (!text) return
  let buf = ''
  let i = 0
  while (i < text.length) {
    const cp = text.codePointAt(i)
    if (!isEmojiStart(cp)) {
      buf += text.charAt(i)
      i++
      continue
    }
    // 收集 emoji 序列: 起始字符 + 连接符/后续 emoji.
    // 仅 ZWJ 连接的 emoji 属于同一序列 (👍❤️ 相邻无 ZWJ 必须切开, 否则文件名不存在)
    let end = i + (cp > 0xffff ? 2 : 1)
    let prev = cp
    while (end < text.length) {
      const c2 = text.codePointAt(end)
      if (isEmojiJoiner(c2)) {
        end += c2 > 0xffff ? 2 : 1
        prev = c2
        continue
      }
      if (isEmojiStart(c2) && prev === 0x200d) {
        end += c2 > 0xffff ? 2 : 1
        prev = c2
        continue
      }
      break
    }
    const slice = text.substring(i, end)
    // twemoji 文件名规则: codepoints 去掉 FE0F, 其余 '-' 连接 (ZWJ/keycap 保留)
    let convert = false
    const names = []
    for (let j = 0; j < slice.length; j++) {
      const c = slice.codePointAt(j)
      if (c > 0xffff) j++   // 代理对: 码点读全, 下标多跳 1
      if (c === 0xfe0f) { convert = true; continue }
      if (c === 0xfe0e) continue   // 文本变体: 保持字体渲染
      if (c === 0x200d || c === 0x20e3) { convert = true; names.push(c.toString(16)); continue }
      if (isStrongEmoji(c)) convert = true
      names.push(c.toString(16))
    }
    if (convert) {
      // 优先内置图片 (打包文件, 不依赖网络); 未内置的保持原字符
      const key = names.join('-')
      const img = builtin ? builtin[key] : null
      if (img) {
        pushText(segs, buf)
        buf = ''
        segs.push({ t: 1, v: img, w: 30, h: 30 })
      } else {
        // 内置图没有 -> 走 CDN (设备字体渲染不出 emoji, 留原字符等于空白)
        pushText(segs, buf)
        buf = ''
        segs.push({ t: 1, v: TWEMOJI_CDN + key + '.png', w: 30, h: 30 })
      }
    } else {
      buf += slice   // ©®™ 单独出现, 保持文本
    }
    i = end
  }
  pushText(segs, buf)
}

// 解析评论内容: B 站表情占位符 ([dog] 等) 按 content.emote 映射成图片,
// 剩余文本再做 emoji 切分. emote 图按 API 给的原始尺寸等比缩到高 34 内.
export function parseMessage(text, emotes, builtin) {
  const segs = []
  const rest = String(text == null ? '' : text).replace(/\r/g, '')
  const emoteMap = emotes || {}
  const keys = []
  for (const k in emoteMap) keys.push(k)
  let pieces
  if (keys.length > 0) {
    // 循环找最早出现的占位符切分 (emote key 自带方括号, 完整匹配不互吃)
    pieces = []
    let pos = 0
    while (true) {
      let best = -1
      let bestKey = ''
      for (let i = 0; i < keys.length; i++) {
        const p = rest.indexOf(keys[i], pos)
        if (p >= 0 && (best < 0 || p < best)) { best = p; bestKey = keys[i] }
      }
      if (best < 0) break
      pieces.push({ emote: false, s: rest.substring(pos, best) })
      pieces.push({ emote: true, key: bestKey })
      pos = best + bestKey.length
    }
    pieces.push({ emote: false, s: rest.substring(pos) })
  } else {
    pieces = [{ emote: false, s: rest }]
  }
  for (let i = 0; i < pieces.length; i++) {
    if (!pieces[i].emote) {
      scanEmoji(pieces[i].s, segs, builtin)
      continue
    }
    const em = emoteMap[pieces[i].key] || {}
    let url = em.url || ''
    if (url.indexOf('//') === 0) url = 'https:' + url
    if (url.indexOf('http://') === 0) url = 'https://' + url.substring(7)
    if (!url) continue
    const w = Number(em.width) || 30
    const h = Number(em.height) || 30
    const scale = Math.min(1, 34 / Math.max(w, h))
    segs.push({ t: 1, v: url, w: Math.round(w * scale), h: Math.round(h * scale) })
  }
  return segs
}

function mapFeedItem(v) {
  let pic = v.pic || ''
  if (pic.indexOf('//') === 0) pic = 'https:' + pic
  return {
    bvid: v.bvid || '',
    aid: v.aid || 0,
    title: stripTags(v.title),
    author: v.author || (v.owner && v.owner.name) || '',
    playText: formatPlay(v.play !== undefined ? v.play : (v.stat && v.stat.view)),
    duration: typeof v.duration === 'number' ? formatDuration(v.duration) : (v.duration || ''),
    pic: thumb(pic, 400, 250)
  }
}

/**
 * 搜索哔哩哔哩视频
 * @param {string} keyword 关键词
 * @param {number} page 页码, 从 1 开始
 * @returns {Promise<Array<{bvid,title,author,playText,duration,pic}>>}
 */
export async function searchVideos(keyword, page) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  // 同词同页缓存 2 分钟
  const ckey = 'search:' + keyword + ':' + (page || 1)
  const cached = cacheGet(ckey, 120000)
  if (cached) { console.log('[bili] 搜索命中缓存, 不发请求'); return cached }
  // wbi 签名 + dm_* 反爬参数 (官方前端同款)
  const url = 'https://api.bilibili.com/x/web-interface/wbi/search/type?'
    + (await wbiQuery({
      search_type: 'video',
      keyword: keyword,
      page: page || 1,
      pagesize: 20,
      dm_img_list: '[]',
      dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
      dm_cover_img_str: 'QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjMwKCAweDAwMDAzRTkxKSBEaXJlY3QzRDExIHZzXzVfMCBwc181XzAsIEQzRDExKUdvb2dsZSBJbmMuIChJbnRlbCk',
      dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}'
    }))

  const body = await getJsonAsync(url, 15)
  if (body.code !== 0) {
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('接口错误 code=' + body.code))
  }

  const list = (body.data && body.data.result) || []
  const videos = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item || item.type !== 'video') continue
    let pic = item.pic || ''
    if (pic.indexOf('//') === 0) pic = 'https:' + pic
    videos.push({
      bvid: item.bvid || '',
      aid: item.aid || 0,
      title: stripTags(item.title),
      author: item.author || '',
      playText: formatPlay(item.play),
      duration: item.duration || '',
      pic: thumb(pic, 400, 250)
    })
  }
  cacheSet(ckey, videos)
  return videos
}

/**
 * 获取视频详情
 * @param {string} bvid
 * @param {boolean} [noCache] 跳过缓存强拉 (点赞/投币等操作后刷新状态用)
 * @returns {Promise<{bvid,aid,title,pic,desc,author,duration,pubdateText,playText,danmakuText,likeText,coinText,favText,shareText,reqLike,reqCoin,reqFav}>}
 */
// ==================== 搜索页: 大家都在搜 / 搜索发现 ====================
// 两个接口真机实测都可匿名访问 (设备 curl 直连):
//   s.search.bilibili.com/main/hotword            -> {code:0, list:[...]}
//   app.bilibili.com/x/v2/search/trending/ranking -> {code:0, data:{list:[...]}}
// 取 show_name 而不是 keyword: 前者是给用户看的文案 (可能带活动后缀), 后者是检索词.
function pickWords(list, max) {
  const out = []
  for (let i = 0; list && i < list.length && out.length < max; i++) {
    const w = String((list[i] && (list[i].show_name || list[i].keyword)) || "")
    if (w && out.indexOf(w) < 0) out.push(w)
  }
  return out
}

export async function getHotSearch() {
  const body = await getJsonAsync("https://s.search.bilibili.com/main/hotword", 12)
  return pickWords(body && body.list, 12)
}

export async function getSearchTrending() {
  const body = await getJsonAsync("https://app.bilibili.com/x/v2/search/trending/ranking?limit=10", 12)
  return pickWords(body && body.data && body.data.list, 10)
}

// ==================== 详情页: AI 总结 ====================
// 官方接口 x/web-interface/view/conclusion/get. 真机实测:
//   不带签名 -> code=-403 访问权限不足; 必须 wbi 签名 (且要登录态, cookie 由 getJsonAsync 统一带).
//   未登录 / 这条稿件没生成总结都会返回非 0 —— 一律当作"没有 AI 总结"返回 null,
//   由页面决定隐藏整块, 不当错误弹给用户.
export async function getAiConclusion(bvid, cid, upMid) {
  const q = await wbiQuery({ bvid: bvid, cid: Number(cid) || 0, up_mid: Number(upMid) || 0 })
  const body = await getJsonAsync("https://api.bilibili.com/x/web-interface/view/conclusion/get?" + q, 20)
  if (!body || body.code !== 0 || !body.data) return null
  const mr = body.data.model_result
  if (!mr) return null
  const outline = []
  const o = mr.outline || []
  for (let i = 0; i < o.length; i++) {
    const parts = []
    const po = o[i].part_outline || []
    for (let j = 0; j < po.length; j++) {
      parts.push({ ts: Number(po[j].timestamp) || 0, tsText: formatDuration(po[j].timestamp), text: String(po[j].content || "") })
    }
    outline.push({ title: String(o[i].title || ""), parts: parts })
  }
  const summary = String(mr.summary || "")
  if (!summary && outline.length === 0) return null
  return { summary: summary, outline: outline }
}

export async function getVideoDetail(bvid, noCache) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  // 详情缓存 5 分钟 (noCache: 交互操作后强拉最新状态)
  const ckey = 'view:' + bvid
  if (!noCache) {
    const cached = cacheGet(ckey, 300000)
    if (cached) { console.log('[bili] 详情命中缓存, 不发请求'); return cached }
  }
  // 详情带 wbi 签名, 与官方前端一致 (wbi/view 为 wbi 版本接口)
  const url = 'https://api.bilibili.com/x/web-interface/wbi/view?'
    + (await wbiQuery({ bvid: bvid }))

  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    if (body.code === -404) throw new Error('视频不存在或已删除')
    throw new Error(body.message || ('接口错误 code=' + body.code))
  }

  const d = body.data
  const st = d.stat || {}
  // req_user: 登录态下本账号与该稿件的交互状态 (like=已赞, coin>0=已投币, favorite=已收藏)
  const ru = d.req_user || {}
  let pic = d.pic || ''
  if (pic.indexOf('//') === 0) pic = 'https:' + pic
  // 封面比例: 优先用接口 dimension, 缺失时按 16:9 兜底
  const dim = d.dimension || {}
  let dimW = Number(dim.width) || 16, dimH = Number(dim.height) || 9
  if (Number(dim.rotate) === 1) { const t = dimW; dimW = dimH; dimH = t }
  if (dimW <= 0 || dimH <= 0) { dimW = 16; dimH = 9 }
  const out = {
    bvid: d.bvid || bvid,
    aid: d.aid || 0,
    title: d.title || '',
    pic: thumbAspect(pic, 640),
    // 封面原始宽高 (按比例显示用; rotate=1 表示横竖互换)
    dimW: dimW, dimH: dimH,
    desc: d.desc || '',
    // 警示标识 (官方 App 的「个人观点，仅供参考」): 详情接口的 argue_info.argue_msg
    argue: (d.argue_info && d.argue_info.argue_msg) ? String(d.argue_info.argue_msg) : '',
    author: (d.owner && d.owner.name) || '',
    duration: formatDuration(d.duration),
    pubdateText: formatDate(d.pubdate),
    playText: formatPlay(st.view),
    danmakuText: formatPlay(st.danmaku),
    likeText: formatPlay(st.like),
    coinText: formatPlay(st.coin),
    favText: formatPlay(st.favorite),
    shareText: formatPlay(st.share),
    // 评论数: 详情接口自带 (stat.reply). 页内评论 tab 的计数直接用它 ——
    // 既不额外发请求 (当年评论后台预取会拖死整个应用, 已关), 又能一进页面就显示
    replyCount: Number(st.reply) || 0,
    replyText: formatPlay(st.reply),
    // 交互状态 (未登录时 req_user 缺失, 全 false)
    reqLike: ru.like === 1,
    reqCoin: (Number(ru.coin) || 0) > 0,
    reqFav: ru.favorite === 1,
    // 稍后再看状态 view 接口不返回, 由页面异步查 isInToView 后回填;
    // 这里先声明字段 (Vue2 新增属性不响应, 必须建对象时就带上)
    reqToview: false,
    mid: (d.owner && d.owner.mid) || 0,
    // 分 P (同稿件多段)
    pages: (d.pages || []).map(function (p) {
      return { page: p.page || 0, cid: p.cid || 0, part: p.part || '', duration: formatDuration(p.duration) }
    }),
    // 合集 (不同稿件聚合)
    season: d.ugc_season ? {
      title: d.ugc_season.title || '',
      episodes: (((d.ugc_season.sections || [])[0] || {}).episodes || []).map(function (e) {
        return { bvid: e.bvid || '', title: e.title || '', aid: e.aid || 0 }
      })
    } : null
  }
  cacheSet('view:' + bvid, out)
  return out
}

/**
 * 相关推荐视频 (x/web-interface/archive/related, 匿名可用)
 */
export async function getRelatedVideos(bvid) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const ckey = 'related:' + bvid
  const cached = cacheGet(ckey, 300000)
  if (cached) return cached
  const url = 'https://api.bilibili.com/x/web-interface/archive/related?bvid=' + encodeURIComponent(bvid)
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0) return [] // 推荐失败容忍, 不阻塞详情
  const out = (body.data || []).map(mapFeedItem)
  cacheSet(ckey, out)
  return out
}

/**
 * 全站热门视频 (无需登录)
 * @returns {Promise<Array<feedItem>>}
 */
export async function getPopular(page, fresh) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const ckey = 'popular:' + (page || 1)
  if (!fresh) {
    const cached = cacheGet(ckey, 60000)
    if (cached) return cached
  }
  const url = 'https://api.bilibili.com/x/web-interface/popular?pn=' + (page || 1) + '&ps=20'
    + (fresh ? ('&_=' + Date.now()) : '')
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0) {
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('接口错误 code=' + body.code))
  }
  const list = (body.data && body.data.list) || []
  const videos = []
  for (let i = 0; i < list.length; i++) videos.push(mapFeedItem(list[i]))
  cacheSet(ckey, videos)
  return videos
}

/**
 * 真主页推荐流 (x/web-interface/index/top/feed/rcmd, 无需登录, 官网首页同款).
 * 分页游标 fresh_idx 递增即可无限翻页, 返回空数组即到底.
 * @returns {Promise<Array<feedItem>>}
 */
export async function getRecommend(page, fresh) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const ckey = 'rcmd:' + (page || 1)
  // fresh=true: 绕过 60s 结果缓存 (下拉刷新必须拿新内容, 否则「刷新成功但没变」)
  if (!fresh) {
    const cached = cacheGet(ckey, 60000)
    if (cached) return cached
  }
  const url = 'https://api.bilibili.com/x/web-interface/index/top/feed/rcmd?ps=12'
    + '&fresh_idx=' + (page || 1) + '&fresh_idx_1h=' + (page || 1) + '&fresh_type=4&version=1'
    + (fresh ? ('&_=' + Date.now()) : '')
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('接口错误 code=' + body.code))
  }
  const list = body.data.item || []
  const videos = []
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    if (!v) continue
    let pic = v.pic || ''
    if (pic.indexOf('//') === 0) pic = 'https:' + pic
    videos.push({
      bvid: v.bvid || '',
      aid: v.aid || 0,
      // rcmd 标题带 <em class="keyword"> 高亮标记, stripTags 统一去除
      title: stripTags(v.title),
      author: (v.owner && v.owner.name) || '',
      playText: formatPlay(v.stat && v.stat.view),
      duration: typeof v.duration === 'number' ? formatDuration(v.duration) : (v.duration || ''),
      pic: thumb(pic, 400, 250)
    })
  }
  cacheSet(ckey, videos)
  return videos
}

/**
 * UP主基本信息 (x/space/wbi/acc/info, wbi 签名)
 */
export async function getUpInfo(mid) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const ckey = 'upinfo:' + mid
  const cached = cacheGet(ckey, 600000)
  if (cached) return cached
  // 先走 acc/info (字段全)
  try {
    const url = 'https://api.bilibili.com/x/space/wbi/acc/info?' + (await wbiQuery({ mid: mid }))
    const body = await getJsonAsync(url, 15)
    if (body.code !== 0 || !body.data) {
      if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
      if (body.code === -352) throw new Error('接口风控, 无法获取UP主信息')
      throw new Error(body.message || ('接口错误 code=' + body.code))
    }
    const d = body.data
    let face = d.face || ''
    if (face.indexOf('//') === 0) face = 'https:' + face
    const out = {
      mid: d.mid || mid,
      name: d.name || '',
      sign: d.sign || '',
      face: thumb(face, 96, 96),
      levelText: 'Lv' + (d.level !== undefined ? d.level : '?'),
      // 个人主页的认证标识 + 头像框 (acc/info 的 official / pendant)
      officialType: (d.official && typeof d.official.type === 'number') ? d.official.type : -1,
      officialRole: (d.official && typeof d.official.role === 'number') ? d.official.role : -1,
      officialDesc: (d.official && (d.official.title || d.official.desc)) || '',
      pendant: (d.pendant && Number(d.pendant.pid) > 0) ? dynHttps(d.pendant.image_enhance || d.pendant.image || '') : '',
      vipText: (d.vip && d.vip.label && d.vip.label.text) || ''
    }
    cacheSet('upinfo:' + mid, out)
    return out
  } catch (accErr) {
    console.log('[bili] acc/info 失败, 降级 x/web-interface/card: ' + (accErr && accErr.message))
  }
  // 降级: x/web-interface/card (免登录基本资料接口, 风控比空间接口宽松)
  // 注意: 字段嵌套在 data.card 下, level 在 level_info.current_level
  const cardBody = await getJsonAsync('https://api.bilibili.com/x/web-interface/card?mid=' + encodeURIComponent(mid), 15)
  if (cardBody.code !== 0 || !cardBody.data) {
    throw new Error(cardBody.message || ('接口错误 code=' + cardBody.code))
  }
  const cd = cardBody.data.card || cardBody.data
  const lv = cd.level_info && cd.level_info.current_level !== undefined
    ? cd.level_info.current_level : cd.level
  let face = cd.face || ''
  if (face.indexOf('//') === 0) face = 'https:' + face
  const cardOut = {
    mid: cd.mid || mid,
    name: cd.name || '',
    sign: cd.sign || '',
    face: thumb(face, 96, 96),
    levelText: 'Lv' + (lv !== undefined ? lv : '?'),
    officialType: (cd.Official && typeof cd.Official.type === 'number') ? cd.Official.type : -1,
    officialDesc: (cd.Official && (cd.Official.title || cd.Official.desc)) || '',
    pendant: (cd.pendant && Number(cd.pendant.pid) > 0) ? dynHttps(cd.pendant.image_enhance || cd.pendant.image || '') : '',
    vipText: ''
  }
  cacheSet('upinfo:' + mid, cardOut)
  return cardOut
}

/**
 * UP主粉丝数 (x/relation/stat; 独立接口, 失败容忍)
 */
export async function getUpFans(mid) {
  const url = 'https://api.bilibili.com/x/relation/stat?vmid=' + encodeURIComponent(mid)
  const body = await getJsonAsync(url, 10)
  if (body.code !== 0 || !body.data) return ''
  return formatPlay(body.data.follower)
}

/**
 * UP主视频 (x/space/wbi/arc/search, wbi 签名; 风控时降级 x/series/recArchivesByKeywords)
 */
export async function getUpVideos(mid, page) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const ckey = 'upvideos:' + mid + ':' + (page || 1)
  const cached = cacheGet(ckey, 120000)
  if (cached) return cached
  // 主路径: 空间投稿接口 (wbi 签名)
  try {
    const url = 'https://api.bilibili.com/x/space/wbi/arc/search?'
      + (await wbiQuery({ mid: mid, pn: page || 1, ps: 20, order: 'pubdate' }))
    const body = await getJsonAsync(url, 15)
    if (body.code !== 0) {
      if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
      if (body.code === -352) throw new Error('接口风控, 视频列表暂不可用')
      throw new Error(body.message || ('接口错误 code=' + body.code))
    }
    const list = (body.data && body.data.list && body.data.list.vlist) || []
    const videos = []
    for (let i = 0; i < list.length; i++) {
      const v = list[i]
      let pic = v.pic || ''
      if (pic.indexOf('//') === 0) pic = 'https:' + pic
      videos.push({
        bvid: v.bvid || '',
        aid: v.aid || 0,
        title: stripTags(v.title),
        author: v.author || '',
        playText: formatPlay(v.play),
        duration: v.length || '',
        pic: thumb(pic, 400, 250)
      })
    }
    cacheSet(ckey, videos)
    return videos
  } catch (arcErr) {
    console.log('[bili] arc/search 失败, 降级 recArchivesByKeywords: ' + (arcErr && arcErr.message))
  }
  // 降级: x/series/recArchivesByKeywords (不需要 wbi 签名, 官方文档注"暂未发现风控校验")
  const url2 = 'https://api.bilibili.com/x/series/recArchivesByKeywords?mid='
    + encodeURIComponent(mid) + '&keywords=&ps=20&pn=' + (page || 1) + '&orderby=pubdate'
  const body2 = await getJsonAsync(url2, 15)
  if (body2.code !== 0) {
    throw new Error(body2.message || ('接口错误 code=' + body2.code))
  }
  const list2 = (body2.data && body2.data.archives) || []
  const videos2 = []
  for (let i = 0; i < list2.length; i++) {
    const v = list2[i]
    let pic = v.pic || ''
    if (pic.indexOf('//') === 0) pic = 'https:' + pic
    videos2.push({
      bvid: v.bvid || '',
      aid: v.aid || 0,
      title: stripTags(v.title),
      author: '',
      playText: formatPlay(v.stat && v.stat.view),
      duration: v.duration ? formatDuration(v.duration) : '',
      pic: thumb(pic, 400, 250)
    })
  }
  cacheSet(ckey, videos2)
  return videos2
}

// ================= 交互操作 (点赞/投币/收藏/三连/稍后再看, 需登录 + csrf) =================

function needCsrf() {
  if (!auth.hasCookie()) throw new Error('登录后才能操作')
  const csrf = auth.getCsrf()
  if (!csrf) throw new Error('Cookie 缺少 bili_jct (请重新登录)')
  return csrf
}

/**
 * 点赞/取消赞 (x/web-interface/archive/like, like=1 赞 / 2 取消)
 * @returns {Promise<{ok:boolean}>}
 */
export async function likeVideo(aid, on) {
  const csrf = needCsrf()
  const data = 'aid=' + encodeURIComponent(aid) + '&like=' + (on === false ? 2 : 1)
    + '&csrf=' + encodeURIComponent(csrf)
  const body = await postJsonAsync('https://api.bilibili.com/x/web-interface/archive/like', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('点赞失败 code=' + body.code))
  }
  return true
}

/**
 * 投币 (x/web-interface/coin/add, multiply=1/2, select_like=1 同时点赞)
 * @returns {Promise<{ok:boolean, like:boolean}>}
 */
export async function addCoin(aid, multiply, withLike) {
  const csrf = needCsrf()
  const data = 'aid=' + encodeURIComponent(aid) + '&multiply=' + (multiply === 2 ? 2 : 1)
    + '&select_like=' + (withLike ? 1 : 0) + '&csrf=' + encodeURIComponent(csrf)
  const body = await postJsonAsync('https://api.bilibili.com/x/web-interface/coin/add', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === 34002) throw new Error('硬币不足')
    if (body.code === 34003) throw new Error('超过投币上限')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('投币失败 code=' + body.code))
  }
  return { like: body.data && body.data.like === true }
}

/**
 * 收藏夹列表 (x/v3/fav/folder/created/list-all, 需登录)
 * @param {number} rid 稿件 aid (传入时返回该稿件的收藏状态)
 * @returns {Promise<Array<{id,title,mediaCount,favoured}>>}
 *
 * 2026-10-01 真机+实账号实测 (关键坑):
 *   传 rid 时每个收藏夹返回的是 **fav_state** (int), 该稿件在这个夹里就是 1, 否则 0.
 *   接口**不返回 favoured** 字段 —— 之前按 favoured===1 判断导致收藏按钮状态永远是未收藏.
 *   实测: rid=116809621572499 (已收藏) -> 默认收藏夹 fav_state=1, 其余 12 个夹全 0.
 *   另有轻量接口 x/v2/fav/video/favoured?aid= 直接返回 {count, favoured:true/false}.
 */
export async function getFavFolders(rid) {
  if (!auth.hasCookie()) throw new Error('登录后才能查看收藏夹')
  // up_mid 必填 (缺了返回 -400 请求错误, 真机实测): 用登录 cookie 里的 DedeUserID
  const mid = auth.getMid()
  if (!mid) throw new Error('Cookie 缺少 DedeUserID (请重新登录)')
  const url = 'https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid='
    + encodeURIComponent(mid) + '&type=2'
    + (rid ? '&rid=' + encodeURIComponent(rid) : '')
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    throw new Error(body.message || ('收藏夹接口错误 code=' + body.code))
  }
  const list = body.data.list || []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    if (!f) continue
    out.push({
      id: f.id || 0,
      title: f.title || '收藏夹',
      mediaCount: f.media_count || 0,
      // fav_state=1 表示该稿件在此收藏夹中; 兼容个别版本直接返回 favoured 的情况
      favoured: f.fav_state === 1 || f.favoured === 1 || f.favoured === true
    })
  }
  return out
}

/**
 * 是否已收藏 (x/v2/fav/video/favoured, 一次请求给权威结果; 同步, 失败抛错)
 * 注意: x/v2/fav/video/del 实测返回 code=0 但**并不会真的取消收藏**(真机+实账号验证),
 * 取消必须走 deal + del_media_ids 且要带上"包含该稿件"的收藏夹 id.
 */
export async function isFavoured(aid) {
  if (!auth.hasCookie()) throw new Error('登录后才能查询收藏状态')
  const b = await getJsonAsync('https://api.bilibili.com/x/v2/fav/video/favoured?aid='
    + encodeURIComponent(aid), 10)
  if (!b || b.code !== 0 || !b.data) throw new Error('收藏状态接口错误 code=' + (b && b.code))
  return b.data.favoured === true
}

/**
 * 取消收藏: 逐个收藏夹 deal(del). 稿件可能同时在多个夹里 (B 站允许),
 * 只删一个会出现"界面显示已取消但实际还在收藏夹"的假成功.
 * @returns {Promise<Array<{id,title,msg}>>} 失败的夹 (空数组=全部成功)
 */
export async function cancelFav(aid, folders) {
  const failed = []
  for (let i = 0; i < folders.length; i++) {
    try {
      await dealFav(aid, folders[i].id, false)
    } catch (e) {
      failed.push({ id: folders[i].id, title: folders[i].title, msg: (e && e.message) ? e.message : String(e) })
    }
  }
  return failed
}

/**
 * 收藏/取消收藏 (x/v3/fav/resource/deal, add/del_media_ids)
 */
export async function dealFav(aid, folderId, on) {
  const csrf = needCsrf()
  const data = 'rid=' + encodeURIComponent(aid) + '&type=2&csrf=' + encodeURIComponent(csrf)
    + '&' + (on === false ? 'del_media_ids=' + encodeURIComponent(folderId)
                          : 'add_media_ids=' + encodeURIComponent(folderId))
  const body = await postJsonAsync('https://api.bilibili.com/x/v3/fav/resource/deal', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('收藏失败 code=' + body.code))
  }
  return true
}

/**
 * 添加稍后再看 (x/v2/history/toview/add, 需登录 + csrf)
 */
export async function addToViewLater(aid) {
  const csrf = needCsrf()
  const data = 'aid=' + encodeURIComponent(aid) + '&csrf=' + encodeURIComponent(csrf)
  const body = await postJsonAsync('https://api.bilibili.com/x/v2/history/toview/add', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === 57001) throw new Error('稍后再看列表已满')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('添加失败 code=' + body.code))
  }
  return true
}

/**
 * 取消稍后再看 (x/v2/history/toview/del, 需登录 + csrf)
 */
export async function delToViewLater(aid) {
  const csrf = needCsrf()
  const data = 'aid=' + encodeURIComponent(aid) + '&csrf=' + encodeURIComponent(csrf)
  const body = await postJsonAsync('https://api.bilibili.com/x/v2/history/toview/del', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('取消失败 code=' + body.code))
  }
  return true
}

/**
 * 查询某视频是否已在稍后再看列表 (只看第一页 20 条, 够用且省请求).
 * 失败返回 false (不阻塞详情页, 按钮退化为「未加入」态).
 */
export async function isInToView(aid) {
  if (!auth.hasCookie()) return false
  try {
    const url = 'https://api.bilibili.com/x/v2/history/toview/web?pn=1&ps=20'
    const body = await getJsonAsync(url, 10)
    if (body.code !== 0 || !body.data) return false
    const list = body.data.list || []
    for (let i = 0; i < list.length; i++) {
      if (list[i] && Number(list[i].aid) === Number(aid)) return true
    }
  } catch (e) {
    console.log('[bili] toview 状态查询失败: ' + (e && e.message ? e.message : e))
  }
  return false
}

// ================= 我的页面子列表 (历史记录/收藏/稍后再看, 需登录) =================

/**
 * 历史记录 (x/web-interface/history/search, wbi 签名)
 * @returns {Promise<{items:Array, hasMore:boolean}>}
 */
export async function getHistoryList(pn) {
  if (!auth.hasCookie()) throw new Error('未登录')
  const url = 'https://api.bilibili.com/x/web-interface/history/search?'
    + (await wbiQuery({ pn: pn || 1, ps: 20, business: 'all' }))
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('历史接口错误 code=' + body.code))
  }
  const list = body.data.list || []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const h = list[i]
    if (!h) continue
    // history.business: archive=视频 / pugv=课程 / article=专栏, 只展示视频类
    const his = h.history || {}
    if (his.business !== 'archive' || !his.bvid) continue
    items.push({
      bvid: his.bvid,
      aid: his.aid || 0,
      title: stripTags(h.title || h.show_title || ''),
      author: h.author_name || '',
      // progress 秒: 看到第几秒, 0 = 未看; duration 秒
      progressText: h.progress > 0 && h.duration > 0
        ? '看到 ' + formatDuration(h.progress) + ' / ' + formatDuration(h.duration)
        : (h.duration > 0 ? formatDuration(h.duration) : ''),
      pic: thumb(h.cover || '', 400, 250),
      pubText: formatDate(h.view_at) ? '看于 ' + formatDate(h.view_at) : ''
    })
  }
  return { items: items, hasMore: hasMoreOf(body.data.has_more) && items.length > 0 }
}

/**
 * 收藏夹内容 (x/v3/fav/resource/list, 需登录)
 * @returns {Promise<{items:Array, hasMore:boolean}>}
 */
export async function getFavList(mediaId, pn) {
  if (!auth.hasCookie()) throw new Error('未登录')
  const url = 'https://api.bilibili.com/x/v3/fav/resource/list?media_id='
    + encodeURIComponent(mediaId) + '&pn=' + (pn || 1) + '&ps=20&keyword=&order=mtime&type=0&tid=0'
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('收藏列表接口错误 code=' + body.code))
  }
  const list = body.data.medias || []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m) continue
    if (m.title === '已失效视频') continue
    items.push({
      bvid: m.bvid || '',
      aid: m.id || 0,
      title: stripTags(m.title || ''),
      author: m.upper ? (m.upper.name || '') : '',
      playText: formatPlay(m.cnt_info && m.cnt_info.play),
      duration: m.duration ? formatDuration(m.duration) : '',
      pic: thumb(m.cover || '', 400, 250)
    })
  }
  // has_more: data.has_more (1=还有) + total 对比兜底
  const total = body.data.info ? (body.data.info.total || 0) : 0
  return { items: items, hasMore: hasMoreOf(body.data.has_more) && items.length > 0 }
}

/**
 * 稍后再看 (x/v2/history/toview/web, 需登录)
 * @returns {Promise<{items:Array, count:number}>}
 */
export async function getToViewList(pn) {
  if (!auth.hasCookie()) throw new Error('未登录')
  const url = 'https://api.bilibili.com/x/v2/history/toview/web?pn=' + (pn || 1) + '&ps=20'
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('稍后再看接口错误 code=' + body.code))
  }
  const list = body.data.list || []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    if (!t) continue
    items.push({
      bvid: t.bvid || '',
      aid: t.aid || 0,
      title: stripTags(t.title || ''),
      author: t.owner ? (t.owner.name || '') : '',
      playText: '',
      duration: t.duration ? formatDuration(t.duration) : '',
      pic: thumb(t.pic || '', 400, 250),
      pubText: formatDate(t.add_at) ? '加于 ' + formatDate(t.add_at) : ''
    })
  }
  return { items: items, count: body.data.count || 0 }
}

/**
 * 稿件交互状态 (赞/币/藏).
 * 背景: view 接口的 req_user 对本应用请求恒为空对象 (真机实测, 带 buvid3 也一样),
 * 改用三个专用状态接口: has/like / archive/coins / fav/video/favoured (旧注释里的 list-all(rid).favoured 是错的, 见 getFavFolders 注释).
 * 各接口失败静默 (对应按钮退化为未操作态, 不阻塞详情页).
 * @returns {Promise<{like:boolean, coin:boolean, coinCount:number, fav:boolean}>}
 */
export async function getInteractState(aid) {
  const out = { like: false, coin: false, coinCount: 0, fav: false }
  if (!auth.hasCookie() || !aid) return out
  try {
    const b = await getJsonAsync('https://api.bilibili.com/x/web-interface/archive/has/like?aid='
      + encodeURIComponent(aid), 10)
    out.like = Number(b && b.data) === 1
  } catch (e) {
    console.log('[bili] has/like 查询失败: ' + (e && e.message ? e.message : e))
  }
  try {
    const b2 = await getJsonAsync('https://api.bilibili.com/x/web-interface/archive/coins?aid='
      + encodeURIComponent(aid), 10)
    out.coinCount = (b2 && b2.data && Number(b2.data.multiply)) || 0
    out.coin = out.coinCount > 0
  } catch (e) {
    console.log('[bili] coins 查询失败: ' + (e && e.message ? e.message : e))
  }
  // 收藏状态: 先用轻量专用接口 (一次请求就给 true/false),
  // 失败再退化成扫收藏夹的 fav_state (list-all 传 rid)
  try {
    const b3 = await getJsonAsync('https://api.bilibili.com/x/v2/fav/video/favoured?aid='
      + encodeURIComponent(aid), 10)
    if (b3 && b3.code === 0 && b3.data && typeof b3.data.favoured === 'boolean') {
      out.fav = b3.data.favoured
    } else {
      throw new Error('favoured 接口 code=' + (b3 && b3.code))
    }
  } catch (e) {
    console.log('[bili] fav/video/favoured 失败, 退化扫收藏夹: ' + (e && e.message ? e.message : e))
    try {
      const folders = await getFavFolders(aid)
      for (let i = 0; i < folders.length; i++) {
        if (folders[i].favoured) { out.fav = true; break }
      }
    } catch (e2) {
      console.log('[bili] 收藏状态查询失败: ' + (e2 && e2.message ? e2.message : e2))
    }
  }
  return out
}

// ================= 登录 (二维码 + Cookie) / 我的 / 动态 / 评论 =================

/**
 * 生成登录二维码. 返回 {qrcodeKey, qrUrl}:
 *   qrcodeKey 用于轮询, qrUrl 需编码为二维码供 B 站 App 扫描.
 */
export async function qrcodeGenerate() {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const body = await getJsonAsync('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', 10)
  if (body.code !== 0 || !body.data || !body.data.qrcode_key) {
    throw new Error(body.message || ('二维码接口错误 code=' + body.code))
  }
  return { qrcodeKey: body.data.qrcode_key, qrUrl: body.data.url }
}

/**
 * 轮询二维码状态. 返回:
 *   {state: 'waiting'|'scanned'|'expired'|'ok', cookies?: {sessdata,biliJct,dedeUserId}}
 * 成功时 cookie 参数直接在响应体 redirect url 中 (无需解析 Set-Cookie 头).
 */
export async function qrcodePoll(qrcodeKey) {
  const body = await getJsonAsync('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key='
    + encodeURIComponent(qrcodeKey), 10)
  if (body.code !== 0 || !body.data) {
    throw new Error(body.message || ('轮询接口错误 code=' + body.code))
  }
  const c = body.data.code
  if (c === 0) {
    const url = body.data.url || ''
    const cookies = parseLoginUrlParams(url)
    if (!cookies || !cookies.sessdata) throw new Error('登录成功但未取到 Cookie')
    return { state: 'ok', cookies: cookies }
  }
  if (c === 86090) return { state: 'scanned' }
  if (c === 86038) return { state: 'expired' }
  return { state: 'waiting' }  // 86039 未扫描
}

// 从跨域跳转 url 的 query 里解析登录 Cookie 参数
function parseLoginUrlParams(url) {
  if (!url) return null
  const out = { sessdata: '', biliJct: '', dedeUserId: '' }
  const qs = url.indexOf('?') >= 0 ? url.substring(url.indexOf('?') + 1) : ''
  const pairs = qs.split('&')
  for (let i = 0; i < pairs.length; i++) {
    const eq = pairs[i].indexOf('=')
    if (eq <= 0) continue
    const k = pairs[i].substring(0, eq)
    let v = pairs[i].substring(eq + 1)
    try { v = decodeURIComponent(v) } catch (e) {}
    if (k === 'SESSDATA') out.sessdata = v
    else if (k === 'bili_jct') out.biliJct = v
    else if (k === 'DedeUserID') out.dedeUserId = v
  }
  return out.sessdata ? out : null
}

/**
 * 我的账号信息 (x/web-interface/nav, 带 Cookie; 匿名返回 isLogin=false)
 */
export async function getMyInfo() {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const body = await getJsonAsync('https://api.bilibili.com/x/web-interface/nav', 10)
  if (!body || !body.data) throw new Error('nav 接口错误')
  const d = body.data
  let face = d.face || ''
  if (face.indexOf('//') === 0) face = 'https:' + face
  // 设备 image 组件不支持 webp, 借 B 站图片服务转成 jpg.
  // 注意: 必须保留原扩展名再加参数, 写成 xxx@144w.jpg 会 404.
  if (face && face.indexOf('@') < 0) face = face + '@144w_144h_1c.jpg'
  // nav 返回的是 level_info (下划线), 不是 levelInfo —— 之前写错导致等级恒为 0
  const li = d.level_info || d.levelInfo || {}
  const wallet = d.wallet || {}
  return {
    isLogin: d.isLogin === true,
    uname: d.uname || '',
    face: face,
    mid: d.mid || 0,
    level: li.current_level || 0,
    // 实测: nav 的 data.money 是「硬币」(如 1652.1), wallet.bcoin_balance 才是「B币」
    coin: typeof d.money === 'number' ? Math.floor(d.money) : 0,
    money: typeof wallet.bcoin_balance === 'number' ? wallet.bcoin_balance : 0,
    vip: (d.vip && d.vip.status === 1) ? '大会员' : ''
  }
}

/**
 * 动态视频流 (x/polymer/web-dynamic/v1/feed/all, 需登录 Cookie)
 * @param {string} offset 分页游标 (首次传 '')
 * @returns {Promise<{items:Array, offset:string, hasMore:boolean}>}
 */
// 动态首屏缓存 TTL: B 站这个接口一次要 1s+, 缓存一下让二次进入秒开
const DYN_TTL = 60000

// 浏览器端 feed/all 真实请求里带的一长串 features (抓包照搬, 一字不改):
// 服务端按它切换「动态卡片协议版本」—— 不带就是老结构, 图文/专栏的正文根本不下发.
const DYN_FEATURES = 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard,commentsNewVersion,avatarAutoTheme,sunflowerStyle,cardsEnhance,eva3CardOpus,eva3CardVideo,eva3CardComment,eva3CardVote,eva3CardUser'

// 专栏/图文全文接口 (x/polymer/web-dynamic/v1/opus/detail) 的 features:
// 照搬 docs/opus/detail.md 那一串 —— 其中 htmlNewStyle 决定「旧版专栏」是否只回 fallback 空壳.
const OPUS_FEATURES = 'onlyfansVote,onlyfansAssetsV2,decorationCard,htmlNewStyle,ugcDelete,editable,opusPrivateVisible,tribeeEdit,avatarAutoTheme,avatarTypeOpus'

export async function getDynamicFeed(offset, type, fresh) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  if (!auth.hasCookie()) throw new Error('未登录')
  // type 是文档参数 (references/bilibili-api-collect-mirror/docs/dynamic/all.md):
  //   all(默认) / video(投稿) / pgc(追番) / article(专栏)
  // 客户端过滤做不到「这个分类首页一条都没有时继续往后翻」, 所以专栏/投稿走服务端 type.
  const t = type || 'all'
  const key = 'dyn2:' + t + ':' + (offset || '')   // v2: 带 features 后字段结构变了, 旧缓存不复用
  if (!fresh) {
    const hit = cacheGet(key, DYN_TTL)
    if (hit) { log('动态', '命中缓存 type=' + t + ' 条数=' + ((hit.items || []).length)); return hit }
  }
  // features 决定服务端下发的字段结构 (浏览器抓包实证):
  //   不带 features -> 图文动态 major.type=MAJOR_TYPE_DRAW, 图在 major.draw.items, 正文不存在 (desc=null)
  //   带   features -> 图文动态 major.type=MAJOR_TYPE_OPUS, 正文在 major.opus.summary, 图在 major.opus.pics
  //   专栏 type=article 同理: 旧结构走 major.article, 带上 features 后走 major.opus
  // 这就是「动态卡片只出图不出字」的根因: 设备端一直没带 features.
  const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?timezone_offset=-480&platform=web&page=1&type=' + encodeURIComponent(t)
    + '&features=' + DYN_FEATURES
    + (offset ? '&offset=' + encodeURIComponent(offset) : '')
  const body = await getJsonAsync(url, 15)
  if (body.code === -101) throw new Error('未登录或登录已过期')
  if (body.code !== 0 || !body.data) {
    throw new Error(body.message || ('动态接口错误 code=' + body.code))
  }
  const list = body.data.items || []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const full = mapDynamicItem(list[i])
    if (full) items.push(full)
  }
  // 封面诊断: 0.8.6 动态封面不显示过一次, 留下实际下发的 URL 便于设备上 curl 验证
  if (items.length > 0) log('动态', '首条封面 ' + items[0].pic)
  // 九宫格缩略图打点: 真机上确认列表下的是 @200w_200h_1c 这类缩略图而不是原图
  // (「照片加载慢」的根因就是原图直连, 原图实测有 6336px 宽的)
  if (items.length > 0 && items[0].pics && items[0].pics.length > 0) {
    log('动态', '首条图 ' + items[0].pics[0].src)
  }
  const out = {
    items: items,
    offset: body.data.offset || '',
    hasMore: hasMoreOf(body.data.has_more)
  }
  cacheSet(key, out)
  return out
}

// ===================== 动态详情 / 专栏全文 (0.9.59) =====================
// 用户反馈「希望可以点击打开动态页面」「希望可以进入专栏」:
//   1) 列表卡片里的字只是摘要 —— 实测专栏 summary.text 211 字且 has_more=true,
//      全文只在 opus/detail 里 (实测 22 段结构化正文)
//   2) detail 返回的 data.item 与 feed/all 的 item 同构 -> 直接复用 mapDynamicItem, 不写第二套映射
//   3) opus/detail 的 item.modules 是「数组」(feed 里是对象), 段落结构见 docs/opus/features.md
export async function getDynamicDetail(id) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const did = String(id == null ? '' : id)
  if (!did) throw new Error('缺少动态 ID')
  const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=' + encodeURIComponent(did)
    + '&timezone_offset=-480&platform=web&features=' + DYN_FEATURES
  const body = await getJsonAsync(url, 15)
  if (body.code === -101) throw new Error('未登录或登录已过期')
  if (body.code !== 0 || !body.data || !body.data.item) {
    throw new Error(body.message || ('动态详情接口错误 code=' + body.code))
  }
  const item = mapDynamicItem(body.data.item)
  if (!item) throw new Error('这条动态没有可显示的内容')
  return item
}

// 专栏 / 图文全文 -> { id, title, author:{name,face,pubText}, blocks[], stat }
// blocks 的 k: text / quote / pic / list / code / line / card (页面按 k 渲染)
export async function getOpusDetail(id) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const did = String(id == null ? '' : id)
  if (!did) throw new Error('缺少动态 ID')
  const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail?id=' + encodeURIComponent(did)
    + '&timezone_offset=-480&features=' + OPUS_FEATURES
  const body = await getJsonAsync(url, 15)
  // 旧版专栏 / 非图文动态: code=0 但没有 item (只回 {fallback:{...}} 空壳) -> 交给调用方走动态详情兜底
  if (body.code === 0 && (!body.data || !body.data.item)) return null
  if (body.code === -352) throw new Error('专栏被风控拦截，稍后再试')
  if (body.code !== 0 || !body.data || !body.data.item) {
    throw new Error(body.message || ('专栏接口错误 code=' + body.code))
  }
  const item = body.data.item
  const mods = item.modules
  const list = (mods && typeof mods.length === 'number') ? mods : []
  let title = ''
  let author = null
  let paras = null
  let stat = null
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {}
    if (title === '' && m.module_title) title = String(m.module_title.text || '')
    if (!author && m.module_author) {
      const a = m.module_author
      author = {
        name: String(a.name || ''),
        face: a.face ? thumb(dynHttps(a.face), 80, 80) : '',
        pubText: String(a.pub_time || '')
      }
    }
    if (!paras && m.module_content) paras = m.module_content.paragraphs || []
    if (!stat && m.module_stat) {
      const s = m.module_stat
      stat = {
        like: (s.like && s.like.count) || 0,
        reply: (s.comment && s.comment.count) || 0,
        forward: (s.forward && s.forward.count) || 0
      }
    }
  }
  const blocks = mapOpusBlocks(paras)
  if (title === '' && blocks.length === 0) return null
  log('专栏', '全文 id=' + did + ' 块=' + blocks.length + ' 标题=' + (title === '' ? '无' : title.length + '字'))
  return { id: did, title: title, author: author, blocks: blocks, stat: stat }
}

/**
 * 动态点赞 (docs/dynamic/action.md, 需登录 + csrf)
 * 实测: 新接口 x/dynamic/feed/dyn/thumb 只吃 JSON 体 (表单体回 4100001 参数错误),
 * 而旧接口 dynamic_like 吃 application/x-www-form-urlencoded -> 与设备端 postJsonAsync 兼容, 客户端走这条.
 * @param {string} dynId 动态 id (id_str)
 * @param {boolean} want true=点赞 false=取消
 */
export async function likeDynamic(dynId, want) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const csrf = needCsrf()
  const id = String(dynId == null ? '' : dynId)
  if (!id) throw new Error('缺少动态 ID')
  const data = 'dynamic_id=' + encodeURIComponent(id)
    + '&up=' + (want === false ? 2 : 1) + '&csrf=' + encodeURIComponent(csrf)
  const body = await postJsonAsync('https://api.vc.bilibili.com/dynamic_like/v1/dynamic_like/thumb', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -111) throw new Error('csrf 校验失败, 请重新登录')
    throw new Error(body.message || ('点赞失败 code=' + body.code))
  }
  return true
}

// ===================== 关系链 / 关注分组 (0.9.61) =====================
// 特别关注 = 分组 id -10: x/relation/tags 的返回里就有这一条 (docs/user/relation.md §2056),
// 所以「加入特别关注」不是独立接口, 而是「把人加进 -10 分组」
export const TAG_SPECIAL = -10
export const TAG_DEFAULT = 0
// 「全部」的哨兵值: 必须与真实 tagid 区分开 —— 真实值只有 -10(特别关注) / 0(默认分组) / 正整数,
// 所以取 -999. (0.9.61 踩过: 把 0 当「全部」的标记, 结果「全部」和「默认分组」绑成了一个 tab)
export const TAG_ALL = -999

/**
 * 关注列表的分组筛选判定 (单一口径, 页面只调用它):
 *   -999 全部 / -10 特别关注 / 0 默认分组(= 没归入任何自定义分组的关注) / 正整数 某个自定义分组
 */
export function inTagGroup(u, tagid) {
  const tags = (u && u.tags) ? u.tags : []
  const t = Number(tagid)
  if (t === TAG_ALL) return true
  if (t === TAG_SPECIAL) return !!(u && u.special) || tags.indexOf(TAG_SPECIAL) >= 0
  if (t === TAG_DEFAULT) return tags.length === 0 || tags.indexOf(TAG_DEFAULT) >= 0
  return tags.indexOf(t) >= 0
}

// 用户认证类型一览 —— 原表照抄 docs/user/official_role.md, 不自己造规则:
//   ID | 认证类型 | 详细类型
//   0  | 无       |
//   1  | 个人认证 | 知名UP主
//   2  | 个人认证 | 大V达人
//   3  | 机构认证 | 企业
//   4  | 机构认证 | 组织
//   5  | 机构认证 | 媒体
//   6  | 机构认证 | 政府
//   7  | 个人认证 | 高能主播
//   9  | 个人认证 | 社会知名人士
// 徽章分色按表中的「认证类型」: 个人认证 = 黄标(#ffac2c) / 机构认证 = 蓝标(#3ca5ec)
export const OFFICIAL_ROLES = {
  0: { official: 'none', kind: '', label: '' },
  1: { official: '个人认证', kind: 'per', label: '知名UP主' },
  2: { official: '个人认证', kind: 'per', label: '大V达人' },
  3: { official: '机构认证', kind: 'org', label: '企业' },
  4: { official: '机构认证', kind: 'org', label: '组织' },
  5: { official: '机构认证', kind: 'org', label: '媒体' },
  6: { official: '机构认证', kind: 'org', label: '政府' },
  7: { official: '个人认证', kind: 'per', label: '高能主播' },
  9: { official: '个人认证', kind: 'per', label: '社会知名人士' }
}

/** 徽章底色类别: 'per' 黄 / 'org' 蓝 / '' 不显示 (查官方表, 表外 ID 按 type 回落) */
export function badgeKind(type, role) {
  const row = OFFICIAL_ROLES[Number(role)]
  if (row) return row.kind
  // 动态流只有 official_verify.type: -1 无 / 0 UP主认证(个人) / 1 机构认证
  const t = Number(type)
  if (t === 1) return 'org'
  if (t === 0) return 'per'
  return ''
}

/**
 * 认证行文案: 接口给的 desc 优先 (例「bilibili 知名UP主」), 没有就用官方表的详细类型,
 * 前缀按表中的「认证类型」拼 (bilibili个人认证：/ bilibili机构认证：)
 */
export function badgeLabel(type, role, desc) {
  const row = OFFICIAL_ROLES[Number(role)]
  const text = String(desc || '') || (row ? row.label : '')
  if (!text) return ''
  const t = Number(type)
  const kind = row ? row.kind : (t === 1 ? 'org' : (t === 0 ? 'per' : ''))
  if (kind === '') return ''
  return (kind === 'org' ? 'bilibili机构认证：' : 'bilibili个人认证：') + text
}

// 认证 + 头像框: 动态流的 module_author 与空间的 acc/info / card 语义一致, 统一在这里归一
function badgeOf(ma) {
  const ov = ma && ma.official_verify ? ma.official_verify : null
  let ot = -1
  if (ov && typeof ov.type === 'number') ot = ov.type
  const pd = ma && ma.pendant ? ma.pendant : null
  // 头像框是**带透明通道的 PNG**, 绝不能套 thumb() 的 @Ww_Hh_1c.jpg (会转成 JPG, 透明底变黑)
  const raw = (pd && Number(pd.pid) > 0) ? dynHttps(pd.image_enhance || pd.image || '') : ''
  const role = (ov && typeof ov.role === 'number') ? ov.role : -1
  return { officialType: ot, officialRole: role, officialDesc: (ov && ov.desc) || '', pendant: raw }
}

/**
 * 与某用户的关系 (x/relation?fid=; 免 csrf)
 * attribute: 0 未关注 / 2 已关注 / 6 互粉 / 128 拉黑
 */
export async function getRelation(mid) {
  const url = 'https://api.bilibili.com/x/relation?fid=' + encodeURIComponent(mid)
  const body = await getJsonAsync(url, 10)
  if (body.code !== 0) throw new Error(body.message || ('关系接口错误 code=' + body.code))
  const d = body.data || {}
  const tags = []
  const arr = d.tag || []
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i]
    tags.push(typeof t === 'number' ? t : Number((t && t.tagid) || 0))
  }
  const attr = Number(d.attribute || 0)
  return {
    attribute: attr,
    special: Number(d.special || 0) === 1 || tags.indexOf(TAG_SPECIAL) >= 0,
    tags: tags,
    following: attr === 2 || attr === 6
  }
}

/** 关注 (act=1) / 取关 (act=2) —— x/relation/modify, 表单体 + csrf */
export async function modifyRelation(mid, act) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const body = await postJsonAsync('https://api.bilibili.com/x/relation/modify', {
    fid: String(mid), act: Number(act) || 1, re_src: 11, csrf: needCsrf()
  }, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -111) throw new Error('csrf 校验失败, 请重新登录')
    if (body.code === 22001) throw new Error('不能关注自己')
    if (body.code === 22002) throw new Error('对方隐私设置, 无法关注')
    throw new Error(body.message || ('操作失败 code=' + body.code))
  }
  return true
}

/** 关注分组列表 (x/relation/tags; 返回含 -10 特别关注 / 0 默认分组) */
export async function getRelationTags() {
  const body = await getJsonAsync('https://api.bilibili.com/x/relation/tags', 10)
  if (body.code !== 0) throw new Error(body.message || ('分组接口错误 code=' + body.code))
  const out = []
  const arr = body.data || []
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i] || {}
    out.push({ tagid: Number(t.tagid) || 0, name: String(t.name || ''), count: Number(t.count) || 0 })
  }
  return out
}

/** 设置分组: 把一个人从 before 分组集合移动到 after 集合 (x/relation/tags/moveUsers) */
export async function setUserTags(mid, beforeTagids, afterTagids) {
  const before = (beforeTagids && beforeTagids.length) ? beforeTagids.join(',') : String(TAG_DEFAULT)
  const after = (afterTagids && afterTagids.length) ? afterTagids.join(',') : String(TAG_DEFAULT)
  const body = await postJsonAsync('https://api.bilibili.com/x/relation/tags/moveUsers', {
    beforeTagids: before, afterTagids: after, fids: String(mid), csrf: needCsrf()
  }, 15)
  if (body.code !== 0) {
    if (body.code === 22105) throw new Error('还没关注这个人')
    if (body.code === 22104) throw new Error('分组不存在')
    throw new Error(body.message || ('设置分组失败 code=' + body.code))
  }
  return true
}

/** 加入某个分组 (x/relation/tags/addUsers) —— 特别关注(-10) 走这里 */
export async function addUserTag(mid, tagids) {
  const ids = (tagids && tagids.length) ? tagids.join(',') : String(TAG_SPECIAL)
  const body = await postJsonAsync('https://api.bilibili.com/x/relation/tags/addUsers', {
    fids: String(mid), tagids: ids, csrf: needCsrf()
  }, 15)
  if (body.code !== 0) throw new Error(body.message || ('加入分组失败 code=' + body.code))
  return true
}

/** 我的关注列表 (x/relation/followings; 需登录 + referer 为 bilibili 子域) */
export async function getFollowings(vmid, pn, ps) {
  const url = 'https://api.bilibili.com/x/relation/followings?vmid=' + encodeURIComponent(vmid)
    + '&pn=' + (Number(pn) || 1) + '&ps=' + (Number(ps) || 20)
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -352) throw new Error('接口风控, 稍后再试')
    throw new Error(body.message || ('关注列表接口错误 code=' + body.code))
  }
  const d = body.data || {}
  const list = []
  const arr = d.list || []
  for (let i = 0; i < arr.length; i++) {
    const u = arr[i] || {}
    let face = dynHttps(u.face || '')
    const tags = []
    const ta = u.tag || []
    for (let j = 0; j < ta.length; j++) tags.push(Number(ta[j]) || 0)
    const b = badgeOf({ official_verify: u.official_verify })
    list.push({
      mid: Number(u.mid) || 0,
      name: String(u.uname || ''),
      sign: String(u.sign || ''),
      face: face ? thumb(face, 80, 80) : '',
      officialType: b.officialType,
      officialDesc: b.officialDesc,
      special: Number(u.special || 0) === 1 || tags.indexOf(TAG_SPECIAL) >= 0,
      tags: tags
    })
  }
  return { list: list, total: Number(d.total) || 0 }
}

/**
 * 按分组取关注列表 (x/relation/tag) —— 服务端筛选.
 * 为什么必须用这个接口: x/relation/followings **不吃 tagid 参数**, 真机 A/B 实测
 * 21 个分组逐个请求, 返回全是同一份 total=417 / 本页 20 条, 与不带 tagid 完全一样.
 * 结果就是页面上「美食 7」点进去只有 2 个人 —— 因为客户端只能在**已加载的 20 条**里筛.
 * tagid 约定: -20 所有 / -10 特别关注 / 0 默认分组 / 正整数 自定义分组.
 * 注意: 这个接口的 data **直接是数组** (不是 {list,total}), 也没有 total 字段.
 */
export async function getTagFollowings(vmid, tagid, pn, ps) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const t = Number(tagid)
  const url = 'https://api.bilibili.com/x/relation/tag?tagid=' + (isFinite(t) ? t : -20)
    + '&pn=' + (Number(pn) || 1) + '&ps=' + (Number(ps) || 20)
    + '&mid=' + encodeURIComponent(vmid)
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -352) throw new Error('接口风控, 稍后再试')
    throw new Error(body.message || ('分组关注接口错误 code=' + body.code))
  }
  const arr = Array.isArray(body.data) ? body.data : ((body.data && body.data.list) || [])
  const list = []
  for (let i = 0; i < arr.length; i++) {
    const u = arr[i] || {}
    const face = dynHttps(u.face || '')
    const tags = []
    const ta = u.tag || []      // 该接口里 tag 常为 null
    for (let j = 0; j < ta.length; j++) tags.push(Number(ta[j]) || 0)
    const b = badgeOf({ official_verify: u.official_verify })
    list.push({
      mid: Number(u.mid) || 0,
      name: String(u.uname || ''),
      sign: String(u.sign || ''),
      face: face ? thumb(face, 80, 80) : '',
      officialType: b.officialType,
      officialDesc: b.officialDesc,
      special: Number(u.special || 0) === 1 || tags.indexOf(TAG_SPECIAL) >= 0,
      tags: tags
    })
  }
  return list
}

/** UP 空间动态 (x/polymer/web-dynamic/v1/feed/space; item 结构与动态流同构) */
export async function getDynamicSpace(mid, offset, fresh) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const m = String(mid == null ? '' : mid)
  if (!m) throw new Error('缺少 UP 主 UID')
  const key = 'dynspace:' + m + ':' + (offset || '')
  if (!fresh) {
    const hit = cacheGet(key, DYN_TTL)
    if (hit) { log('UP动态', '命中缓存 mid=' + m + ' 条数=' + ((hit.items || []).length)); return hit }
  }
  const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=' + encodeURIComponent(m)
    + '&timezone_offset=-480&platform=web&features=' + DYN_FEATURES
    + (offset ? '&offset=' + encodeURIComponent(offset) : '')
  const body = await getJsonAsync(url, 15)
  if (body.code === -101) throw new Error('未登录或登录已过期')
  if (body.code !== 0 || !body.data) {
    if (body.code === -352) throw new Error('接口风控, 稍后再试')
    throw new Error(body.message || ('空间动态接口错误 code=' + body.code))
  }
  const list = body.data.items || []
  const items = []
  for (let i = 0; i < list.length; i++) {
    const full = mapDynamicItem(list[i])
    if (full) items.push(full)
  }
  const out = { items: items, offset: body.data.offset || '', hasMore: hasMoreOf(body.data.has_more) }
  log('UP动态', 'mid=' + m + ' 条数=' + items.length + ' hasMore=' + out.hasMore)
  cacheSet(key, out)
  return out
}

// ===================== 动态流全类型映射 (0.9.54) =====================
// 动态形态比视频复杂: 投稿(archive) / 图文(draw, 九宫格) / 纯文字(word) / 专栏(opus) / 转发(forward) / 直播(live_rcmd)
// 正文必须按 desc.rich_text_nodes 保序渲染 —— 节点的 emoji.size (1=小 2=大) 决定字号,
// 直接拼字符串会同时丢掉表情图片和字号大小, 这就是之前「文字大小/位置不对」的根因.
// has_more 兼容: 文档写的是 bool (true/false), 个别接口给 1/0.
// 0.9.58 之前只判 === 1 -> 动态页(首页动态 tab + 独立动态页)永远拿不到下一页
function hasMoreOf(v) { return v === 1 || v === true || v === '1' }

function dynHttps(u) {
  const s = String(u == null ? '' : u)
  if (s.indexOf('//') === 0) return 'https:' + s
  return s.replace(/^http:\/\//i, 'https://')
}
// 富文本节点 -> 渲染段: t0 文本 / t1 表情图片 / t2 高亮文本(话题·@·链接)
function mapRichNodes(nodes) {
  const segs = []
  const arr = nodes || []
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i]
    if (!n) continue
    const ty = String(n.type || '')
    const txt = n.text == null ? '' : String(n.text)
    if (ty === 'RICH_TEXT_NODE_TYPE_EMOJI' && n.emoji) {
      const em = n.emoji
      const u = dynHttps(em.icon_url || em.webp_url || em.gif_url || '')
      if (u) {
        const sz = em.size === 2 ? 30 : 20
        segs.push({ t: 1, v: u, w: sz, h: sz })
      } else if (txt) {
        segs.push({ t: 0, v: txt })
      }
    } else if (ty === '' || ty === 'RICH_TEXT_NODE_TYPE_TEXT') {
      // 正文里的 unicode emoji (✨🐉⭐) 设备字体渲染不出, 直接当文本就是豆腐块.
      // 复用评论/标题同一条通道 scanEmoji: emoji 切成 twemoji CDN 图片段, 其余保持文本.
      // 列表页按既有决策不内置 PNG (require 只能写在 .vue 里, 不值得每个列表页复制 74 行).
      if (txt) scanEmoji(txt, segs, null)
    } else if (txt) {
      segs.push({ t: 2, v: txt, rid: String(n.rid || ''), url: n.jump_url || '' })
    }
  }
  return segs
}

// opus 段落里的文本节点 -> 渲染段 (与动态正文同一套 t:0/1/2 语义)
// 实测 (opus/detail): TEXT_NODE_TYPE_WORD -> word.words;
//   TEXT_NODE_TYPE_RICH -> rich.text + rich.type (EMOJI 带 rich.emoji.icon_url);
//   TEXT_NODE_TYPE_FORMULA -> formula.latex_content
function opusNodeSegs(nodes) {
  const segs = []
  const arr = nodes || []
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i]
    if (!n) continue
    const ty = String(n.type || '')
    if (ty === 'TEXT_NODE_TYPE_WORD' && n.word) {
      scanEmoji(String(n.word.words || ''), segs, null)
    } else if (ty === 'TEXT_NODE_TYPE_RICH' && n.rich) {
      const r = n.rich
      const rt = String(r.type || '')
      const u = (rt === 'RICH_TEXT_NODE_TYPE_EMOJI' && r.emoji)
        ? dynHttps(r.emoji.icon_url || r.emoji.webp_url || r.emoji.gif_url || '') : ''
      if (u) {
        segs.push({ t: 1, v: u, w: 30, h: 30 })
      } else if (rt === 'RICH_TEXT_NODE_TYPE_TEXT' || rt === '') {
        scanEmoji(String(r.text || r.orig_text || ''), segs, null)
      } else {
        const txt = String(r.text || r.orig_text || '')
        if (txt) segs.push({ t: 2, v: txt, rid: String(r.rid || ''), url: r.jump_url || '' })
      }
    } else if (ty === 'TEXT_NODE_TYPE_FORMULA' && n.formula) {
      const f = String(n.formula.latex_content || '')
      if (f) segs.push({ t: 0, v: f })
    }
  }
  return segs
}

// 专栏正文: 段落数组 -> 渲染块. para_type (docs/opus/features.md):
//   1 文本 / 2 图片 / 3 分割线 / 4 块引用 / 5 列表 / 6 链接卡片 / 7 代码
// 图按原始比例缩: 内容宽 880, 图最多 720 宽 / 700 高 (设备屏只有 266 高, 巨图必须收, 点开可看原图)
// 阅读页现在是「左内容 + 右评论」两栏: 左栏内容宽 546 -> 图最多 540 宽
const OPUS_IMG_W = 540
const OPUS_IMG_MAX_H = 640
function mapOpusBlocks(paragraphs) {
  const out = []
  const arr = paragraphs || []
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i]
    if (!p) continue
    const ty = Number(p.para_type || 0)
    if (ty === 1 || ty === 4) {
      const segs = opusNodeSegs(p.text && p.text.nodes)
      if (segs.length) out.push({ k: ty === 4 ? 'quote' : 'text', segs: segs })
    } else if (ty === 2) {
      // 文档写 paragraphs[].pics, 实测响应是 paragraphs[].pic (再往里 .pics[] 才是数组) -> 两种都认
      const box = p.pic || p.pics || {}
      const list = box.pics || (box.url ? [box] : [])
      for (let j = 0; j < list.length; j++) {
        const q = list[j] || {}
        const raw = dynHttps(q.url || '')
        if (!raw) continue
        const w0 = Number(q.width) || 0
        const h0 = Number(q.height) || 0
        let w = OPUS_IMG_W
        let h = 480
        if (w0 > 0 && h0 > 0) {
          w = w0 < OPUS_IMG_W ? w0 : OPUS_IMG_W
          h = Math.round(h0 * w / w0)
          if (h > OPUS_IMG_MAX_H) { h = OPUS_IMG_MAX_H; w = Math.round(w0 * h / h0) }
        }
        out.push({ k: 'pic', src: thumbAspect(raw, w), full: raw, w: w, h: h })
      }
    } else if (ty === 3) {
      out.push({ k: 'line' })
    } else if (ty === 5) {
      const box = p.list || {}
      const items = box.items || []
      const rows = []
      for (let j = 0; j < items.length; j++) {
        const it = items[j] || {}
        const segs = opusNodeSegs(it.nodes)
        if (!segs.length) continue
        rows.push({ mark: box.style === 1 ? (String(it.order || (j + 1)) + '.') : '·', segs: segs })
      }
      if (rows.length) out.push({ k: 'list', rows: rows })
    } else if (ty === 7) {
      const c = p.code || {}
      const t = String(c.content == null ? (c.text || '') : c.content)
      if (t) out.push({ k: 'code', text: t })
    } else if (ty === 6) {
      const card = (p.link_card && p.link_card.card) || {}
      const common = card.common || {}
      const t = String(common.title || card.title || '')
      if (t) out.push({ k: 'card', title: t })
    }
  }
  return out
}
// 正文节点 -> { segs, text }: 兼容字符串与对象两种形态.
// 新版图文/专栏把正文放在 major.opus.summary = { text, rich_text_nodes } (对象),
// 旧版 module_dynamic.desc.text 是纯字符串 —— 只读 desc 就会出现「只渲染照片, 字没了」.
function textOf(node) {
  if (node == null) return { segs: [], text: '' }
  if (typeof node === 'string') return { segs: node ? [{ t: 0, v: node }] : [], text: node }
  if (typeof node === 'number') return { segs: [{ t: 0, v: String(node) }], text: String(node) }
  let segs = mapRichNodes(node.rich_text_nodes)
  const t = node.text == null ? '' : String(node.text)
  if (segs.length === 0 && t) segs = [{ t: 0, v: t }]
  return { segs: segs, text: t }
}
let dynDbg = 0
let dynDbg2 = 0

// 九宫格图: 统一输出正方形格子, 页面按 4 列切行.
// 演进: 0.9.58 按「3 列铺满卡片」算成 288px —— 用户反馈「照片小一点不要这么大」:
//   288px 比整块屏幕(266 高)还高, 一条 4 图动态就吃掉两屏. 现在改 4 列 × 200px
//   (4*200 + 3*6 间距 = 818 ≤ 896 卡片内容宽), 9 图动态从 3 行 882px 降到 3 行 618px.
// 列数必须与 GRID_CELL 一起从这里取 —— 0.9.59 踩过: 只把 GRID_CELL 从 288 改成 200,
// 页面上 chunk(pics, 3) 的列数还是硬编码 3, 结果 3 列 × 200px 只占 618px, 右边一大片空.
export const GRID_COLS = 4
const GRID_CELL = 200        // 4 列: (896 - 3*6) / 4 ≈ 219 为上限, 取 200 留右侧余量
const GRID_ONE_W = 300       // 单图动态: 一张中等图 (cover 裁切, 点开看原图)
const GRID_ONE_H = 200
function dynPics(list, cell) {
  const out = []
  const arr = list || []
  const cs = cell || GRID_CELL
  for (let i = 0; i < arr.length && i < 9; i++) {
    const p = arr[i]
    // 两种真实形态都见过: 对象 {src|url} (图文 draw.items / opus.pics) 与
    // 纯 URL 字符串 (专栏 major.article.covers) —— 只认对象会把专栏封面全丢掉
    const src = (typeof p === 'string') ? dynHttps(p) : dynHttps((p && (p.src || p.url)) || '')
    if (!src) continue
    // 「照片加载慢」的根因: 原来把**原图 URL** 直接给了 <image> —— 实测有的原图 6336px 宽,
    // 一条九宫格要下十几 MB. B 站图床支持 @<w>w_<h>h_1c.jpg 按需裁切,
    // 列表只下格子尺寸; 原图 URL 留在 full 里, 只有点开查看器才用.
    out.push({ src: thumb(src, cs, cs), w: cs, h: cs, full: src })
  }
  if (out.length === 1) {
    out[0].w = GRID_ONE_W
    out[0].h = GRID_ONE_H
    out[0].src = thumb(out[0].full, GRID_ONE_W, GRID_ONE_H)
  }
  return out
}
function dynArchive(arc) {
  if (!arc || !arc.bvid) return null
  return {
    bvid: arc.bvid,
    aid: arc.aid || 0,
    title: stripTags(arc.title),
    cover: arc.cover ? thumb(dynHttps(arc.cover), 240, 150) : '',
    playText: formatPlay((arc.stat || {}).play),
    duration: arc.duration_text || ''
  }
}
function dynKindOf(type) {
  if (type === 'DYNAMIC_TYPE_AV') return 'av'
  // 番剧: 分类栏现在有「番剧」(服务端 type=pgc), 类型要能被 filter 认出来
  if (type === 'DYNAMIC_TYPE_PGC' || type === 'DYNAMIC_TYPE_PGC_UNKNOWN') return 'pgc'
  if (type === 'DYNAMIC_TYPE_DRAW') return 'draw'
  if (type === 'DYNAMIC_TYPE_WORD') return 'word'
  if (type === 'DYNAMIC_TYPE_OPUS' || type === 'DYNAMIC_TYPE_ARTICLE') return 'opus'
  if (type === 'DYNAMIC_TYPE_FORWARD') return 'forward'
  if (type === 'DYNAMIC_TYPE_LIVE_RCMD' || type === 'DYNAMIC_TYPE_LIVE') return 'live'
  return 'other'
}
function mapDynamicItem(it) {
  if (!it) return null
  const modules = it.modules || {}
  const md = modules.module_dynamic || {}
  const ma = modules.module_author || {}
  const st = modules.module_stat || {}
  const abadge = badgeOf(ma)
  const major = md.major || {}
  const kind = dynKindOf(String(it.type || ''))
  const desc = md.desc || {}
  const draw = major.draw || {}
  const opus = major.opus || major.article || {}
  let segs = mapRichNodes(desc.rich_text_nodes)
  if (segs.length === 0 && desc.text) segs = [{ t: 0, v: String(desc.text) }]
  // 正文兜底链 (真机 raw 取证: 图文动态的 module_dynamic.desc 常为 null;
  // 专栏正文在 major.article.desc/title, 新版图文在 major.opus.summary/title):
  //   desc -> opus.summary -> opus.title -> article.desc -> article.title -> draw.text -> archive.desc
  const art = major.article || {}
  if (segs.length === 0) { const a = textOf(opus.summary); if (a.segs.length) segs = a.segs }
  if (segs.length === 0) { const b = textOf(opus.title); if (b.segs.length) segs = b.segs }
  if (segs.length === 0) { const c = textOf(art.desc); if (c.segs.length) segs = c.segs }
  if (segs.length === 0) { const d = textOf(art.title); if (d.segs.length) segs = d.segs }
  if (segs.length === 0) { const e = textOf(draw.text); if (e.segs.length) segs = e.segs }
  if (segs.length === 0) { const f = textOf(major.archive && major.archive.desc); if (f.segs.length) segs = f.segs }
  let pics = []
  if (draw.items && draw.items.length) pics = dynPics(draw.items)
  if (pics.length === 0 && opus.pics && opus.pics.length) pics = dynPics(opus.pics)
  if (pics.length === 0 && art.covers && art.covers.length) pics = dynPics(art.covers)
  if (pics.length === 0 && desc.pics && desc.pics.length) pics = dynPics(desc.pics)
  // 诊断 (保留 2 条, 便于现场核对正文/图片来源)
  if (dynDbg < 2) {
    dynDbg++
    try {
      log('动态', '结构#' + dynDbg + ' ' + kind + ' major=' + String(major.type || '')
        + ' desc=' + (desc ? 'obj' : 'null') + ' segs=' + segs.length + ' pics=' + pics.length)
    } catch (e0) {}
  }
  // 转发: 正文是转发语, 原动态在 it.orig
  let orig = null
  if (it.orig) {
    const omd = (it.orig.modules || {}).module_dynamic || {}
    const oma = (it.orig.modules || {}).module_author || {}
  const obadge = badgeOf(oma)
    const omajor = omd.major || {}
    const odesc = omd.desc || {}
    let osegs = mapRichNodes(odesc.rich_text_nodes)
    if (osegs.length === 0 && odesc.text) osegs = [{ t: 0, v: String(odesc.text) }]
    const odraw = omajor.draw || {}
    const oopus = omajor.opus || omajor.article || {}
    let opics = []
    if (odraw.items && odraw.items.length) opics = dynPics(odraw.items)
    if (opics.length === 0 && oopus.pics && oopus.pics.length) opics = dynPics(oopus.pics)
    orig = {
      author: oma.name || '',
      authorMid: oma.mid || 0,
      face: oma.face ? thumb(dynHttps(oma.face), 80, 80) : '',
      officialType: obadge.officialType,
      officialRole: obadge.officialRole,
      officialDesc: obadge.officialDesc,
      pendant: obadge.pendant,
      segs: osegs,
      pics: opics,
      archive: dynArchive(omajor.archive)
    }
  }
  const archive = dynArchive(major.archive)
  const txt = desc.text ? String(desc.text) : ''
  // 正文总长 (用于「展开全文」是否出现: 一个字也显示展开文案很蠢)
  let segAll = ''
  for (let i2 = 0; i2 < segs.length; i2++) { if (segs[i2].t === 0 || segs[i2].t === 2) segAll += String(segs[i2].v || '') }
  // 带 features 后 module_dynamic.desc 恒为 null (正文在 major.opus.summary):
  // 旧逻辑的 txt 只认 desc.text -> 图文卡片标题退化成「4图」, 正文一个字都不显示. 用正文段兜底.
  const bodyText = txt !== '' ? txt : segAll
  if (dynDbg2 < 4) {
    dynDbg2++
    try {
      log('动态', '正文#' + dynDbg2 + ' ' + kind + ' major=' + String(major.type || '')
        + ' len=' + segAll.length + ' segs=' + segs.length + ' pics=' + pics.length
        + ' desc=' + (desc.text ? 'text' : 'null'))
    } catch (e2) {}
  }
  const item = {
    id: String(it.id_str || ''),
    // kind 用于分类筛选; type/pic/title 保留旧字段, 首页「动态」tab 的旧渲染不用改
    kind: kind,
    type: kind === 'av' ? 'video' : (kind === 'draw' ? 'draw' : kind),
    author: ma.name || '',
    mid: ma.mid || 0,        // 作者 UID: 列表/详情点头像或昵称进 UP 主页
    face: ma.face ? thumb(dynHttps(ma.face), 80, 80) : '',
    // 认证徽章 + 头像框 (用户反馈: 要像官方 App 一样有头像框和认证图标)
    officialType: abadge.officialType,
    officialRole: abadge.officialRole,
    officialDesc: abadge.officialDesc,
    pendant: abadge.pendant,
    pubText: ma.pub_time || '',
    segs: segs,
    isLong: isLongMessage(segAll),   // 超 3 行才显示「展开全文」
    pics: pics,
    rows: [],
    archive: archive,
    opus: (opus.title || opus.summary || art.title) ? {
      title: stripTags(textOf(opus.title).text || textOf(art.title).text || ''),
      summary: stripTags(textOf(opus.summary).text || textOf(art.desc).text || ''),
      url: opus.jump_url || art.jump_url || ''
    } : null,
    orig: orig,
    stat: {
      like: (st.like && st.like.count) || 0,
      reply: (st.comment && st.comment.count) || 0,
      forward: (st.forward && st.forward.count) || 0,
      // 展示文案 (「1.2万」这类) 在映射层统一算好, 列表/详情共用同一套格式化
      likeText: formatPlay((st.like && st.like.count) || 0),
      replyText: formatPlay((st.comment && st.comment.count) || 0),
      forwardText: formatPlay((st.forward && st.forward.count) || 0),
      // 点赞按钮初始高亮: module_stat.like.status = 我是否已赞 (实测字段存在)
      liked: !!(st.like && st.like.status)
    },
    // 评论区坐标: type 用 basic.comment_type (11=动态 / 12=专栏),
    // oid 用 basic.comment_id_str (不是动态 id) —— 详情页拉评论全靠这两个值
    commentType: Number(it.basic && it.basic.comment_type) || 11,
    commentOid: String((it.basic && (it.basic.comment_id_str || it.basic.rid_str)) || ''),
    expanded: false,
    // 旧字段 (首页列表沿用)
    bvid: archive ? archive.bvid : '',
    aid: archive ? archive.aid : 0,
    // 标题兜底链: 视频用标题, 图文/专栏/纯文字用正文首段 (bodyText), 都没有才退化成「N图」
    title: archive ? archive.title : (bodyText !== '' ? stripTags(bodyText) : (kind === 'draw' ? (pics.length > 1 ? pics.length + '图' : '图文动态') : stripTags(bodyText))),
    playText: archive ? archive.playText : '',
    duration: archive ? archive.duration : (pics.length > 1 ? pics.length + '图' : ''),
    pic: archive ? archive.cover : (pics.length > 0 ? thumb(pics[0].full, 400, 400) : '')
  }
  // 纯直播推荐卡片等没有正文/图/视频 -> 直接跳过, 列表里不留空白块
  if (segs.length === 0 && pics.length === 0 && !archive && !orig && !item.opus) return null
  return item
}

// 估算文本占用行数 (CJK 全角算 1, 其余 0.55): 评论列宽 ~630px / 18px 字号 ≈ 35 字/行
function visualWidth(text) {
  const t = String(text == null ? '' : text)
  let w = 0
  for (let i = 0; i < t.length; i++) w += t.charCodeAt(i) > 0x2e80 ? 1 : 0.55
  return w
}
// 超过 3 行 -> 折叠时显示省略号
function isLongMessage(text) { return visualWidth(text) > 35 * 3 }

/**
 * 视频评论列表 (x/v2/reply, 匿名可读; type=1 视频评论区)
 * @param {number} aid 视频 aid
 * @param {number} pn 页码 (从 1 开始)
 * @param {object} builtinEmoji 内置 emoji 图片映射 (由页面层传入)
 * @param {string} sort 'hot'=热度(sort=2) / 'time'=最新(sort=0)
 * @returns {Promise<{total:number, replies:Array}>}
 */
// 评论图片: content.pictures[] -> { src, w, h } (按原图比例缩到 <=150px 高)
function mapReplyPics(content) {
  const pics = (content && content.pictures) || []
  const out = []
  for (let i = 0; i < pics.length && i < 6; i++) {
    const pic = pics[i]
    if (!pic) continue
    let src = pic.img_src || ''
    if (src.indexOf('//') === 0) src = 'https:' + src
    else if (src.indexOf('http://') === 0) src = 'https://' + src.slice(7)
    if (!src) continue
    const iw = Number(pic.img_width) || 0
    const ih = Number(pic.img_height) || 0
    let w = 120, h = 120
    if (iw > 0 && ih > 0) {
      const scale = Math.min(150 / ih, 200 / iw, 1)
      w = Math.max(40, Math.round(iw * scale))
      h = Math.max(40, Math.round(ih * scale))
    }
    out.push({ src: thumb(src, w, h), w: w, h: h })
  }
  return out
}

// 单条评论 -> 视图模型 (主评论/子回复共用)
function mapReply(r, upperMid, builtinEmoji, opts) {
  const member = r.member || {}
  const content = r.content || {}
  let face = member.avatar || ''
  if (face.indexOf('//') === 0) face = 'https:' + face
  const o = opts || {}
  return {
    rpid: r.rpid || 0,
    author: member.uname || '用户',
    isUp: upperMid > 0 && r.mid === upperMid,     // UP 主本人 -> 显示 UP主 标签
    pinned: !!o.pinned,                            // 置顶评论
    mid: r.mid || 0,
    liked: Number(r.action) === 1,
    replyTo: o.replyTo || '',
    face: thumb(face, 60, 60),
    message: stripTags(content.message),
    pics: mapReplyPics(content),                   // 评论图片 (最多 6 张)
    segs: parseMessage(content.message, content.emote, builtinEmoji),
    long: isLongMessage(stripTags(content.message)),
    likeText: formatPlay(r.like),
    timeText: formatRelative(r.ctime),
    replyCount: r.rcount || 0
  }
}

export async function getReplies(aid, pn, builtinEmoji, sort, fresh, type) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const sortParam = sort === 'time' ? 0 : 2
  // 评论区类型由来源决定: 1=视频(默认) / 11=动态 / 12=专栏 —— 用 basic.comment_type,
  // oid 必须是 basic.comment_id_str, 不是动态 id (实测 type=11 + 动态 id 回 -404)
  const oidType = Number(type) || 1
  const url = 'https://api.bilibili.com/x/v2/reply?type=' + oidType + '&oid=' + encodeURIComponent(aid)
    + '&pn=' + (pn || 1) + '&ps=20&sort=' + sortParam + '&jsonp=json'
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === 12009) throw new Error('评论区已关闭')
    throw new Error(body.message || ('评论接口错误 code=' + body.code))
  }
  const page = body.data.page || {}
  const list = body.data.replies || []
  // 首页缓存 3 分钟: 进详情预取 + 再进同一视频都走缓存, 秒开 (手动刷新传 fresh 绕过)
  const ckey = 'replies_' + oidType + '_' + aid + '_' + sortParam
  if ((pn || 1) === 1 && !fresh) {
    const c = cacheGet(ckey, 180000)
    if (c) return c
  }
  const upperMid = (body.data.upper && body.data.upper.mid) || 0
  const replies = []
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r) continue
    replies.push(mapReply(r, upperMid, builtinEmoji))
  }
  // UP 主置顶评论: 单独在 data.upper.top, 不在 replies 里 -> 插到最前面并打置顶标记
  // UP 主置顶: 必须真的排在第一条 (0.9.32) —— 如果接口把它也塞进了 replies,
  // 就把它从原位置摘出来再放最前, 而不是只在「不在列表里」时才插入.
  const topReply = body.data.upper && body.data.upper.top ? body.data.upper.top : null
  if (topReply && (pn || 1) === 1) {
    const topId = topReply.rpid || 0
    let idx = -1
    for (let i = 0; i < replies.length; i++) {
      if (replies[i].rpid === topId) { idx = i; break }
    }
    let topItem = null
    if (idx >= 0) { topItem = replies[idx]; replies.splice(idx, 1) }
    else topItem = mapReply(topReply, upperMid, builtinEmoji)
    topItem.pinned = true
    replies.unshift(topItem)
  }
  const __res = { total: page.count || 0, replies: replies }
  if ((pn || 1) === 1) cacheSet(ckey, __res)
  return __res
}

/**
 * 楼中楼 (某条主评论的子回复列表, x/v2/reply/reply)
 * @param {number} aid 视频 aid (oid)
 * @param {number} root 顶层主评论 rpid
 * @param {number} pn 页码
 * @param {object} builtinEmoji 内置 emoji 图片映射
 */
export async function getSubReplies(aid, root, pn, builtinEmoji, type) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const url = 'https://api.bilibili.com/x/v2/reply/reply?type=' + (Number(type) || 1) + '&oid=' + encodeURIComponent(aid)
    + '&root=' + encodeURIComponent(root) + '&pn=' + (pn || 1) + '&ps=20&jsonp=json'
  const body = await getJsonAsync(url, 15)
  if (body.code !== 0 || !body.data) {
    if (body.code === 12009) throw new Error('评论区已关闭')
    throw new Error(body.message || ('回复接口错误 code=' + body.code))
  }
  const page = body.data.page || {}
  const list = body.data.replies || []
  const upperMid = (body.data.upper && body.data.upper.mid) || 0
  const replies = []
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r) continue
    // reply_to: 楼中楼里被回复的人 (扁平结构)
    const rt = r.reply_to ? (r.reply_to.uname || '') : ''
    replies.push(mapReply(r, upperMid, builtinEmoji, { replyTo: rt }))
  }
  return { total: page.count || 0, replies: replies }
}

/**
 * 评论点赞/取消 (x/v2/reply/action, 需登录 + csrf)
 * 实测: 点赞后评论列表里的 action 字段会变成 1 (权威状态); like 计数有延迟.
 * @param {number} aid 视频 aid (oid)
 * @param {number} rpid 评论 rpid
 * @param {boolean} on true=点赞 false=取消
 */
export async function likeReply(aid, rpid, on, type) {
  const csrf = needCsrf()
  const data = 'oid=' + encodeURIComponent(aid) + '&type=' + (Number(type) || 1) + '&rpid=' + encodeURIComponent(rpid)
    + '&action=' + (on === false ? 0 : 1) + '&csrf=' + encodeURIComponent(csrf)
  const body = await postJsonAsync('https://api.bilibili.com/x/v2/reply/action', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -403) throw new Error('点赞过于频繁, 请稍后再试')
    throw new Error(body.message || ('评论点赞失败 code=' + body.code))
  }
  return true
}

/**
 * 发表评论 (x/v2/reply/add, 需登录 Cookie + csrf)
 * @param {number} aid 视频 aid (oid)
 * @param {string} message 内容
 * @param {number} [root] 楼中楼: 顶层主评论 rpid (发主评论时不传)
 * @param {number} [parent] 楼中楼: 被直接回复的那条 rpid (默认等于 root)
 */
export async function addReply(aid, message, root, parent, type) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  if (!auth.hasCookie()) throw new Error('登录后才能评论')
  const csrf = auth.getCsrf()
  if (!csrf) throw new Error('Cookie 缺少 bili_jct (请重新登录)')
  let data = 'oid=' + encodeURIComponent(aid) + '&type=' + (Number(type) || 1) + '&message='
    + encodeURIComponent(message) + '&csrf=' + encodeURIComponent(csrf)
  if (root) {
    data += '&root=' + encodeURIComponent(root)
    data += '&parent=' + encodeURIComponent(parent || root)
  }
  const body = await postJsonAsync('https://api.bilibili.com/x/v2/reply/add', data, 15)
  if (body.code !== 0) {
    if (body.code === -101) throw new Error('登录已过期, 请重新登录')
    if (body.code === -412) throw new Error('请求被风控拦截, 请稍后再试')
    throw new Error(body.message || ('评论发送失败 code=' + body.code))
  }
  return true
}

/**
 * 从电脑端 pc-cookie-server.py 拉取 Cookie (电脑同步登录)
 * @param {string} ip 电脑局域网 IP, 如 "192.168.1.100"
 * @returns {Promise<{sessdata,biliJct,dedeUserId}>}
 */
export async function fetchPcCookie(ip) {
  if (!hasHttp()) throw new Error('当前固件不支持 http 请求 (缺少 bilinet 模块)')
  const clean = String(ip || '').trim()
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) throw new Error('IP 格式不正确')
  const url = 'http://' + clean + ':9527/bilibilipan/cookie'
  const s = bilinet.httpGet(url, 5)
  console.log('[bili] PC cookie fetch ' + clean + ' -> ' + (s ? s.length : 0) + 'B')
  if (!s) throw new Error('连不上电脑 (' + clean + '), 请确认已运行 pc-cookie-server.py 且同一 WiFi')
  let body
  try {
    body = JSON.parse(s)
  } catch (e) {
    throw new Error('电脑返回的数据不是 JSON, 请确认端口为 9527')
  }
  if (!body.ok || !body.sessdata) throw new Error('电脑端还没有保存 Cookie')
  return {
    sessdata: body.sessdata,
    biliJct: body.bili_jct || '',
    dedeUserId: body.dedeuserid || ''
  }
}

// 相对时间 (评论发布时间): N分钟前/N小时前/N天前/日期
function formatRelative(epochSec) {
  if (!epochSec) return ''
  const dt = new Date(epochSec * 1000)
  function pad(n) { return n < 10 ? '0' + n : '' + n }
  const diff = Date.now() / 1000 - epochSec
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前'
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + '天前'
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())
}
