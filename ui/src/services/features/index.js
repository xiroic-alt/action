// 功能汇总入口 —— 唯一的"集合点"
//
// 一个功能模块 = 一个文件, 通过 registry.defineFeature() 自注册. 这里只负责 import
// 一次(触发副作用), 并在需要时把注册表转成设置页可消费的形状.
//
// ★ 顺序有意义: import 是深度优先执行的, registry.js 必须排第一个 (提供 defineFeature),
//   后面的功能模块按字母/业务顺序 import 即可, 但**有依赖关系的功能必须排在依赖之前**.
import { defineFeature, featureList, feature, settingsGroups, runFeatureInits } from './registry.js'

// ---- 功能模块 (每批新增一项就在这里加一行 import) ----
import './danmaku-feature.js'
import './subtitle-feature.js'
import './filter-feature.js'

export { defineFeature, featureList, feature, settingsGroups, runFeatureInits }
