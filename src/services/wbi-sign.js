// wbi 签名 —— **纯逻辑部分** (无网络, 无副作用, 可离线验证)
//
// 为什么把签名和取 key 分开: 签名错一位 -> 所有接口 -352, 而这类错在真机上极难定位.
// 拆成纯函数后, 门禁可以用固定 key + 固定时间戳离线验签, 覆盖置换表/RFC3986/排序三处风险.
//
// 官方文档: bilibili-API-collect docs/misc/sign/wbi.md
import { md5 } from './md5.js'

/** 官方 64 项置换表 */
export const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

/** RFC3986 编码: encodeURIComponent 不编码 !'()* , 而 wbi 要求编码它们 */
export function rfc3986(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase()
  })
}

/**
 * 从 nav 返回的两个 wbi_img 地址算出 mixin_key.
 * 输入可以是完整 url 或裸 32 位 hex.
 */
export function mixinKeyFrom(imgUrl, subUrl) {
  const pick = function (u) {
    const s = String(u || '')
    const m = /([a-fA-F0-9]{32})/.exec(s)
    if (!m) throw new Error('wbi key 格式无效: ' + s.substring(0, 60))
    return m[1]
  }
  const orig = pick(imgUrl) + pick(subUrl)
  let out = ''
  for (let i = 0; i < 32; i++) out += orig.charAt(MIXIN_TAB[i])
  return out
}

/**
 * 用给定 key 与时间戳生成签名 query (不含前导 ?).
 * 参数按 key 升序 -> rfc3986 -> 拼 & -> 追加 wts -> w_rid = md5(query + key)
 */
export function buildQuery(params, key, ts) {
  const p = {}
  for (const k in params) if (params.hasOwnProperty(k)) p[k] = params[k]
  p.wts = ts
  const keys = Object.keys(p).sort()
  const pairs = []
  for (let i = 0; i < keys.length; i++) pairs.push(rfc3986(keys[i]) + '=' + rfc3986(p[keys[i]]))
  const qs = pairs.join('&')
  return qs + '&w_rid=' + md5(qs + key)
}
