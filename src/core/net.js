// 网络层 (全新实现) —— 只走 Web 端 API 的传输通道
//
// 用户硬约束: 只做网页 API, 不做 App API. 这里统一收敛所有 HTTP:
//   - 异步优先 (bilinet.httpGetAsync / httpPostAsync), 同步版仅作降级
//   - 自动带浏览器 UA + Referer (bilinet 内部已带, 这里不重复)
//   - 自动携带登录 Cookie (auth.js 提供)
//   - 统一错误语义: 网络错 / 风控 / 业务错 三种异常类型
//
// 错误约定 (页面直接消费, 别自己发明):
//   { kind: 'net', message }      连不上/超时/空响应
//   { kind: 'blocked', code:-412 }风控 (风控页/验证页)
//   { kind: 'biz', code, message }业务错误 (接口返回的 message)
//   { kind: 'bad', message }      响应不是 JSON

import { bilinet } from '../services/native.js'
import { logDebug, logError } from './log.js'
import { cookieHeader, hasCookie } from './auth.js'
import { getCfg } from './config.js'

/**
 * 看门狗: 原生 httpGetAsync 是 Promise, 但真机上出现过"请求发出、Promise 不 settle"
 * (框架日志有 createPromiseId 却没有后续回调), 页面就会永远停在"加载中".
 * 这里给它套一层超时竞速, 保证调用方一定能拿到结果或错误.
 * setTimeout 不可用时退化为原样等待 (原生自己有 curl --max-time).
 */
function withWatchdog(promise, seconds, what) {
  if (typeof setTimeout !== 'function') return promise
  return new Promise(function (resolve, reject) {
    let done = false
    const timer = setTimeout(function () {
      if (done) return
      done = true
      const e = new Error(what + ' 超时 (' + seconds + 's)')
      e.kind = 'net'
      reject(e)
    }, Math.max(3000, seconds * 1000 + 3000))
    promise.then(function (v) {
      if (done) return
      done = true
      try { clearTimeout(timer) } catch (e) {}
      resolve(v)
    }, function (err) {
      if (done) return
      done = true
      try { clearTimeout(timer) } catch (e) {}
      reject(err)
    })
  })
}

function hasAsync() {
  return !!(bilinet && typeof bilinet.httpGetAsync === 'function' && typeof bilinet.httpPostAsync === 'function')
}
function hasSync() {
  return !!(bilinet && typeof bilinet.httpGet === 'function' && typeof bilinet.httpPost === 'function')
}

function cleanUrl(u) {
  return String(u).replace(/(&|\?)w_rid=[^&]+/, '').replace(/(&|\?)wts=[^&]+/, '')
}

function parse(body, url) {
  if (!body) return null
  try { return JSON.parse(body) } catch (e) {
    const s = String(body)
    if (s.indexOf('<!DOCTYPE') === 0 || s.indexOf('<html') === 0) {
      const err = new Error('接口被风控拦截 (风控验证页)')
      err.kind = 'blocked'; err.code = -412
      throw err
    }
    const err = new Error('接口返回非 JSON: ' + s.substring(0, 120))
    err.kind = 'bad'
    throw err
  }
}

function authHeaders(extra) {
  const h = []
  if (hasCookie()) h.push(cookieHeader())
  if (extra && extra.length) for (let i = 0; i < extra.length; i++) h.push(extra[i])
  return h.length ? h : undefined
}

export function defTimeout() {
  // 从设置读 (别在这层写死): 依赖方向 net -> config -> store, 不成环
  try {
    const v = getCfg('httpTimeout')
    if (typeof v === 'number' && v >= 5 && v <= 60) return v
  } catch (e) {}
  return 15
}

/** GET 并解析 JSON. opts: { timeout, fresh, headers, noError } */
export async function getJson(url, opts) {
  const o = opts || {}
  const to = o.timeout || defTimeout()
  const headers = authHeaders(o.headers)
  let body
  try {
    if (hasAsync()) body = await withWatchdog(bilinet.httpGetAsync(url, to, headers), to, 'GET ' + cleanUrl(url).substring(0, 60))
    else if (hasSync()) body = bilinet.httpGet(url, to, headers)
    else { const e = new Error('当前固件不支持 http 请求'); e.kind = 'net'; throw e }
  } catch (e) {
    if (!e.kind) { e.kind = 'net' }
    if (o.noError) return null
    logError('网络', 'GET 失败: ' + cleanUrl(url))
    throw e
  }
  if (!body) { const e = new Error('请求失败 (空响应)'); e.kind = 'net'; throw e }
  logDebug('网络', 'GET ' + cleanUrl(url) + ' -> ' + body.length + 'B')
  const j = parse(body, url)
  if (j && typeof j.code !== 'undefined' && j.code !== 0 && !o.noError) {
    if (j.code === -412) {
      const e = new Error('请求被风控拦截, 请稍后再试'); e.kind = 'blocked'; e.code = -412
      throw e
    }
    const e = new Error(j.message || ('接口错误 code=' + j.code)); e.kind = 'biz'; e.code = j.code
    throw e
  }
  return j
}

/** POST 表单并解析 JSON. opts: { timeout, csrf, headers, noError } */
export async function postForm(url, data, opts) {
  const o = opts || {}
  const to = o.timeout || defTimeout()
  const extra = ['Content-Type: application/x-www-form-urlencoded']
  const headers = authHeaders(extra)
  let body
  try {
    if (hasAsync()) body = await withWatchdog(bilinet.httpPostAsync(url, data, to, headers), to, 'POST ' + url.substring(0, 60))
    else if (hasSync()) body = bilinet.httpPost(url, data, to, headers)
    else { const e = new Error('当前固件不支持 http 请求'); e.kind = 'net'; throw e }
  } catch (e) {
    if (!e.kind) e.kind = 'net'
    throw e
  }
  if (!body) { const e = new Error('请求失败 (空响应)'); e.kind = 'net'; throw e }
  logDebug('网络', 'POST ' + url.substring(0, 80) + ' -> ' + body.length + 'B')
  const j = parse(body, url)
  if (j && typeof j.code !== 'undefined' && j.code !== 0 && !o.noError) {
    if (j.code === -412) {
      const e = new Error('请求被风控拦截, 请稍后再试'); e.kind = 'blocked'; e.code = -412
      throw e
    }
    const e = new Error(j.message || ('接口错误 code=' + j.code)); e.kind = 'biz'; e.code = j.code
    throw e
  }
  return j
}

/** 原始文本 GET (弹幕 XML / 字幕 JSON 这类非 JSON 包装) */
export async function getText(url, opts) {
  const o = opts || {}
  const to = o.timeout || defTimeout()
  const headers = authHeaders(o.headers)
  let body
  try {
    if (hasAsync()) body = await withWatchdog(bilinet.httpGetAsync(url, to, headers), to, 'GET ' + url.substring(0, 60))
    else if (hasSync()) body = bilinet.httpGet(url, to, headers)
    else { const e = new Error('当前固件不支持 http 请求'); e.kind = 'net'; throw e }
  } catch (e) {
    if (!e.kind) e.kind = 'net'
    if (o.noError) return ''
    throw e
  }
  return body || ''
}
