// 运行日志: 追加写入 /userdisk/xiro/bilibili.log  (与 config.js 的配置同目录, HANDOVER §3)
//
// 为什么不用系统 fs JSAPI: 它只提供 readdir/stat/exists/readFile/mkdir/rm, **没有写入接口**,
// 且限定在应用 data 目录. 这里改用 bilinet 原生模块的 readFile/writeFile/mkdirs
// (直接 libc 打开绝对路径), 不受该限制.
//
// 格式沿用设备 /userdisk/xiro/ 下其他应用的约定:  [09-12 22:03:15][模块] 内容
//
// ---- 本版四项优化 (用户要求: 清无用日志 + 优化日志提交) ----
// 1) 分级 off/error/info/debug (设置页可选, 持久化在 config.logLevel, 默认 info).
//    debug 才写逐条网络/状态流水 —— 那些是排障期产物, 常态是纯噪音.
// 2) 批量落盘: 行先入内存队列, 200ms 或 24 行才 writeFile 一次. 旧实现每条日志一次
//    open+write+close, 在这台设备上是实打实的 IO 开销, 批量后写入次数降一个数量级.
// 3) 去重: 连续完全相同的行折叠成「xxx (重复 N 次)」.
// 4) 轮转: 主文件超过 96KB 时整份搬到 bilibili.log.1, 主文件只留最近 400 行.
//    (旧实现是运行中超过 600 行就截断, 会周期性丢掉最早的现场)
//
// 安全: Cookie (SESSDATA / bili_jct / DedeUserID) 一律脱敏后再落盘.

import { bilinet } from './native.js'

const LOG_DIR = '/userdisk/xiro'
const LOG_PATH = '/userdisk/xiro/bilibili.log'
const PREV_PATH = '/userdisk/xiro/bilibili.log.1'
const KEEP_ON_BOOT = 200
const KEEP_ON_ROTATE = 400
const MAX_BYTES = 96 * 1024
const FLUSH_MS = 200
const FLUSH_LINES = 24

const LEVELS = { off: 0, error: 1, info: 2, debug: 3 }
const LV_ERR = 1
const LV_INFO = 2
const LV_DEBUG = 3

// 原始 console.log 的私有引用: 覆盖 console.log 之后 emit() 还得能真的打出去,
// 否则会自递归.
const rawConsoleLog = (typeof console !== 'undefined' && console.log) ? console.log : function () {}

let ready = false
let failed = false
let level = LEVELS.info
let queue = []
let flushTimer = null
let lastLine = ''
let lastCount = 0

function pad(n) { return n < 10 ? '0' + n : '' + n }

