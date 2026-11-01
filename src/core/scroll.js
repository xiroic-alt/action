// 滚动事件归一化 —— 真机实测字段 (2026-11-01)
//
// 框架的 <scroller> @scroll 事件给的是:
//   { type: "scroll", contentOffset: {x, y}, contentSize: {width, height} }
// **没有 scrollBottom 字段**. 之前全仓 10 个页面都判断 e.detail.scrollBottom != null,
// 恒为 false -> 自动加载从来没生效过, 只能点"加载更多".
// 这是用户报的"上滑无法自动加载"的真因.

const det = (e) => ((e && e.detail) ? e.detail : (e || {}))

/** 取出纵向偏移 contentOffset.y (兼容旧的 scrollTop/top) */
export function scrollTopOf(e) {
  const d = det(e)
  const off = d.contentOffset || {}
  if (off.y != null) return Number(off.y) || 0
  if (off.top != null) return Number(off.top) || 0
  if (d.scrollTop != null) return Number(d.scrollTop) || 0
  return null
}

/** 取出内容总高 contentSize.height */
export function scrollHeightOf(e) {
  const d = det(e)
  const size = d.contentSize || {}
  if (size.height != null) return Number(size.height) || 0
  if (d.scrollHeight != null) return Number(d.scrollHeight) || 0
  return null
}

/** 距底部还有多少像素; 拿不到返回 null */
export function scrollBottomOf(e, viewH) {
  const y = scrollTopOf(e)
  const h = scrollHeightOf(e)
  if (y == null || h == null) return null
  return h - y - (Number(viewH) || 0)
}

/** 下拉过头 (用于下拉刷新): 偏移为负说明被拉下来了 */
export function isPullDown(e, threshold) {
  const y = scrollTopOf(e)
  if (y == null) return false
  return y < -(Number(threshold) || 24)
}
