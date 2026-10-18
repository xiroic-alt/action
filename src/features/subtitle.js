// 功能: 字幕 (PiliNara 的 CC 字幕 + 双语字幕)
//
// 链路: videoDetail().subtitles -> api.subtitleBody(url) -> subtitle.js(解析/选轨) -> play.vue 字幕层
import { defineFeature } from '../core/feature.js'

defineFeature({
  id: 'subtitle',
  title: '字幕',
  icon: 'set_line',
  spec: {
    subEnable: [true, 'bool'],
    subFont: [22, 'int', [14, 36]],
    subSubFont: [18, 'int', [12, 30]],
    subBgOpacity: [35, 'int', [0, 100]],
    subOffsetY: [10, 'int', [0, 60]]
  },
  settings: [
    { k: 'subEnable', t: 'switch', label: '显示字幕', desc: '自动挂载视频的第一条 CC 字幕' },
    { k: 'subFont', t: 'number', label: '主字幕字号', step: 2, fmt: function (v) { return v + 'px' } },
    { k: 'subSubFont', t: 'number', label: '副字幕字号', desc: '双语字幕的第二条', step: 2, fmt: function (v) { return v + 'px' } },
    { k: 'subBgOpacity', t: 'number', label: '底衬不透明度', step: 5, fmt: function (v) { return v + '%' } },
    { k: 'subOffsetY', t: 'number', label: '离底高度', desc: '避免与控制条打架', step: 4, fmt: function (v) { return v + 'px' } }
  ]
})
