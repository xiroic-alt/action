// 本地存储 (全新实现) —— 一张 kv 表撑起全部持久化
//
// 表: kv(k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER)
// 命名空间 (key 前缀):
//   cfg:*        设置项 (整份 JSON 存一行, 见 config.js)
//   auth         登录态
//   progress:*   播放进度 (key = bvid)
//   search:hist  搜索历史 (JSON 数组)
//   remark:*     UP 主备注
//   block:*      屏蔽词/正则 (JSON 数组)
//
// 为什么不用关系表: 配置项与业务数据都会随版本增删, 逐列建表每次都要迁移;
// 单表 KV 只做"读-改-写", 版本兼容只体现在**值**的解析上.
//
// 数据库不可用时自动退回文件 (/userdisk/pilipro/kv.json), 保证应用仍能起.

import { bilinet } from '../services/native.js'
import { dataDir, dbDir, dbPath as dbPathOf, kvFilePath, ensureDirs } from './paths.js'
// ★ 同 log.js: paths.js 的 dbPath 是函数, 必须调用 (否则原生 dbOpen 收到函数直接失败)
const DB_PATH = dbPathOf()

let opened = false
let failed = false
let mem = null          // 文件兜底时的内存副本

function hasDb() {
  return !!(bilinet && typeof bilinet.dbOpen === 'function' &&
    typeof bilinet.dbExec === 'function' && typeof bilinet.dbQuery === 'function')
}
function hasFs() {
  return !!(bilinet && typeof bilinet.readFile === 'function' && typeof bilinet.writeFile === 'function')
}
function q(v) { return String(v == null ? '' : v).replace(/'/g, "''") }

function fileLoad() {
  if (mem) return mem
  mem = {}
  try {
    if (hasFs()) {
      const raw = bilinet.readFile(kvFilePath())
      if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') mem = o }
    }
  } catch (e) { mem = {} }
  return mem
}
function fileSave() {
  try {
    if (hasFs()) {
      bilinet.mkdirs(dataDir())
      bilinet.writeFile(kvFilePath(), JSON.stringify(mem || {}))
    }
  } catch (e) {}
}

export function initStore() {
  if (opened || failed) return opened
  if (!hasDb()) { failed = true; return false }
  ensureDirs(bilinet)
  if (!bilinet.dbOpen(DB_PATH)) { failed = true; return false }
  const ok = bilinet.dbExec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL, updated_at INTEGER)')
  if (!ok) { failed = true; return false }
  opened = true
  return true
}

export function storeReady() { return opened }
export function storeStatus() { return opened ? ('数据库 ' + DB_PATH) : (hasDb() ? '数据库打开失败 (退回文件)' : '数据库不可用 (退回文件)') }

export function kvGet(k) {
  if (opened) {
    try {
      const rows = JSON.parse(bilinet.dbQuery("SELECT v FROM kv WHERE k = '" + q(k) + "'"))
      if (!rows || !rows.length) return null
      return String(rows[0].v)
    } catch (e) { return null }
  }
  const f = fileLoad()
  return f[k] == null ? null : String(f[k])
}

export function kvSet(k, v) {
  const val = String(v == null ? '' : v)
  if (opened) {
    try {
      return !!bilinet.dbExec("INSERT OR REPLACE INTO kv (k, v, updated_at) VALUES ('" + q(k) + "', '" + q(val) + "', " + Math.floor(Date.now() / 1000) + ')')
    } catch (e) { return false }
  }
  const f = fileLoad()
  f[k] = val
  fileSave()
  return true
}

export function kvDel(k) {
  if (opened) {
    try { return !!bilinet.dbExec("DELETE FROM kv WHERE k = '" + q(k) + "'") } catch (e) { return false }
  }
  const f = fileLoad()
  delete f[k]
  fileSave()
  return true
}

/** 读 JSON 值 (坏数据返回 fallback, 不让调用方处理异常) */
export function kvGetJson(k, fallback) {
  const raw = kvGet(k)
  if (!raw) return fallback
  try { const o = JSON.parse(raw); return o == null ? fallback : o } catch (e) { return fallback }
}
export function kvSetJson(k, obj) { return kvSet(k, JSON.stringify(obj)) }

// ---------------- 播放进度 ----------------
const PROGRESS_MAX = 120

export function getProgress(bvid) {
  const raw = kvGet('progress:' + bvid)
  const n = Number(raw)
  return isFinite(n) && n > 0 ? n : 0
}
export function setProgress(bvid, sec, durSec) {
  const s = Math.floor(Number(sec) || 0)
  const d = Math.floor(Number(durSec) || 0)
  if (!bvid) return
  if (s < 5) return
  if (d > 30 && s > d - 10) { kvDel('progress:' + bvid); return }
  kvSet('progress:' + bvid, String(s))
  // 顺带维护一个索引 (最近看过的 bvid 列表, 供"继续看"用)
  const idx = kvGetJson('progress:index', [])
  const next = [bvid]
  for (let i = 0; i < idx.length && next.length < PROGRESS_MAX; i++) if (idx[i] !== bvid) next.push(idx[i])
  kvSetJson('progress:index', next)
}
export function clearProgress(bvid) { kvDel('progress:' + bvid) }

// ---------------- 搜索历史 ----------------
const HIST_MAX = 20

export function getSearchHistory(n) {
  const list = kvGetJson('search:hist', [])
  return list.slice(0, n || 12)
}
export function addSearchHistory(kw) {
  const k = String(kw == null ? '' : kw).trim()
  if (!k) return getSearchHistory(12)
  const list = kvGetJson('search:hist', [])
  const next = [k]
  for (let i = 0; i < list.length && next.length < HIST_MAX; i++) if (list[i] !== k) next.push(list[i])
  kvSetJson('search:hist', next)
  return next.slice(0, 12)
}
export function clearSearchHistory() { kvSetJson('search:hist', []) }

/** 实际生效的数据库路径 (数据库不可用时退回文件) */
export function dbPathInUse() { return opened ? DB_PATH : kvFilePath() }
