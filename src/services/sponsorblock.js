// SponsorBlock 跳过片段 —— 决策层 (纯逻辑, 无网络)
//
// 数据源: sponsor.ajay.app 公开 API (匿名):
//   GET /api/skipSegments?videoID=<BV>  -> [{ segment:[start,end], category, actionType, UUID }]
//   404 = 这支视频没有片段 (正常情况)
//
// 本模块只做"拿到 JSON 之后"的归一化与判定; 取数在 services/api.js 的 sponsorSegments().
export const CATEGORIES = [
  { id: 'sponsor', label: '赞助广告' },
  { id: 'selfpromo', label: '自我推广' },
  { id: 'interaction', label: '求三连' },
  { id: 'intro', label: '片头' },
  { id: 'outro', label: '片尾' },
  { id: 'preview', label: '预告' },
  { id: 'music_offtopic', label: '非音乐段' },
  { id: 'filler', label: '闲聊' }
]

const LABEL = {}
for (let i = 0; i < CATEGORIES.length; i++) LABEL[CATEGORIES[i].id] = CATEGORIES[i].label

export function categoryLabel(id) {
  const k = String(id || '')
  return LABEL[k] || k
}

/** 归一化: 兼容裸数组与 { segments: [...] }, 丢弃非法项, 按 start 升序 */
export function normalizeSegments(json) {
  const list = Array.isArray(json) ? json : ((json && json.segments) || [])
  const out = []
  for (let i = 0; i < list.length; i++) {
    const raw = list[i]
    if (!raw) continue
    const seg = raw.segment || raw
    if (!Array.isArray(seg) || seg.length < 2) continue
    const s = Number(seg[0]), e = Number(seg[1])
    if (!isFinite(s) || !isFinite(e) || s < 0 || e <= s) continue
    out.push({ start: s, end: e, category: String(raw.category || 'sponsor'), action: String(raw.actionType || 'skip'), uuid: String(raw.UUID || '') })
  }
  out.sort(function (a, b) { return a.start - b.start })
  return out
}

/**
 * 当前位置该不该跳.
 * @param {number} timeSec 当前播放秒
 * @param {Array} segments normalizeSegments 的结果
 * @param {Object} opts { categories: string[], minLenSec, maxSkipSec }
 *   categories 空数组 = 不跳任何类别 (与设置页"一个都没勾"的直觉一致)
 * @returns {null | { to, category, label, len }}
 */
export function shouldSkip(timeSec, segments, opts) {
  const o = opts || {}
  const cats = o.categories || []
  if (!cats.length || !segments || !segments.length) return null
  const t = Number(timeSec)
  if (!isFinite(t) || t < 0) return null
  let minLen = Number(o.minLenSec)
  if (!isFinite(minLen)) minLen = 1
  let maxSkip = Number(o.maxSkipSec)
  if (!isFinite(maxSkip) || maxSkip <= 0) maxSkip = 90
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (cats.indexOf(s.category) < 0) continue
    if (t < s.start || t >= s.end) continue
    const len = s.end - s.start
    if (len < minLen) continue
    let to = s.end
    if (to - t > maxSkip) to = t + maxSkip
    return { to: to, category: s.category, label: categoryLabel(s.category), len: len }
  }
  return null
}
