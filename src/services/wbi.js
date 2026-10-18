// wbi key 获取与缓存 —— 薄层: 网络 + 缓存 + 登录态失效, 签名本身在 wbi-sign.js
import { getJson } from '../core/net.js'
import { mixinKeyFrom, buildQuery } from './wbi-sign.js'
// 签名工具对调用方是"wbi 能力", 所以从这一层再导出 (实现仍在 wbi-sign.js, 纯逻辑)
export { rfc3986, mixinKeyFrom, buildQuery } from './wbi-sign.js'
import { logDebug } from '../core/log.js'
import { cookieHeader } from '../core/auth.js'

let key = null
let keyAt = 0
let keyScope = ''

function scope() { return cookieHeader() }

/** 取 mixin_key (12h 缓存; 登录态变化立即失效) */
export async function mixinKey() {
  const sc = scope()
  const age = Date.now() - keyAt
  if (key && keyScope === sc && age >= 0 && age < 12 * 3600 * 1000) return key
  const body = await getJson('https://api.bilibili.com/x/web-interface/nav', { noError: true })
  const img = body && body.data && body.data.wbi_img && body.data.wbi_img.img_url
  const sub = body && body.data && body.data.wbi_img && body.data.wbi_img.sub_url
  if (!img || !sub) throw new Error('wbi key 获取失败 (nav 无 wbi_img)')
  const k = mixinKeyFrom(img, sub)
  key = k
  keyAt = Date.now()
  keyScope = sc
  logDebug('wbi', 'mixin_key 已刷新')
  return k
}

/** 生成带签名的 query 串 */
export async function signQuery(params, opts) {
  const k = (opts && opts.key) || await mixinKey()
  const ts = (opts && opts.ts) || Math.floor(Date.now() / 1000)
  return buildQuery(params, k, ts)
}

/** 只给门禁: 注入固定 key (不联网) */
export function __setKeyForTest(k) { key = k; keyAt = Date.now(); keyScope = scope() }

