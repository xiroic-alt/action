// 展示格式化 (纯函数, 无副作用)
//
// 设备侧注意: QuickJS 20200705 不保证 Date.prototype.toISOString / Intl, 所以日期与数字
// 一律手工格式化 —— 这里也是唯一允许出现"格式化魔法数"的地方.

/** 播放量: 1.2万 / 3.4亿; 负数(接口隐藏播放量) -> '--' */
export function playCount(n) {
  const v = Number(n)
  if (!isFinite(v) || v < 0) return '--'
  if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿'
  if (v >= 10000) return (v / 10000).toFixed(1) + '万'
  return String(Math.round(v))
}

/** 秒 -> m:ss (超过 1 小时 -> h:mm:ss) */
export function duration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const p2 = function (x) { return x < 10 ? '0' + x : '' + x }
  if (h > 0) return h + ':' + p2(m) + ':' + p2(r)
  return m + ':' + p2(r)
}

/** 毫秒 -> m:ss */
export function durationMs(ms) { return duration(Math.round((Number(ms) || 0) / 1000)) }

/** 时间戳(秒) -> 相对时间: 刚刚 / N分钟前 / N小时前 / N天前 / 日期 */
export function relative(epochSec) {
  const t = Number(epochSec) || 0
  if (!t) return ''
  const now = Math.floor(Date.now() / 1000)
  const d = now - t
  if (d < 0) return '刚刚'
  if (d < 60) return '刚刚'
  if (d < 3600) return Math.floor(d / 60) + '分钟前'
  if (d < 86400) return Math.floor(d / 3600) + '小时前'
  if (d < 86400 * 30) return Math.floor(d / 86400) + '天前'
  return date(t)
}

/** 时间戳(秒) -> YYYY-MM-DD */
export function date(epochSec) {
  const t = Number(epochSec) || 0
  if (!t) return ''
  const dt = new Date(t * 1000)
  const p2 = function (x) { return x < 10 ? '0' + x : '' + x }
  return dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate())
}

/** 去掉 HTML 标签 (B 站部分字段带 <em class="keyword">) */
export function stripTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, '')
}

/** 补 https 协议 (接口常给 //i0.hdslb.com/...) */
export function normalizeUrl(u) {
  let s = String(u || '')
  if (s.indexOf('//') === 0) s = 'https:' + s
  if (s.indexOf('http://') === 0) s = 'https://' + s.substring(7)
  return s
}

/**
 * 图片裁切参数. 设备 <image> 不支持 webp, 必须保留原扩展名再拼参数:
 *   xxx.webp@480w_300h_1c.jpg  -> 200 JPEG
 * 丢掉扩展名 (xxx@480w.jpg) 会 404.
 */
export function thumb(url, w, h) {
  const u = normalizeUrl(url)
  if (!u) return ''
  // ★ 幂等: 已经带过 @..w..h 裁切参数就直接返回.
  //   否则同一个 URL 会被拼两次 (...jpg@480w_300h_1c.jpg@556w_347h_1c.jpg),
  //   真机上图片静默不显示, 排查成本很高.
  if (u.indexOf('@') >= 0) return u
  const ww = Math.max(1, Math.round(Number(w) || 480))
  const hh = h ? Math.max(1, Math.round(Number(h))) : 0
  return u + '@' + ww + 'w' + (hh ? '_' + hh + 'h' : '') + '_1c.jpg'
}

/** 弹幕/评论数等: 同 playCount */
export const count = playCount
