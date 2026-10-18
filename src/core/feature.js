// 功能注册表 —— 一个功能 = 一个模块文件, 不再去改共享文件
//
// 问题: 一个功能通常要同时动三处 —— 设置表 (默认值/取值域)、设置页 (入口)、页面 (接线).
// 多批次并行开发时这三处必然互相覆盖.
//
// 这里把"一个功能"收敛成一个对象:
//   defineFeature({
//     id, title, icon,
//     spec:     { 键: [默认值, 类型, 域] }   // 直接注册进 core/config.js 的 SPEC
//     settings: [ 设置行 ],                  // 见下面的行字典
//     init:     () => {}                     // 可选: 启动钩子
//   })
//
// 设置行字典 (与 pages/settings 的渲染分支一一对应, 不要发明新字段):
//   { k, t: 'switch',  label, desc }
//   { k, t: 'choice',  label, desc, opts: [[值, 文案]] }
//   { k, t: 'number',  label, desc, step, fmt(v) }
//   { k, t: 'input',   label, desc }                  // 点击唤起系统输入法写回
//   { k, t: 'go',      label, desc, to, val() }
//   { k, t: 'action',  label, desc, act, fn(ctx), danger }
//   { k, t: 'text',    textKey }
import { extendSpec } from './config.js'
import { log } from './log.js'

const FEATURES = {}
const GROUPS = []
const INITS = []

export function defineFeature(def) {
  if (!def || !def.id) return null
  if (FEATURES[def.id]) return FEATURES[def.id]
  FEATURES[def.id] = def
  if (def.spec) {
    try { extendSpec(def.spec) } catch (e) { log('功能', def.id + ' 配置项注册失败: ' + (e && e.message ? e.message : e)) }
  }
  if (def.settings && def.settings.length) {
    GROUPS.push({ id: 'f_' + def.id, title: def.title || def.id, icon: def.icon || 'set_about', rows: def.settings })
  }
  if (typeof def.init === 'function') INITS.push(def)
  return def
}

export function featureList() {
  const out = []
  for (const k in FEATURES) if (FEATURES.hasOwnProperty(k)) out.push(FEATURES[k])
  return out
}
export function feature(id) { return FEATURES[id] || null }
export function settingsGroups() { return GROUPS }

/** 启动钩子; 单个失败不影响其它功能与应用启动 */
export function runFeatureInits() {
  for (let i = 0; i < INITS.length; i++) {
    try { INITS[i].init() } catch (e) {
      log('功能', INITS[i].id + ' 初始化失败: ' + (e && e.message ? e.message : e))
    }
  }
  return INITS.length
}
