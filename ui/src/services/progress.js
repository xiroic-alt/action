// 观看进度: /userdisk/xiro/progress.json  (与日志/配置同目录, HANDOVER §3)
//
// 为什么要自建: 系统 storage JSAPI 形态不确定, 而 bilinet 的 readFile/writeFile 是
// 已在生产用的路径 (config.js / log.js 都走它). 数据很小 (最多 80 条), 直接整份读写.
//
// 写入策略: 内存里攒, 每 5s 或换视频/退出页面时才落盘 —— 播放中每秒写一次文件
// 在这台设备上是纯粹的浪费.
import { bilinet } from './native.js'
import { logDebug } from './log.js'

const PATH = '/userdisk/xiro/progress.json'
const MAX = 80

let cache = null
let dirty = false
let lastSave = 0

function hasFs() {
  return !!(bilinet && typeof bilinet.readFile === 'function' && typeof bilinet.writeFile === 'function')
}

function load() {
  if (cache) return cache
  cache = { list: [], at: 0 }
  try {
    if (hasFs()) {
      const s = bilinet.readFile(PATH)
      if (s) {
        const o = JSON.parse(s)
        if (o && o.list && o.list.length) cache = o
      }
    }
  } catch (e) { cache = { list: [], at: 0 } }
  return cache
}

function save() {
  try {
    if (hasFs()) bilinet.writeFile(PATH, JSON.stringify(cache))
    dirty = false
    lastSave = Date.now()
  } catch (e) {}
}

export function getProgress(bvid) {
  const c = load()
  for (let i = 0; i < c.list.length; i++) if (c.list[i].b === bvid) return Number(c.list[i].p) || 0
  return 0
}

/**
 * 记一次进度. 只接受 5s..(时长-10s) 的区间 —— 开头结尾记下来没意义,
 * 反而会让"续播"从一个尴尬的位置开始.
 */
export function setProgress(bvid, sec, durSec) {
  if (!bvid) return
  const s = Math.floor(Number(sec) || 0)
  const d = Math.floor(Number(durSec) || 0)
  if (s < 5) return
  if (d > 30 && s > d - 10) { clearProgress(bvid); return }
  const c = load()
  const now = Date.now()
  let hit = null
  for (let i = 0; i < c.list.length; i++) if (c.list[i].b === bvid) { hit = c.list[i]; break }
  if (hit) { hit.p = s; hit.d = d; hit.t = now }
  else { c.list.push({ b: bvid, p: s, d: d, t: now }) }
  if (c.list.length > MAX) {
    c.list.sort(function (a, b) { return (b.t || 0) - (a.t || 0) })
    c.list = c.list.slice(0, MAX)
  }
  dirty = true
  if (now - lastSave > 5000) save()
  else logDebug('进度', '延后落盘 ' + bvid + ' @' + s + 's')
}

export function clearProgress(bvid) {
  const c = load()
  const next = []
  for (let i = 0; i < c.list.length; i++) if (c.list[i].b !== bvid) next.push(c.list[i])
  c.list = next
  dirty = true
}

/** 页面卸载/退出时调用, 保证最后一次进度不丢 */
export function flushProgress() {
  if (dirty) save()
}

export function progressPath() { return PATH }
