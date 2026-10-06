// 应用设置持久化: /userdisk/xiro/bilibilipan.cfg.json
//
// 路径约定 (HANDOVER §3 设备路径): 本应用的日志 / 数据库 / 配置统一放 /userdisk/xiro,
// 与 log.js(LOG_PATH) 同目录. 同目录还有另一个应用 (8001865309000001) 写的
// status.json / wifi.log —— 不要重名, 不要动它们.
//
// 为什么自建: 系统 storage JSAPI 只能存字符串且作用域受限, 这里用 bilinet 原生
// readFile/writeFile 直接写绝对路径, 与 log.js 一致.
//
// 设计要点:
// - **单一 SPEC 表**既是默认值来源、也是类型/取值校验来源、也是设置页渲染来源
//   (pages/settings 与 services/settings-schema.js 都从这里取), 避免三处漂移.
// - 读取时逐项 coerce: 配置文件损坏 / 手改 / 旧版本缺字段都不会让应用起不来.
// - 未知字段原样保留并写回 —— 回滚到旧版本时不会把新版本的键清掉.
// - 版本号写进文件, 便于以后做迁移.

import { bilinet } from 'bilinet'
import { log } from './log.js'

export const CFG_PATH = '/userdisk/xiro/bilibilipan.cfg.json'
// 兼容别名: 0.9.57 之前的页面 (settings.vue) 用的是这个名字
export const CONFIG_PATH = CFG_PATH
// 旧原生播放器 (gstplayer) 读的纯文本音画补偿值. 保留写入以兼容设备上残留的旧包,
// 新播放链路 (框架内置 <video>) 不读它.
export const BT_PATH_CONST = '/userdisk/xiro/btaudio_ms'

var CFG_VERSION = 2

// ---- 取值域 ----
// 每一项: [默认值, 类型, 约束]
//   bool                     开关
//   enum   [a, b, c]         单选
//   int    [min, max]        整数 (超界夹紧)
//   str    [maxLen]          字符串 (超长截断)
var SPEC = {
  // ---------- 外观 (M3) ----------
  themeSeed: ['rose', 'enum', ['rose', 'blue', 'teal', 'green', 'amber', 'violet', 'red', 'slate']],
  themeMode: ['dark', 'enum', ['dark', 'light', 'auto']],
  contrastLevel: [0, 'enum', [0, 1]],
  pureBlack: [false, 'bool'],
  radiusStyle: ['std', 'enum', ['flat', 'std', 'round']],
  density: ['std', 'enum', ['compact', 'std', 'cozy']],
  fontScale: ['std', 'enum', ['sm', 'std', 'lg']],
  motion: [true, 'bool'],
  navPos: ['left', 'enum', ['left', 'top']],

  // ---------- 播放 ----------
  playSource: ['auto', 'enum', ['auto', 'html5', 'web', 'backup']],
  cdnNode: ['default', 'str', [96]],
  customHost: ['', 'str', [96]],
  autoFallback: [true, 'bool'],
  probeBytesKb: [512, 'int', [64, 4096]],
  probeTimeoutSec: [8, 'int', [3, 30]],
  defaultRate: [1, 'enum', [0.5, 0.75, 1, 1.25, 1.5, 2]],
  resumePlay: [true, 'bool'],
  skipIntroSec: [0, 'int', [0, 300]],
  btaudioMs: [200, 'int', [-500, 800]],
  keepAwake: [true, 'bool'],

  // ---------- 网络 / 内容 ----------
  imgQuality: ['std', 'enum', ['low', 'std', 'high']],
  httpTimeout: [15, 'int', [5, 60]],
  defaultTab: ['recommend', 'enum', ['recommend', 'hot', 'search', 'dynamic', 'mine']],
  showStat: [true, 'bool'],
  logLevel: ['info', 'enum', ['off', 'error', 'info', 'debug']]
}

function typeOf(key) { return SPEC[key] ? SPEC[key][1] : null }

