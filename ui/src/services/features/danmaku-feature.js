// 功能: 弹幕 (PiliNara 的弹幕体验 → 笔上从零实现)
//
// 这条链路的四段:
//   1. 取: bili.getDanmakuXml(cid) 拉 comment.bilibili.com/<cid>.xml (匿名可用, 不需要 wbi)
//   2. 解: services/danmaku.js 的 parseDanmakuXml + mergeDanmaku(Pakku 式合并放大) + filterDanmaku(屏蔽规则)
//   3. 排: buildTracks 分配泳道 (同泳道不重叠, 超出丢弃, 不叠成一团)
//   4. 画: pages/player 的弹幕层 (绝对定位 + transform 动画), 由 visibleAt 每帧取在屏项
//
// 本文件只负责"配置项 + 设置入口"; 取数在 bili.js, 算法在 danmaku.js, 渲染在 player.vue.
import { defineFeature } from './registry.js'

// 屏蔽词/正则都用换行分隔的字符串存 (config.js 的 SPEC 只有 bool/enum/int/str 四种类型,
// 列表一律序列化成字符串 —— 与 PiliNara 的"列表式可视化菜单 + 导入导出"等价:
// 用户可以整段粘贴/复制, 也就天然支持了跨设备迁移)
export function parseLines(s) {
  var out = []
  var t = String(s == null ? '' : s).split(/[\n|]+/)
  for (var i = 0; i < t.length; i++) {
    var v = t[i].trim()
    if (v) out.push(v)
  }
  return out
}

defineFeature({
  id: 'danmaku',
  title: '弹幕',
  icon: 'set_play',
  spec: {
    dmEnable: [true, 'bool'],                        // 总开关
    dmFont: [24, 'int', [14, 40]],                   // 字号 (笔屏 960x266, 24px 约等于正文)
    dmOpacity: [90, 'int', [20, 100]],               // 不透明度 %
    dmSpeedSec: [9, 'int', [4, 20]],                 // 一条弹幕从右到左穿过屏幕的秒数
    dmLanes: [6, 'int', [2, 12]],                    // 泳道数 (超过的弹幕丢弃, 不叠)
    dmMerge: [true, 'bool'],                         // Pakku 式合并: 重复弹幕合并并放大字号
    dmMergeThreshold: [3, 'int', [2, 20]],           // 出现几次开始放大
    dmMergeGrowth: [12, 'int', [0, 40]],             // 每多一次的放大百分比 (累计, 有上限)
    dmBlockWords: ['', 'str', [512]],                // 屏蔽词 (换行/竖线分隔)
    dmBlockRegex: ['', 'str', [512]],                // 屏蔽正则 (换行/竖线分隔, 非法正则忽略)
    dmBlockModes: ['', 'str', [64]],                 // 屏蔽类型: 1,2,3=滚动 4=底端 5=顶端 6=逆向
    dmHideBottom: [false, 'bool']                    // 直接不显示底端弹幕 (笔屏矮, 底端弹幕会和字幕打架)
  },
  settings: [
    { k: 'dmEnable', t: 'switch', label: '显示弹幕', desc: '播放页叠加滚动弹幕 (PiliNara 同款体验)' },
    { k: 'dmFont', t: 'number', label: '弹幕字号', desc: '笔屏 960x266, 建议 20-28', step: 2, fmt: function (v) { return v + 'px' } },
    { k: 'dmOpacity', t: 'number', label: '弹幕不透明度', step: 10, fmt: function (v) { return v + '%' } },
    { k: 'dmSpeedSec', t: 'number', label: '弹幕速度', desc: '数字越小跑得越快', step: 1, fmt: function (v) { return v + 's 过屏' } },
    { k: 'dmLanes', t: 'number', label: '弹幕行数', desc: '同屏最多几行 (超出的丢弃, 避免叠成一团)', step: 1, fmt: function (v) { return v + ' 行' } },
    { k: 'dmMerge', t: 'switch', label: '合并重复弹幕', desc: '同样内容合并成一条, 出现次数越多字号越大 (类 Pakku.js)' },
    { k: 'dmMergeThreshold', t: 'number', label: '放大阈值', desc: '同一句出现几次后开始放大', step: 1, fmt: function (v) { return v + ' 次' } },
    { k: 'dmMergeGrowth', t: 'number', label: '放大速度', desc: '每多出现一次的放大百分比', step: 2, fmt: function (v) { return v + '%' } },
    { k: 'dmHideBottom', t: 'switch', label: '隐藏底端弹幕', desc: '底端弹幕会和字幕/控制条抢地方' }
  ]
})

export { parseLines as default }