function timeStr() {
  const d = new Date()
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

const SECRET_KEYS = ['SESSDATA=', 'bili_jct=', 'DedeUserID=', 'SESSDATA%3D', 'bili_jct%3D']
function sanitize(s) {
  let out = String(s)
  for (let i = 0; i < SECRET_KEYS.length; i++) {
    const k = SECRET_KEYS[i]
    let pos = out.indexOf(k)
    while (pos >= 0) {
      const end = pos + k.length
      let len = 0
      while (end + len < out.length && len < 256) {
        const c = out.charAt(end + len)
        if (c === ';' || c === '&' || c === ' ' || c === "'" || c === '"' || c === ',' || c === '%') break
        len++
      }
      out = out.substring(0, end) + '***' + out.substring(end + len)
      pos = out.indexOf(k, end + 3)
    }
  }
  return out
}

function hasFileApi() {
  return !!(bilinet && typeof bilinet.writeFile === 'function' && typeof bilinet.readFile === 'function')
}

function splitLines(text) {
  const arr = String(text).split(String.fromCharCode(10))
  while (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
  return arr
}
const NL = String.fromCharCode(10)

function rawWrite(text, append) {
  try { return !!bilinet.writeFile(LOG_PATH, text, append) } catch (e) { return false }
}

function rotateIfNeeded() {
  try {
    const old = bilinet.readFile(LOG_PATH)
    if (!old || old.length < MAX_BYTES) return 0
    bilinet.writeFile(PREV_PATH, old)
    const arr = splitLines(old)
    const keep = arr.length > KEEP_ON_ROTATE ? arr.slice(arr.length - KEEP_ON_ROTATE) : arr
    rawWrite(keep.join(NL) + NL, false)
    return keep.length
  } catch (e) { return 0 }
}

function flush() {
  flushTimer = null
  if (!ready || failed || queue.length === 0) { queue = []; return }
  const text = queue.join(NL) + NL
  queue = []
  if (!rawWrite(text, true)) {
    failed = true
    try { console.warn('[log] 写入失败, 停止落盘') } catch (e) {}
    return
  }
  rotateIfNeeded()
}

function schedule() {
  if (flushTimer) return
  flushTimer = setTimeout(flush, FLUSH_MS)
}

function emit(tag, msg, lv) {
  if (lv > level) return
  const line = '[' + timeStr() + '][' + tag + '] ' + sanitize(msg)
  // 设备侧只有 console.warn 会进 /userdata/applog 的框架日志, 所以错误走 warn
  try {
    if (lv <= LV_ERR) console.warn(line)
    else rawConsoleLog(line)
  } catch (e) {}
  if (!ready || failed) return
  if (line === lastLine) { lastCount++; return }
  if (lastCount > 0) queue.push(lastLine + ' (重复 ' + lastCount + ' 次)')
  lastLine = line
  lastCount = 0
  queue.push(line)
  if (queue.length >= FLUSH_LINES) { flush(); return }
  schedule()
}

/** 初始化日志 (在 App onLaunch 里调用一次) */
export function initLog(extra) {
  if (ready) return          // 重试调用是幂等的 (app.js 在 JSAPI 未就绪时会退避重试)
  if (!hasFileApi()) {
    failed = true
    try { console.warn('[log] bilinet 缺少文件接口, 日志不可用') } catch (e) {}
    return
  }
  try {
    bilinet.mkdirs(LOG_DIR)
    const old = bilinet.readFile(LOG_PATH)
    if (old) {
      const arr = splitLines(old)
      if (arr.length > KEEP_ON_BOOT) rawWrite(arr.slice(arr.length - KEEP_ON_BOOT).join(NL) + NL, false)
    }
    ready = true
  } catch (e) {
    failed = true
    try { console.warn('[log] 初始化失败: ' + e) } catch (e2) {}
    return
  }
  installConsoleBridge()
  emit('应用', '启动' + (extra ? ' ' + extra : ''), LV_INFO)
}

/**
 * 把 console.log 收编成 debug 级日志.
 *
 * 为什么需要: 全仓库有 80+ 处 console.log(排障期留下的网络/状态流水), 逐条删风险高、
 * 收益低; 而设备侧的框架日志**只收 console.warn**, console.log 本来就进不去任何地方,
 * 纯粹是字符串拼接开销. 收编后:
 *   - 常态 (info 级): 一行不落盘, 也不拼字符串, 等于无声;
 *   - 排障时把日志级别调到 debug: 这些流水完整回来, 而且带模块与时间戳.
 * 这样"清掉无用日志"不等于"丢掉可诊断性".
 */
export function installConsoleBridge() {
  try {
    console.log = function () {
      if (level < LV_DEBUG) return
      let msg = ''
      for (let i = 0; i < arguments.length; i++) {
        msg += (i > 0 ? ' ' : '') + safeStr(arguments[i])
      }
      emit('控制台', msg, LV_DEBUG)
    }
  } catch (e) {}
}

function safeStr(v) {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch (e) { return String(v) }
}

/** 设置日志级别 (设置页「日志级别」) */
export function setLogLevel(name) {
  const lv = LEVELS[name]
  level = (lv === undefined) ? LEVELS.info : lv
  emit('应用', '日志级别 = ' + name, LV_INFO)
  return level
}

export function getLogLevel() {
  for (const k in LEVELS) if (LEVELS[k] === level) return k
  return 'info'
}

/** 常规信息 (默认级别下落盘) */
export function log(tag, msg) { emit(tag, msg, LV_INFO) }
/** 出错: 任何级别都落盘, 并走 console.warn 进设备框架日志 */
export function logError(tag, msg) { emit(tag, msg, LV_ERR) }
/** 调试流水: 只有 debug 级别才落盘 */
export function logDebug(tag, msg) { emit(tag, msg, LV_DEBUG) }
/** 立即把队列写盘 (页面卸载/报障前的保险) */
export function flushLog() { flush() }

export function logStatus() {
  if (failed) return '日志不可用'
  if (!ready) return '日志未初始化'
  return '日志 ' + LOG_PATH + ' · 级别 ' + getLogLevel()
}

export function logPath() { return LOG_PATH }
export function logPrevPath() { return PREV_PATH }

/** 清空日志 (设置页「清空日志」/ 报障前重置现场) */
export function clearLog() {
  queue = []
  lastLine = ''
  lastCount = 0
  try {
    if (hasFileApi()) { bilinet.writeFile(LOG_PATH, ''); bilinet.writeFile(PREV_PATH, '') }
    return true
  } catch (e) { return false }
}

/** 读回最近日志行 (设置页预览 / 报障时拼装) */
export function readLog(maxLines) {
  try {
    if (!hasFileApi()) return ''
    const arr = splitLines(bilinet.readFile(LOG_PATH))
    const n = maxLines || 40
    return (arr.length > n ? arr.slice(arr.length - n) : arr).join(NL)
  } catch (e) { return '' }
}