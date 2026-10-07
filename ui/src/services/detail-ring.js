// 详情页副本环 (detail page ring)
//
// 为什么要有这个文件: 固件对**同名页**的 navTo 是"替换"而不是"入栈" ——
// 在详情页里再点开另一个视频, 如果还 navTo('page'), 返回栈里不会多一层,
// 返回会直接跳回列表, 而不是上一个视频. 官方客户端的"详情套详情"就是这么丢的.
//
// 解法只能是换一个**页面名**. 而 app.json 里的页面名是静态注册的, 运行时造不出来,
// 所以必须预先注册 N 个名字.
//
// 但"注册 N 个名字"不等于"手写 N 个文件":
//   - 真源就是这里的 RING 数组 + tools/gen-detail-ring.mjs 的模板
//   - ui/src/pages/pageN/ 下的副本是**生成产物**, 不手写、不单独改
//   - tools/validate.mjs 有一道门禁: 副本必须和生成器输出逐字节一致 (防漂移)
//   - app.json 里的 pages 表也由生成器维护
//
// 想改环的大小: 改下面这一个数组, 然后跑 node tools/gen-detail-ring.mjs
export var RING = [
  'page', 'page2', 'page3', 'page4', 'page5', 'page6',
  'page7', 'page8', 'page9', 'page10', 'page11', 'page12'
]

/** 环上的下一站 (详情页再点开一个视频时压进的页面名) */
export function nextOf(name) {
  var i = RING.indexOf(name)
  if (i < 0) return 'page2'
  return RING[(i + 1) % RING.length]
}

export var RING_SIZE = RING.length
