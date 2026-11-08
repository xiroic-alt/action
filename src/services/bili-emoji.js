// B 站表情缓存 (评论/动态正文里 [xxx] 形式的图)
//
// 为什么需要这层: 设备不能联网取字体的 emoji 字形, 而 B 站表情是"名称 -> 图片 URL"
// 的映射 (接口 /x/emote/user/panel/web). 参考源 PiliNara 也是把面板缓存到本地再用.
//
// 设计:
//   - 内存里有就直接用 (rich-text 是同步渲染的, 拿不到异步结果)
//   - 首次加载后写进 KV, 之后离线也能用, 不必每次进页面都请求
//   - 加载失败不影响页面: 富文本会退回 [名称] 文字
import { emotePanel } from './api.js'
import { kvGetJson, kvSetJson } from '../core/store.js'
import { log } from '../core/log.js'

const KEY = 'cfg:biliEmoji'
let cache = null
let loading = false

/** 同步取表 (可能为空, 空时 rich-text 退回文字) */
export function emojiMap() {
  if (cache) return cache
  try {
    const raw = kvGetJson(KEY, null)
    if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) { cache = raw; return cache }
  } catch (e) {}
  return {}
}

/** 异步加载并落盘; 已有缓存就直接返回 */
export async function ensureEmoji() {
  const cur = emojiMap()
  if (Object.keys(cur).length > 0) return cur
  if (loading) return cur
  loading = true
  try {
    const map = await emotePanel('reply')
    const n = Object.keys(map || {}).length
    if (n > 0) {
      cache = map
      try { kvSetJson(KEY, map) } catch (e) {}
      log('表情', '已加载 B 站表情 ' + n + ' 个')
    } else {
      log('表情', '表情面板为空')
    }
    return cache || {}
  } catch (e) {
    log('表情', '加载失败: ' + (e && e.message ? e.message : e))
    return cur
  } finally { loading = false }
}

/** 供 UI 判断热度用: 表里有没有这个名称 */
export function hasEmoji(name) {
  const m = emojiMap()
  return !!(m && m[name])
}
