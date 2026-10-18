// 日志模块 (全新实现)
//
// 设计:
//   - 五级: off < error < warn < info < debug
//   - 落盘路径 /userdisk/pilipro/pilipro.log (与配置/数据库同目录, 一条链路)
//   - 批量写: 先入内存队列, 200ms 或 20 行才写一次 (笔闪存 IO 贵)
//   - 体积轮转: 96KB -> .log.1, 主文件留 400 行
//   - 排障开关: 常态 info, debug 留在日志里不落盘
//
// 为什么不用 console.log: 设备框架只收 console.warn (HANDOVER), console.log 白干还占拼接开销.
// 这里把 console.log 桥接成 debug 级, 排障时把级别调到 debug 就全回来了.

import { bilinet } from '../services/native.js'
import { dataDir, logPath as LOG_PATH, logPrevPath as PREV_PATH, ensureDirs } from './paths.js'
// 路径变量 (小写名向 paths.js 对齐): 模块内统一叫 logPath / logPrevPath
const logPath = LOG_PATH
const logPrevPath = PREV_PATH
const MAX_LINES = 400
const MAX_BYTES = 96 * 1024

const LV = { off: 0, error: 1, warn: 2, info: 3, debug: 4 }

let level = 3            // 默认 info
let queue = []
let timer = null
let lastLine = ''
let repeat = 0

function pad(n) { return n < 10 ? '0' + n : '' + n }

function ts() {
  const d = new Date()
  return '[' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']'
}

function emit(tag, msg, lv) {
  if (lv > level) return
  const line = ts() + '[' + tag + '] ' + String(msg)
  if (line === lastLine) { repeat++; return }
  flushRepeat()
  lastLine = line
  queue.push(line)
  if (queue.length >= 20) drain()
  else if (!timer && typeof setTimeout === 'function') {
    timer = setTimeout(drain, 200)
  }
}

function flushRepeat() {
  if (repeat > 0) {
    queue.push(lastLine + ' (重复 ' + repeat + ' 次)')
    repeat = 0
  }
}

function drain() {
  if (timer) { clearTimeout(timer); timer = null }
  flushRepeat()
  if (!queue.length) return
  const lines = queue.join('\n') + '\n'
  queue = []
  try {
    if (!bilinet || typeof bilinet.readFile !== 'function' || typeof bilinet.writeFile !== 'function') return
    ensureDirs(bilinet)
    // 轮转: 只读"是否存在"; 读不到就当不存在
    let cur = ''
    try { cur = bilinet.readFile(logPath) || '' } catch (e) {}
    const next = cur + lines
    if (next.length > MAX_BYTES) {
      // 搬走旧的: 没有 rename, 只能读完旧文件截断写回
      try { bilinet.writeFile(logPrevPath, cur.substring(cur.length - 12000)) } catch (e) {}
      try { bilinet.writeFile(logPath, lines.length > 12000 ? lines.substring(lines.length - 12000) : lines) } catch (e) {}
      return
    }
    const nl = next.split('\n').length
    const trimmed = nl > MAX_LINES + 120 ? next.split('\n').slice(-MAX_LINES).join('\n') + '\n' : next
    bilinet.writeFile(logPath, trimmed)
  } catch (e) {}
}

export function initLog(tag) {
  emit('应用', tag)
  ensureDirs(bilinet)
  return logPath
}

export function setLogLevel(v) {
  level = LV[v] == null ? 3 : LV[v]
}

export function log(tag, msg) { emit(tag, msg, 3) }        // info
export function logWarn(tag, msg) { emit(tag, msg, 2) }    // warn
export function logError(tag, msg) { emit(tag, msg, 1) }   // error
export function logDebug(tag, msg) { emit(tag, msg, 4) }   // debug (常态不落盘)
export function logStatus() { return '日志 ' + logPath }

// console 收编: 桥接成 debug 级, 排障时开 debug 就完整回来
export function installConsoleBridge() {
  if (typeof console === 'undefined' || console.__pilipro) return
  try {
    const orig = { log: console.log, warn: console.warn, error: console.error }
    console.__pilipro = true
    console.log = function () { emit('console', Array.prototype.join.call(arguments, ' '), 4) }
    console.warn = function () { emit('console', Array.prototype.join.call(arguments, ' '), 2) }
    console.error = function () { emit('console', Array.prototype.join.call(arguments, ' '), 1) }
    orig.warn && (console.__orig = orig)
  } catch (e) {}
}
