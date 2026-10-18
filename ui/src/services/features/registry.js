// PiliPRO 功能注册表 —— 一个功能 = 一个模块文件, 不再去改共享文件
//
// 为什么需要它: PiliNara 的功能面很大(弹幕/字幕/过滤/备注/多账号/备份/直播增强...),
// 每加一项传统上要同时动三处共享文件 —— services/config.js(默认值+取值域)、
// pages/settings/settings.vue(设置入口)、以及各页面的接线. 多批次并行时这三处必然互相踩.
//
// 这里把"一个功能"收敛成一个对象:
//   defineFeature({
//     id: 'danmaku',                    // 唯一 id
//     title: '弹幕',                     // 设置分组标题
//     icon: 'set_play',                 // 设置分组图标 (assets/mi 里的名字, 不带后缀)
//     spec: { dmEnable: [true, 'bool'], // 直接写进 config.js 的 SPEC 表 (默认值/类型/取值域)
//             dmFont: [22, 'int', [14, 34]] },
//     settings: [ ...设置行... ],         // 见下面的"设置行字典"
//     init: function () {}              // 可选: 应用启动时的注册/预热 (出错只记日志, 不打断启动)
//   })
//
// 设置行字典 (与 pages/settings/settings.vue 的渲染分支一一对应, 不要发明新字段):
//   { k, t: 'switch',  label, desc }                          开关
//   { k, t: 'choice',  label, desc, opts: [[值, 文案], ...] }   分段选择
//   { k, t: 'number',  label, desc, step, fmt: (v) => '文案' }  步进器
//   { k, t: 'go',      label, desc, to: '页面名', val: () => 文案 }   跳页
//   { k, t: 'action',  label, desc, act: '按钮文案', fn(ctx), danger? } 动作(fn 由注册者提供)
//   { k, t: 'text',    textKey: '...' }                        只读文本(需要 settings.vue 认识该 key)
//
// 注意: 本文件**不** import 任何功能模块(否则成环); 功能模块由 ./index.js 汇总 import.
import { extendSpec } from '../config.js'
import { log } from '../log.js'

var FEATURES = {}          // id -> def (防重复注册)
var GROUP_LIST = []        // 设置分组 (按注册顺序)
var INIT_LIST = []         // 启动钩子

// 注册一个功能. 返回 def 本身, 方便模块自己继续用.
export function defineFeature(def) {
  if (!def || !def.id) return null
  if (FEATURES[def.id]) return FEATURES[def.id]
  FEATURES[def.id] = def
  if (def.spec) {
    try { extendSpec(def.spec) } catch (e) { log('功能', def.id + ' 配置项注册失败: ' + (e && e.message ? e.message : e)) }
  }
  if (def.settings && def.settings.length) {
    GROUP_LIST.push({
      id: 'f_' + def.id,
      title: def.title || def.id,
      icon: def.icon || 'set_live',
      rows: def.settings
    })
  }
  if (typeof def.init === 'function') INIT_LIST.push(def)
  return def
}

export function featureList() {
  var out = []
  for (var k in FEATURES) if (FEATURES.hasOwnProperty(k)) out.push(FEATURES[k])
  return out
}

export function feature(id) { return FEATURES[id] || null }

/** 功能贡献的设置分组 (settings.vue 追加在静态 SCHEMA 之后) */
export function settingsGroups() { return GROUP_LIST }

/** 应用启动时跑一遍各功能的 init. 单个失败不影响其它功能与应用启动. */
export function runFeatureInits() {
  for (var i = 0; i < INIT_LIST.length; i++) {
    var f = INIT_LIST[i]
    try { f.init() } catch (e) {
      log('功能', f.id + ' 初始化失败: ' + (e && e.message ? e.message : e))
    }
  }
  return INIT_LIST.length
}
