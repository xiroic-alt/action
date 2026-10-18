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

/**
 * 反查: 由 nextPage 推出自己的名字.
 * 详情副本(生成产物)只拿得到 next-page 这个 prop, 而 prop 给的是"下一站",
 * 所以要回推一站才知道"我是谁" —— page.vue onShow 用它对齐游标.
 */
export function prevOf(name) {
  var i = RING.indexOf(name)
  if (i < 0) return 'page'
  return RING[(i - 1 + RING.length) % RING.length]
}

// ---- 全局游标: 让**所有入口**共用一套轮换, 而不是各自硬编码 navTo('page') ----
//
// 真机 bug (2026-10-18): 详情页A -> UP主页 -> 点另一个视频 -> 又回到视频A, 新视频进不去.
// 根因: up.vue 里硬编码 navTo('page'), 而栈里已经有一个 page 实例 ——
//   固件对**同名页**的 navTo 不是入栈, 而是让已存在的那个实例上浮并沿用它的旧 options;
//   那个实例的 onShow 走 beginLoad(this.$page.options), 拿到的还是旧 bvid,
//   又被 "bvid === this.bvid" 的去重门槛挡住 -> 永远停在最开始那支视频.
//
// 固件**没有**查询页面栈的 API (SDK 里只有 looper/Thread 的 getStackSize, 与页面无关),
// 所以栈里到底有几个详情实例、叫什么, 我们看不到. 只能让游标自我对齐:
//   - 详情页 onShow 时把游标拨到"自己名字的下一站" (它最清楚自己在环上的位置)
//   - 任何入口跳详情都取 RING[cursor], 天然避开刚离开的那个详情页名字
var cursor = 0

/** 详情页 onShow / 内部跳转时对齐游标: 下一次入栈应是自己的下一站 */
export function syncDetailCursor(ownName) {
  var i = RING.indexOf(ownName)
  cursor = i < 0 ? 0 : (i + 1) % RING.length
}

/** 任意入口(首页/动态/关注/收藏/历史/稍后再看/消息/UP主页/楼中楼)进详情时取页面名 */
export function nextDetailName() {
  var n = RING[cursor]
  cursor = (cursor + 1) % RING.length
  return n
}
