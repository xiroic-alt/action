function pictureRows(pictures, width, columns) {
  const pics = pictures || []
  const cols = Math.max(1, Math.min(columns || 4, pics.length || 1))
  const cell = Math.max(1, Math.floor((width - cols * 6) / cols))
  const out = []
  for (let i = 0; i < pics.length; i++) {
    const p = Object.assign({}, pics[i])
    if (pics.length === 1) {
      const scale = Math.min(1, width / Math.max(1, Number(p.w) || 400))
      p.w = Math.round((Number(p.w) || 400) * scale)
      p.h = Math.round((Number(p.h) || 240) * scale)
    } else { p.w = Math.min(cell, Number(p.w) || cell); p.h = p.w }
    if (i % cols === 0) out.push([])
    out[out.length - 1].push(p)
  }
  return out
}
// A page owns its interaction state; cached API snapshots remain untouched.
export function prepareFeedCards(items, paneWidth, columns) {
  const width = Math.max(1, (Number(paneWidth) || 960) - 64)
  return (items || []).map(function (item) {
    const card = Object.assign({}, item, { stat: Object.assign({}, item.stat), expanded: false })
    card.rows = pictureRows(item.pics, width, columns)
    if (item.orig) card.orig = Object.assign({}, item.orig, { rows: pictureRows(item.orig.pics, width - 16, columns) })
    return card
  })
}
