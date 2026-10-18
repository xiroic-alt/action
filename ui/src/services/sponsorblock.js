// SponsorBlock 跳过片段 (PiliNara 的"跳过赞助/片头/片尾"在笔上的等价实现)
//
// 数据源: sponsor.ajay.app 的公开 API (匿名, 不需要账号):
//   GET /api/skipSegments?videoID=<BV 号>            -> [{ segment: [start, end], category, actionType, UUID }]
//   GET /api/skipSegments?videoID=<BV 号>&categories=["sponsor","intro"]
//   404 = 这支视频没有任何片段 (正常情况, 不是错误)
//
// 本模块只做"拿到 JSON 之后"的归一化与决策: 取数在 bili.js (getSponsorSegments).
// 判定语义对齐 PiliNara 的三个开关: 类别勾选 / 手动拖动进片段是否也跳 / 最短片段长度与单次上限.
export const CATEGORIES = [
  { id: 'sponsor', label: '赞助广告' },
  { id: 'selfpromo', label: '自我推广' },
  { id: 'interaction', label: '求三连' },
  { id: 'intro', label: '片头' },
  { id: 'outro', label: '片尾' },
  { id: 'preview', label: '预告' },
  { id: 'music_offtopic', label: '非音乐段' },
  { id: 'filler', label: '闲聊' },
  { id: 'poi_highlight', label: '高能片段' }
]

var LABEL = {}
for (var i = 0; i < CATEGORIES.length; i++) LABEL[CATEGORIES[i].id] = CATEGORIES[i].label

export function categoryLabel(id) {
  var k = String(id || '')
  return LABEL[k] || k
}

/** 归一化 API 响应: 兼容裸数组与 { segments: [...] }, 丢弃非法项, 按 start 升序 */
export function normalizeSegments(json) {
  var list = []
  if (Array.isArray(json)) list = json
  else if (json && Array.isArray(json.segments)) list = json.segments
  var out = []
  for (var i = 0; i < list.length; i++) {
    var raw = list[i]
    if (!raw) continue
    var seg = raw.segment || raw
    if (!Array.isArray(seg) || seg.length < 2) continue
    var s = Number(seg[0]), e = Number(seg[1])
    if (!isFinite(s) || !isFinite(e) || s < 0 || e <= s) continue
    out.push({
      start: s,
      end: e,
      category: String(raw.category || 'sponsor'),
      action: String(raw.actionType || 'skip'),
      uuid: String(raw.UUID || raw.uuid || '')
    })
  }
  out.sort(function (a, b) { return a.start - b.start })
  return out
}

/**
 * 当前位置该不该跳.
 * timeSec  当前播放时间(秒)
 * segments normalizeSegments 的结果
 * opts     { categories: [], skipOnSeek: false, minLenSec: 1, maxSkipSec: 90 }
 *   categories 空数组 = 不跳任何类别(而不是跳全部) —— 与设置页"一个都没勾"的直觉一致
 * 返回 null 或 { to, category, label, len }
 */
export function shouldSkip(timeSec, segments, opts) {
  var o = opts || {}
  var cats = o.categories || []
  if (!cats.length || !segments || !segments.length) return null
  var t = Number(timeSec)
  if (!isFinite(t) || t < 0) return null
  var minLen = Number(o.minLenSec)
  if (!isFinite(minLen)) minLen = 1
  var maxSkip = Number(o.maxSkipSec)
  if (!isFinite(maxSkip) || maxSkip <= 0) maxSkip = 90
  for (var i = 0; i < segments.length; i++) {
    var s = segments[i]
    if (cats.indexOf(s.category) < 0) continue
    if (t < s.start || t >= s.end) continue
    var len = s.end - s.start
    if (len < minLen) continue
    var to = s.end
    if (to - t > maxSkip) to = t + maxSkip
    return { to: to, category: s.category, label: categoryLabel(s.category), len: len }
  }
  return null
}

/** 已勾选类别的 URL 参数(给取数用); 空数组返回 '' 表示不过滤 */
export function categoryFilterParam(cats) {
  var arr = cats || []
  if (!arr.length) return ''
  return encodeURIComponent(JSON.stringify(arr))
}
