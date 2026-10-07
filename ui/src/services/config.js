// 应用设置持久化: **bilibili.db 的 kv 表** (用户要求: 和登录信息一起存数据库)
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

import { bilinet } from './native.js'
import { log } from './log.js'
import { kvReady, kvGet, kvSet } from './store.js'

export const CFG_PATH = '/userdisk/xiro/bilibilipan.cfg.json'
// 兼容别名: 0.9.57 之前的页面 (settings.vue) 用的是这个名字
export const CONFIG_PATH = CFG_PATH
// 旧原生播放器 (gstplayer) 读的纯文本音画补偿值. 保留写入以兼容设备上残留的旧包,
// 新播放链路 (框架内置 <video>) 不读它.
export const BT_PATH_CONST = '/userdisk/xiro/btaudio_ms'

var CFG_VERSION = 2
// 配置在 kv 表里占一行: k='settings', v=整份 JSON.
// 为什么不逐项建列: 配置项会随版本增删, 逐列的话每次加设置都要写迁移.
var KV_KEY = 'settings'

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
// 这份缓存是从"文件兜底"路径来的吗? 数据库晚于配置就绪时, 用它判断要不要补一次迁移.
var loadedFromFile = false

// 删文件. ★ bilinet **没有删除 API** —— 它的文件能力只有 readFile/writeFile
// (native/bilinet/src/BiliNet.cpp 的 SetProtoMethod 表里就这两个).
// 所以走设备 shell 的 rm; 删不掉就退而求其次把内容清空 ——
// 目标只是"它不再是一份能被读到的旧配置", 不必强求文件消失.
function removeFile(p) {
  try { bilinet.exec('rm -f ' + p) } catch (e) {}
  try { if (bilinet.readFile(p)) bilinet.writeFile(p, '') } catch (e2) {}
}

// 把当前内存里的配置写进数据库, 成功后删掉旧文件.
// 抽出来是因为它有两个触发点: 首次 loadConfig (库里还没有) 和"数据库晚就绪"的补迁移.
function migrateToDb(c) {
  if (!kvReady()) return false
  var payload = { _v: CFG_VERSION }
  for (var k in c) if (c.hasOwnProperty(k)) payload[k] = c[k]
  try {
    if (!kvSet(KV_KEY, JSON.stringify(payload))) return false
  } catch (e) { return false }
  loadedFromFile = false
  removeFile(CFG_PATH)
  log('设置', '旧配置文件已迁移进数据库并删除')
  return true
}

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
  if (cache) {
    // ★ 兜底: app.js 里的顺序已经保证"先开库再读配置", 但只要有任何一条路径在
    //   数据库就绪前先读了配置, 缓存就会一直停在文件版本 —— 这里补一次迁移.
    //   真机踩过: kv 表建出来了却一行数据都没有, cfg.json 一直留着, 就是这个时序.
    if (loadedFromFile && kvReady()) migrateToDb(cache)
    return cache
  }
  cache = defaults()
  // 1) 首选数据库
  try {
    if (kvReady()) {
      var s = kvGet(KV_KEY)
      if (s) { cache = parse(s); return cache }
      // 库里还没有 -> 看看有没有旧版本留下的 JSON 文件, 有就迁移过来
      if (hasFs()) {
        var legacy = bilinet.readFile(CFG_PATH)
        if (legacy) {
          cache = parse(legacy)
          loadedFromFile = true
          migrateToDb(cache)
          return cache
        }
      }
    }
  } catch (e) {
    log('设置', '读数据库失败, 退回默认值: ' + (e && e.message ? e.message : e))
  }
  // 2) 数据库不可用 (老设备/打开失败): 仍然读旧 JSON 文件, 保证应用能起来
  try {
    if (hasFs()) {
      var s2 = bilinet.readFile(CFG_PATH)
      if (s2) { cache = parse(s2); loadedFromFile = true }
    }
  } catch (e2) {
    log('设置', '读取配置失败, 用默认值: ' + (e2 && e2.message ? e2.message : e2))
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
  var payload = { _v: CFG_VERSION }
  for (var k in c) if (c.hasOwnProperty(k)) payload[k] = c[k]
  var json = JSON.stringify(payload)
  var okDb = false
  try { okDb = kvReady() ? kvSet(KV_KEY, json) : false } catch (e) {
    log('设置', '写数据库失败: ' + (e && e.message ? e.message : e))
  }
  // 数据库写不进去时才落文件 —— 不是并行双写, 避免"改一处、两处不一致"
  if (!okDb) {
    try {
      if (hasFs()) { bilinet.writeFile(CFG_PATH, json); loadedFromFile = true }
    } catch (e2) {
      log('设置', '写配置文件失败: ' + (e2 && e2.message ? e2.message : e2))
    }
  }
  // 兼容: 设备上残留的旧原生播放器读这个纯文本 (与配置本体无关, 一直写)
  try { if (hasFs()) bilinet.writeFile(BT_PATH_CONST, String(c.btaudioMs)) } catch (e3) {}
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
