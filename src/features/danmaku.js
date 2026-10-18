// 功能: 弹幕 (PiliNara 的弹幕体验 → 笔上实现)
//
// 链路: api.danmakuXml(cid) -> danmaku.js(解析/合并放大/屏蔽/泳道) -> play.vue 弹幕层
// 本文件只声明配置项与设置入口 (实现分别在 services/danmaku.js 与 pages/play).
import { defineFeature } from '../core/feature.js'

defineFeature({
  id: 'danmaku',
  title: '弹幕',
  icon: 'set_play',
  spec: {
    dmEnable: [true, 'bool'],
    dmFont: [24, 'int', [14, 40]],
    dmOpacity: [90, 'int', [20, 100]],
    dmSpeedSec: [9, 'int', [4, 20]],
    dmLanes: [6, 'int', [2, 12]],
    dmMerge: [true, 'bool'],
    dmMergeThreshold: [3, 'int', [2, 20]],
    dmMergeGrowth: [12, 'int', [0, 40]],
    dmBlockWords: ['', 'str', [512]],
    dmBlockRegex: ['', 'str', [512]],
    dmHideBottom: [false, 'bool']
  },
  settings: [
    { k: 'dmEnable', t: 'switch', label: '显示弹幕', desc: '播放页叠加滚动弹幕' },
    { k: 'dmFont', t: 'number', label: '弹幕字号', desc: '笔屏 960x266, 建议 20-28', step: 2, fmt: function (v) { return v + 'px' } },
    { k: 'dmOpacity', t: 'number', label: '不透明度', step: 10, fmt: function (v) { return v + '%' } },
    { k: 'dmSpeedSec', t: 'number', label: '弹幕速度', desc: '数字越小跑得越快', step: 1, fmt: function (v) { return v + 's 过屏' } },
    { k: 'dmLanes', t: 'number', label: '弹幕行数', desc: '同屏最多几行, 超出丢弃', step: 1, fmt: function (v) { return v + ' 行' } },
    { k: 'dmMerge', t: 'switch', label: '合并重复弹幕', desc: '同内容合并并放大字号 (类 Pakku.js)' },
    { k: 'dmMergeThreshold', t: 'number', label: '放大阈值', desc: '出现几次后开始放大', step: 1, fmt: function (v) { return v + ' 次' } },
    { k: 'dmMergeGrowth', t: 'number', label: '放大速度', desc: '每多一次的放大百分比', step: 2, fmt: function (v) { return v + '%' } },
    { k: 'dmHideBottom', t: 'switch', label: '隐藏底端弹幕', desc: '底端弹幕会和字幕抢位置' }
  ]
})
