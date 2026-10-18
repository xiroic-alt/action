// 功能: 字幕 (PiliNara 的 CC 字幕 + 双语字幕 + 保存 VTT/SRT → 笔上从零实现)
//
// 链路: bili.getVideoDetail 的 data.subtitle.subtitles → subtitle.pickSubtitles 归一化
//      → 选中字幕后按 url 拉正文 JSON → subtitle.parseSubtitleJson → 播放页按时间取 cue.
//
// 双语: 主字幕 + 副字幕两条同时显示 (副字幕字号/位置独立), 与 PiliNara 的"主/副双栏"对应.
// 笔屏只有 960x266, 双字幕只能一上一下贴着底部, 不能像手机那样各自居中.
import { defineFeature } from './registry.js'

defineFeature({
  id: 'subtitle',
  title: '字幕',
  icon: 'set_line',
  spec: {
    subEnable: [true, 'bool'],                        // 字幕总开关
    subFont: [22, 'int', [14, 36]],                   // 主字幕字号
    subSubFont: [18, 'int', [12, 30]],                // 副字幕字号
    subWeight: ['bold', 'enum', ['normal', 'bold']],  // 主字幕字重
    subStroke: [1, 'enum', [0, 1, 2]],                // 描边强度 (0 无 / 1 细 / 2 粗)
    subBgOpacity: [35, 'int', [0, 100]],               // 字幕底衬不透明度 %
    subGap: [4, 'int', [0, 20]],                       // 主副字幕间距
    subOffsetY: [10, 'int', [0, 60]],                  // 离底边高度
    subRemember: ['', 'str', [64]],                    // 记住的偏好的语言 (lan 码), 空 = 每次自动选
    subSaveFmt: ['srt', 'enum', ['srt', 'vtt']]        // 保存字幕的格式
  },
  settings: [
    { k: 'subEnable', t: 'switch', label: '显示字幕', desc: '自动挂载当前视频的第一条 CC 字幕' },
    { k: 'subFont', t: 'number', label: '主字幕字号', step: 2, fmt: function (v) { return v + 'px' } },
    { k: 'subSubFont', t: 'number', label: '副字幕字号', desc: '双语字幕的第二条 (通常译文字幕)', step: 2, fmt: function (v) { return v + 'px' } },
    { k: 'subWeight', t: 'choice', label: '字重', opts: [['normal', '常规'], ['bold', '加粗']] },
    { k: 'subStroke', t: 'choice', label: '描边', desc: '视频画面亮时需要描边才看得清', opts: [[0, '无'], [1, '细'], [2, '粗']] },
    { k: 'subBgOpacity', t: 'number', label: '底衬不透明度', step: 5, fmt: function (v) { return v + '%' } },
    { k: 'subGap', t: 'number', label: '主副间距', step: 2, fmt: function (v) { return v + 'px' } },
    { k: 'subOffsetY', t: 'number', label: '离底高度', desc: '避免和控制条打架', step: 4, fmt: function (v) { return v + 'px' } },
    { k: 'subSaveFmt', t: 'choice', label: '保存格式', desc: '保存字幕时导出的文件格式', opts: [['srt', 'SRT'], ['vtt', 'WEBVTT']] }
  ]
})