function coerce(key, v) {
  var s = SPEC[key]
  if (!s) return v                      // 未知键: 原样保留
  var kind = s[1]
  if (kind === 'bool') return !!v
  if (kind === 'enum') {
    for (var i = 0; i < s[2].length; i++) if (s[2][i] === v) return v
    return s[0]
  }
  if (kind === 'int') {
    var n = Math.round(Number(v))
    if (!isFinite(n)) return s[0]
    if (n < s[2][0]) n = s[2][0]
    if (n > s[2][1]) n = s[2][1]
    return n
  }
  if (kind === 'str') {
    var t = String(v == null ? '' : v)
    var max = s[2][0]
    return t.length > max ? t.substring(0, max) : t
  }
  return v
}

export function defaults() {
  var o = {}
  for (var k in SPEC) if (SPEC.hasOwnProperty(k)) o[k] = SPEC[k][0]
  return o
}

export function specOf(key) { return SPEC[key] || null }

var cache = null

function hasFs() {
  return !!(bilinet && typeof bilinet.readFile === 'function' && typeof bilinet.writeFile === 'function')
}

function parse(raw) {
  var o = null
  try { o = JSON.parse(raw) } catch (e) { o = null }
  var out = defaults()
  if (o && typeof o === 'object') {
    for (var k in o) {
      if (!o.hasOwnProperty(k)) continue
      out[k] = coerce(k, o[k])
    }
  }
  return out
}

export function loadConfig() {
  if (cache) return cache
  cache = defaults()
  try {
    if (hasFs()) {
      var s = bilinet.readFile(CFG_PATH)
      if (s) cache = parse(s)
    }
  } catch (e) {
    log('设置', '读取配置失败, 用默认值: ' + (e && e.message ? e.message : e))
  }
  return cache
}

export function getCfg(key) {
  return loadConfig()[key]
}

export function allCfg() {
  // 返回副本, 调用方拿到的不是内部引用
  var c = loadConfig()
  var o = {}
  for (var k in c) if (c.hasOwnProperty(k)) o[k] = c[k]
  return o
}

export function saveConfig() {
  var c = loadConfig()
  try {
    if (hasFs()) {
      var payload = { _v: CFG_VERSION }
      for (var k in c) if (c.hasOwnProperty(k)) payload[k] = c[k]
      bilinet.writeFile(CFG_PATH, JSON.stringify(payload))
      // 兼容: 旧原生播放器读的纯文本
      bilinet.writeFile(BT_PATH_CONST, String(c.btaudioMs))
    }
  } catch (e) {
    log('设置', '写入配置失败: ' + (e && e.message ? e.message : e))
  }
  return c
}

// 返回**副本**: 页面写 this.cfg = setCfg(...) 时, 返回同一个 cache 引用不会触发
// Vue2 的依赖通知 (newVal === value 直接 return), 开关点完界面不刷新.
export function setCfg(key, value) {
  var c = loadConfig()
  var v = specOf(key) ? coerce(key, value) : value
  c[key] = v
  saveConfig()
  log('设置', key + ' = ' + c[key])
  return allCfg()
}

// 批量写入 (设置页一次改多项时用, 只落盘一次)
export function setCfgMany(pairs) {
  var c = loadConfig()
  var ks = []
  for (var k in pairs) { if (!pairs.hasOwnProperty(k)) continue; c[k] = specOf(k) ? coerce(k, pairs[k]) : pairs[k]; ks.push(k) }
  saveConfig()
  log('设置', '批量更新 ' + ks.join(','))
  return allCfg()
}

export function resetConfig() {
  cache = defaults()
  saveConfig()
  log('设置', '恢复默认设置')
  return allCfg()
}

// 只给离线回归用: 丢掉内存缓存, 强制下次 loadConfig 重新读盘
export function __reloadForTest() { cache = null }

// 主题等只读派生值统一从这里走, 保证"配置 -> 观感"只有一条路径
export function themeCfg() {
  var c = loadConfig()
  return { seed: c.themeSeed, mode: c.themeMode, contrast: c.contrastLevel, pureBlack: c.pureBlack }
}
