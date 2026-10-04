// 图片查看器的取图 + 取景数学
//
// 实现选择(0.9.56 真机实测后改的):
//   本机固件 **支持 <image> 上的 CSS transform**(scale/translate 都生效, transform-origin 只吃数值),
//   也支持 <image src="https 网络图"> 直接加载(mini-glide 自带下载/解码/缓存).
//   => 查看器不再走 "native 每帧解码+tjCompress2 编码+落盘" 那条路:
//      那条路每次缩放/拖动都要重写文件, 慢, 而且运行时会**按路径缓存 <image>**,
//      同名文件不刷新 -> 用户看到"80% 和 0% 都是同一张全屏图""拖不动".
//   现在: <image resize="contain"> 一次渲染 + transform 做缩放平移 = 即时/无损/无缓存问题.
//
// 语义: scale 100% = 整图适配屏幕(用户口中的"全屏"), 与 transform: scale(1) 对应.

export const VIEW_W = 960
export const VIEW_H = 266
export const MIN_SCALE = 0.4
export const MAX_SCALE = 12

// 缩略 URL -> 指定宽度的图 URL: 剥掉 @缩略 后缀与查询串, B 站图床按宽度补 @<w>w.jpg
// (列表里的图都是 @160w_160h_1c 这类缩略, 拿它放大必然糊)
//
// 为什么要分两档宽度 (0.9.58 流畅度优化):
//   本机 UI 只有 960 宽, 而 @2040w 是 2040x~1150 ≈ 235 万像素 —— 查看器每帧要把这个位图
//   重新采样到 transform 后的位置, 拖动/放大时就是它把帧率拖下去.
//   手势期间改用 @1080w (≈ 58 万像素, 只有原图的 1/4), 手感立刻跟手;
//   放大到 2 倍以上**且手势结束静置 260ms** 之后再换回原图 —— 换 src 会重新解码,
//   绝不能在手势过程中做 (会闪 + 掉帧).
export const HI_WIDTH = 2040
export const FIT_WIDTH = 1080

export function viewUrl(u, hi) {
  let s = String(u == null ? '' : u)
  if (s === '') return s
  const q = s.indexOf('?')
  if (q >= 0) s = s.slice(0, q)
  const at = s.indexOf('@')
  if (at >= 0) s = s.slice(0, at)
  if (s.indexOf('hdslb.com') >= 0 || s.indexOf('bilivideo') >= 0 || s.indexOf('biliimg') >= 0) {
    return s + (hi ? '@' + HI_WIDTH + 'w.jpg' : '@' + FIT_WIDTH + 'w.jpg')
  }
  return s
}

// 兼容旧调用: 取原图
export function bigUrl(u) {
  return viewUrl(u, true)
}

export function clampScale(s) {
  let v = s
  if (!(v > 0)) v = 1
  if (v < MIN_SCALE) v = MIN_SCALE
  if (v > MAX_SCALE) v = MAX_SCALE
  return v
}

// 平移夹取: 放大后最多把图拖到"中心偏出半屏", 避免把图拖没了
export function clampPan(t, scale) {
  const lim = (t.limit || VIEW_W) * scale * 0.75
  const limY = (t.limitY || VIEW_H) * scale * 0.75
  let x = t.x
  let y = t.y
  if (x > lim) x = lim
  if (x < -lim) x = -lim
  if (y > limY) y = limY
  if (y < -limY) y = -limY
  return { x: x, y: y }
}

// 把 scale/tx/ty 变成 image 的 style (transform-origin 必须用像素值, 本机不接受 left top)
export function imgStyle(scale, tx, ty) {
  return {
    width: VIEW_W + 'px',
    height: VIEW_H + 'px',
    transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')',
    transformOrigin: (VIEW_W / 2) + 'px ' + (VIEW_H / 2) + 'px'
  }
}
