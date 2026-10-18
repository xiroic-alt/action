// 功能: 跳过赞助片段 (SponsorBlock, PiliNara 的对应功能)
//
// 判定在 services/sponsorblock.js (纯逻辑), 取数在 services/api.js,
// 播放页在轮询里调用 shouldSkip 并 seek 过去.
import { defineFeature } from '../core/feature.js'

defineFeature({
  id: 'sponsorblock',
  title: '跳过片段',
  icon: 'set_live',
  spec: {
    sbEnable: [true, 'bool'],
    sbCats: ['sponsor,intro,outro', 'str', [128]],
    sbMinLen: [1, 'int', [0, 30]],
    sbMaxSkip: [90, 'int', [10, 600]]
  },
  settings: [
    { k: 'sbEnable', t: 'switch', label: '跳过赞助片段', desc: '来自 SponsorBlock 公开片段库 (非 B 站接口)' },
    { k: 'sbCats', t: 'input', label: '跳过类别', desc: '英文逗号分隔: sponsor=赞助广告 selfpromo=自我推广 intro=片头 outro=片尾 interaction=求三连' },
    { k: 'sbMinLen', t: 'number', label: '最短片段', desc: '短于 N 秒的片段不跳', step: 1, fmt: function (v) { return v + 's' } },
    { k: 'sbMaxSkip', t: 'number', label: '单次最长跳过', desc: '防止一次跳过整支视频', step: 10, fmt: function (v) { return v + 's' } }
  ]
})
