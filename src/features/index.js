// 功能汇总入口 —— 唯一的集合点
//
// 一个功能 = 一个文件, 通过 core/feature.js 的 defineFeature 自注册.
// ★ import 顺序有意义: feature.js 必须最先 (提供 defineFeature), 其余按业务依赖排序.
import './danmaku.js'
import './subtitle.js'
import './sponsorblock.js'

export { defineFeature, featureList, feature, settingsGroups, runFeatureInits } from '../core/feature.js'
