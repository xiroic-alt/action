// 本地观看历史 + 观看进度: /userdisk/xiro/progress.json  (与日志/配置同目录, HANDOVER §3)
//
// ★ 这里同时是「本地历史记录」的数据源, 且**永不联网**:
//   全仓库没有任何"上报观看行为"的接口调用 (用户明确要求"不要上传 b 站"),
//   记录只写本地文件, 不参与任何账号同步. 页面与云端历史 (/x/v2/history) 完全分开:
//   云端历史在 pages/history, 本地历史在 pages/localhistory, 不共用同一个列表.
//
// 为什么要自建: 系统 storage JSAPI 形态不确定, 而 bilinet 的 readFile/writeFile 是
// 已在生产用的路径 (config.js / log.js 都走它). 数据很小 (最多 80 条), 直接整份读写.
//
// 写入策略: 内存里攒, 每 5s 或换视频/退出页面时才落盘 —— 播放中每秒写一次文件
// 在这台设备上是纯粹的浪费.
import { bilinet } from './native.js'
import { logDebug } from './log.js'

const PATH = '/userdisk/xiro/progress.json'
const MAX = 200   // 以前 80 只服务续播; 现在还要当本地历史, 放宽到 200

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
export function setProgress(bvid, sec, durSec, meta) {
  if (!bvid) return
  const s = Math.floor(Number(sec) || 0)
  const d = Math.floor(Number(durSec) || 0)
  const m = meta || {}
  // ★ 元数据(标题/UP/封面)必须在"进度太小被丢弃"之前就写进去 —— 否则刚点开就退出的视频
  //   不会出现在历史里, 而"看过一眼"恰恰是历史记录最该记住的情况.
  const c = load()
  const now = Date.now()
  let hit = null
  for (let i = 0; i < c.list.length; i++) if (c.list[i].b === bvid) { hit = c.list[i]; break }
  if (!hit) { hit = { b: bvid, p: 0, d: d, t: now }; c.list.push(hit) }
  if (m.title !== undefined) hit.T = String(m.title || '')
  if (m.author !== undefined) hit.a = String(m.author || '')
  if (m.pic !== undefined) hit.c = String(m.pic || '')
  if (m.mid !== undefined) hit.m = Number(m.mid) || 0
  if (m.durText !== undefined) hit.dt = String(m.durText || '')
  hit.t = now
  // 进度区间过滤只作用于"进度"字段, 不影响"是否出现在历史里"
  const keep = !(s < 5) && !(d > 30 && s > d - 10)
  if (keep) { hit.p = s; hit.d = d }
  else if (d > 30 && s > d - 10) { hit.p = 0 }   // 已看完: 进度归零, 但仍留在历史里
  const idx = c.list.indexOf(hit)
  if (idx > 0) { c.list.splice(idx, 1); c.list.unshift(hit) }   // 最近观看排最前
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

// ------------------------------ 本地观看历史 ------------------------------
// 与"续播进度"共用同一份文件: 历史就是"进度 + 元数据", 拆两份必然出现两处不一致.
// 注意: 清空本地历史 = 同时清掉续播点 (这是同一个事实的两个视图); 页面文案里写清楚.

/** 本地历史列表 (最近观看在前). limit 默认 200 */
export function listHistory(limit) {
  const max = Math.max(1, Math.min(MAX, Number(limit) || MAX))
  const c = load()
  c.list.sort(function (a, b) { return (b.t || 0) - (a.t || 0) })   // 老数据可能没按时间排
  const out = []
  for (let i = 0; i < c.list.length && out.length < max; i++) {
    const e = c.list[i]
    if (!e || !e.b) continue
    out.push({
      bvid: e.b,
      pos: Number(e.p) || 0,
      dur: Number(e.d) || 0,
      title: e.T || '',
      author: e.a || '',
      pic: e.c || '',
      mid: Number(e.m) || 0,
      durText: e.dt || '',
      at: Number(e.t) || 0
    })
  }
  return out
}

/** 删一条本地历史 (连它的续播点一起删) */
export function delHistory(bvid) {
  if (!bvid) return
  clearProgress(bvid)
  save()   // 删除是低频操作, 直接落盘, 免得杀进程后"删了又回来"
}

/** 清空全部本地历史 (同步落盘, 立即生效) */
export function clearHistory() {
  const c = load()
  c.list = []
  dirty = true
  save()
}

/** 本地历史条数 */
export function historyCount() {
  return load().list.length
}

/** 页面卸载/退出时调用, 保证最后一次进度不丢 */
export function flushProgress() {
  if (dirty) save()
}

export function progressPath() { return PATH }
