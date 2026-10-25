// 设置 (全新实现) —— 单一 SPEC 表 + 功能模块可注册扩展
//
// SPEC 同时是三件事的来源: 默认值 / 取值域校验 / 设置页渲染.
// 功能模块通过 extendSpec() 注册自己的键 (见 core/feature.js), 共享文件不再被并行改动.
//
// 值类型: bool | enum | int | str
//   bool                开关
//   enum [a,b,c]        单选
//   int  [min,max]      整数 (越界夹紧)
//   str  [maxLen]       字符串 (超长截断)

import { kvGetJson, kvSetJson } from './store.js'
import { log } from './log.js'

const KEY = 'cfg'

const SPEC = {
  // ---------- 外观 ----------
  themeSeed: ['bili', 'enum', ['bili', 'blue', 'teal', 'green', 'amber', 'violet', 'red', 'slate']],
  themeMode: ['dark', 'enum', ['dark', 'light', 'auto']],
  pureBlack: [false, 'bool'],
  radiusStyle: ['std', 'enum', ['flat', 'std', 'round']],
  density: ['std', 'enum', ['compact', 'std', 'cozy']],
  fontScale: ['std', 'enum', ['sm', 'std', 'lg']],
  motion: [true, 'bool'],

  // ---------- 播放 ----------
  defaultRate: [1, 'enum', [0.5, 0.75, 1, 1.25, 1.5, 2]],
  // 默认清晰度 (qn). 80 = 1080P, 是目标设备的解码上限 (见 services/api.js DEVICE_MAX_QN)
  defaultQuality: [80, 'int', [16, 80]],
  // 音频输出: auto = 有已连接的蓝牙就自动切过去, 否则扬声器
  audioRoute: ['auto', 'enum', ['auto', 'speaker', 'bluetooth']],
  // 起播时抢占音频: 系统没有音频焦点 API, 用全局 stopVideoPlayer 停掉别的播放 (见 services/audio.js)
  audioPreempt: [true, 'bool'],
  autoQuality: [false, 'bool'],
  resumePlay: [true, 'bool'],
  skipIntroSec: [0, 'int', [0, 300]],
  keepAwake: [true, 'bool'],
  mirrorToExternal: [false, 'bool'],

  // ---------- 网络与内容 ----------
  httpTimeout: [15, 'int', [5, 60]],
  imgQuality: ['std', 'enum', ['low', 'std', 'high']],
  showStat: [true, 'bool'],
  autoLoadComments: [true, 'bool'],
  // 上次成功发现的电脑端服务 IP (自动发现后缓存, 免手填)
  pcIp: ['', 'str', [64]],
  logLevel: ['info', 'enum', ['off', 'error', 'info', 'debug']]
}

let cache = null

function kindOf(k) { return SPEC[k] ? SPEC[k][1] : null }

function coerce(k, v) {
  const s = SPEC[k]
  if (!s) return v
  const kind = s[1]
  if (kind === 'bool') return !!v
  if (kind === 'enum') {
    for (let i = 0; i < s[2].length; i++) if (String(s[2][i]) === String(v)) return s[2][i]
    return s[0]
  }
  if (kind === 'int') {
    let n = Math.round(Number(v))
    if (!isFinite(n)) return s[0]
    if (n < s[2][0]) n = s[2][0]
    if (n > s[2][1]) n = s[2][1]
    return n
  }
  if (kind === 'str') {
    const t = String(v == null ? '' : v)
    return t.length > s[2][0] ? t.substring(0, s[2][0]) : t
  }
  return v
}

export function defaults() {
  const o = {}
  for (const k in SPEC) if (SPEC.hasOwnProperty(k)) o[k] = SPEC[k][0]
  return o
}
export function specOf(k) { return SPEC[k] || null }

/** 功能模块注册自己的设置键 (已存在的键不会被覆盖) */
export function extendSpec(map) {
  if (!map) return 0
  let n = 0
  for (const k in map) {
    if (!map.hasOwnProperty(k)) continue
    if (SPEC[k]) continue
    SPEC[k] = map[k]
    n++
  }
  return n
}

export function loadConfig() {
  if (cache) return cache
  const raw = kvGetJson(KEY, null)
  const out = defaults()
  if (raw && typeof raw === 'object') {
    for (const k in raw) if (raw.hasOwnProperty(k)) out[k] = coerce(k, raw[k])
  }
  cache = out
  return cache
}

export function getCfg(k) { return loadConfig()[k] }

export function allCfg() {
  const c = loadConfig()
  const o = {}
  for (const k in c) if (c.hasOwnProperty(k)) o[k] = c[k]
  return o
}

function persist() {
  kvSetJson(KEY, cache)
}

export function setCfg(k, v) {
  const c = loadConfig()
  c[k] = specOf(k) ? coerce(k, v) : v
  persist()
  log('设置', k + ' = ' + c[k])
  return allCfg()
}

export function setCfgMany(pairs) {
  const c = loadConfig()
  const ks = []
  for (const k in pairs) if (pairs.hasOwnProperty(k)) { c[k] = specOf(k) ? coerce(k, pairs[k]) : pairs[k]; ks.push(k) }
  persist()
  log('设置', '批量更新 ' + ks.join(','))
  return allCfg()
}

export function resetConfig() {
  cache = defaults()
  persist()
  return allCfg()
}

/** 只给离线测试: 丢掉缓存强制重读 */
export function __reloadForTest() { cache = null }
