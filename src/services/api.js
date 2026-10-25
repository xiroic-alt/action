// B 站 Web API 集合 —— **只用网页端接口**
//
// 用户硬约束:
//   1. 只做 Web API, 不做 App API (不碰 app.bilibili.com / 不用 appkey/access_key 签名)
//   2. 私信/消息也走 Web 链路 (api.vc.bilibili.com 的 web_im + api.bilibili.com 的 msgfeed)
//   3. 不做分享到其它应用, 不做 b23 短链
//
// 全部接口都用设备 Cookie (SESSDATA) 鉴权, 与网页登录同源 —— 这也是"电脑同步登录"能直接用的原因.
import { getJson, postForm, getText } from '../core/net.js'
import { signQuery } from './wbi.js'
import { hasCookie, authState, cookieHeader } from '../core/auth.js'
import * as F from './format.js'
import { normalizeSegments } from './sponsorblock.js'

const API = 'https://api.bilibili.com'

// ---------------- 账号 ----------------

/** 当前登录态 (nav) */
export async function nav() {
  const body = await getJson(API + '/x/web-interface/nav', { noError: true })
  const d = (body && body.data) || {}
  return {
    isLogin: !!d.isLogin,
    uname: d.uname || '',
    mid: d.mid || 0,
    face: F.normalizeUrl(d.face || ''),
    level: (d.level_info && d.level_info.current_level) || 0,
    coin: Number(d.money) || 0,
    vip: (d.vip && d.vip.status === 1) ? '大会员' : ''
  }
}

/** 扫码登录: 申请二维码 */
// ---------------- 首页内容 ----------------

/**
 * 首页推荐 (Web 端 rcmd 流).
 * 用 wbi 版: x/web-interface/wbi/index/top/feed/rcmd, 带 fresh_idx 才会刷新.
 */
export async function recommend(ps, freshIdx) {
  const q = await signQuery({
    ps: ps || 12,
    fresh_type: 4,
    feed_version: 'V8',
    fresh_idx: freshIdx || 1,
    fresh_idx_1h: freshIdx || 1,
    brush: freshIdx || 1,
    homepage_ver: 1,
    last_y: 0,
    last_s: 0
  })
  const body = await getJson(API + '/x/web-interface/wbi/index/top/feed/rcmd?' + q)
  const list = (body && body.data && body.data.item) || []
  return list.map(mapFeedItem).filter(Boolean)
}

/** 全站热门 */
export async function popular(pn) {
  const body = await getJson(API + '/x/web-interface/popular?pn=' + (pn || 1) + '&ps=20')
  const list = (body && body.data && body.data.list) || []
  return list.map(mapFeedItem).filter(Boolean)
}

/** 统一成页面用的 feedItem */
function mapFeedItem(it) {
  if (!it) return null
  // 推荐流用 id/bvid, 热门/搜索用 bvid
  const bvid = it.bvid || it.id || ''
  if (!bvid) return null
  const stat = it.stat || {}
  const owner = it.owner || {}
  return {
    bvid: bvid,
    aid: Number(it.aid) || 0,
    title: String(it.title || ''),
    pic: F.thumb(it.pic || (it.pic_url) || '', 480, 300),
    author: String(owner.name || it.author || ''),
    mid: Number(owner.mid) || Number(it.mid) || 0,
    playText: F.playCount(stat.view),
    danmakuText: F.playCount(stat.danmaku),
    durationText: F.duration(it.duration || (it.duration_text ? parseDurText(it.duration_text) : 0)),
    duration: Number(it.duration) || 0
  }
}

function parseDurText(t) {
  const parts = String(t || '').split(':')
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1])
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
  return 0
}

// ---------------- 番剧 / 直播 (首页 tab) ----------------

/**
 * 番剧列表 (Web 端): x/web-interface/bangumi/list_by_tag 已下线, 用 index 接口
 * 逐日更新的番剧时间表在这里不合适, 所以走"番剧推荐"口: x/web-interface/region/feed/rcmd
 * 不返回时退回 ranking 接口, 两者都是 Web 接口.
 */
export async function bangumiList(cursor) {
  const c = cursor || ''
  const url = API + '/pgc/web/rank/list?day_type=3&season_type=1' + (c ? '&cursor=' + encodeURIComponent(c) : '')
  const body = await getJson(url, { noError: true })
  const list = (body && body.data && (body.data.list || body.data.result)) || []
  return list.map(function (it) {
    const cover = it.cover || it.pic || (it.media && it.media.cover) || ''
    return {
      bvid: '',
      seasonId: Number(it.season_id || (it.media && it.media.season_id)) || 0,
      title: String(it.title || (it.media && it.media.title) || ''),
      pic: F.thumb(cover, 480, 300),
      author: String((it.badge && it.badge.text) || (it.progress && it.progress) || ''),
      playText: F.playCount(it.play || (it.stat && it.stat.view)),
      danmakuText: '',
      durationText: String(it.new_ep && it.new_ep.desc || ''),
      kind: 'bangumi'
    }
  }).filter(function (x) { return x.title })
}

/**
 * 直播推荐 (Web 端): x/web-interface/getRoomInfo 需要房间号,
 * 列表走 xlive 的 getRecommendInfoBanner / second/getList (Web 端第二版列表)
 */
export async function liveList(page) {
  const body = await getJson('https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&page=' + (page || 1) + '&page_size=20', { noError: true })
  const list = (body && body.data && body.data.list) || []
  return list.map(function (it) {
    return {
      bvid: '',
      roomId: Number(it.roomid || it.room_id) || 0,
      title: String(it.title || ''),
      pic: F.thumb(it.cover || it.user_cover || '', 480, 300),
      author: String(it.uname || ''),
      playText: F.playCount(it.online),
      danmakuText: '',
      durationText: String(it.area_name || ''),
      kind: 'live'
    }
  }).filter(function (x) { return x.roomId })
}

// ---------------- 视频 ----------------

/** 视频详情 (wbi 版, 带分P/合集/字幕轨/交互状态) */
export async function videoDetail(bvid) {
  const q = await signQuery({ bvid: bvid })
  const body = await getJson(API + '/x/web-interface/wbi/view?' + q)
  const d = (body && body.data) || {}
  const st = d.stat || {}
  const ru = d.req_user || {}
  const pages = (d.pages || []).map(function (p) {
    return { page: p.page || 1, cid: p.cid || 0, part: String(p.part || ''), durationText: F.duration(p.duration) }
  })
  return {
    bvid: d.bvid || bvid,
    aid: Number(d.aid) || 0,
    cid: Number(d.cid) || (pages[0] && pages[0].cid) || 0,
    title: String(d.title || ''),
    pic: F.thumb(d.pic || '', 640, 400),
    desc: String(d.desc || ''),
    author: (d.owner && d.owner.name) || '',
    mid: (d.owner && d.owner.mid) || 0,
    face: F.thumb((d.owner && d.owner.face) || '', 80, 80),
    durationText: F.duration(d.duration),
    pubText: F.date(d.pubdate),
    playText: F.playCount(st.view),
    danmakuText: F.playCount(st.danmaku),
    likeText: F.playCount(st.like),
    coinText: F.playCount(st.coin),
    favText: F.playCount(st.favorite),
    shareText: F.playCount(st.share),
    replyText: F.playCount(st.reply),
    // 原始数值: 详情页操作栏要乐观加减计数, 格式化后的 "1.2万" 没法做算术
    statRaw: {
      view: Number(st.view) || 0,
      danmaku: Number(st.danmaku) || 0,
      like: Number(st.like) || 0,
      coin: Number(st.coin) || 0,
      fav: Number(st.favorite) || 0,
      share: Number(st.share) || 0,
      reply: Number(st.reply) || 0
    },
    liked: ru.like === 1,
    coined: Number(ru.coin) > 0,
    faved: ru.favorite === 1,
    pages: pages,
    // 字幕轨 (CC): PiliNara 的双语字幕入口
    subtitles: ((d.subtitle && d.subtitle.subtitles) || []).map(function (s) {
      return {
        id: String(s.id || s.id_str || s.lan || ''),
        lan: String(s.lan || ''),
        lanDoc: String(s.lan_doc || s.lan || ''),
        url: F.normalizeUrl(s.subtitle_url || s.subtitle_url_v2 || ''),
        ai: Number(s.ai_type) === 1
      }
    })
  }
}

/**
 * 清晰度档位 (qn) -> 中文标签.
 * 数值来自 bilibili-API-collect docs/video/videostream_url.md 的 qn 对照表.
 */
export const QUALITY_LABELS = {
  6: '240P 极速', 16: '360P 流畅', 32: '480P 清晰', 64: '720P 高清',
  74: '720P60 高帧率', 80: '1080P 高清', 112: '1080P+ 高码率', 116: '1080P60 高帧率',
  120: '4K 超清', 125: 'HDR 真彩', 126: '杜比视界', 127: '8K 超高清'
}

/**
 * 设备解码能力上限.
 * 目标设备是 Rockchip RK3562: 硬解保证 H.264, 屏幕本身也只有 480x960 ——
 * 更高的 4K/8K/HDR/杜比 既解不动也没意义 (还会因为走软解直接卡死).
 * 所以"设备所支持的分辨率" = qn <= 1080P 这一段; 用户可以在这一段里自选.
 */
export const DEVICE_MAX_QN = 80

export function qualityLabel(qn) {
  const n = Number(qn) || 0
  return QUALITY_LABELS[n] || (n > 0 ? (n + 'P') : '未知')
}

/** 按设备能力过滤档位 (保留 <= DEVICE_MAX_QN) */
export function deviceQualities(list) {
  const out = []
  for (let i = 0; i < (list || []).length; i++) {
    const q = Number(list[i])
    if (isFinite(q) && q > 0 && q <= DEVICE_MAX_QN) out.push(q)
  }
  return out
}

/**
 * 播放地址 (支持清晰度选择).
 *
 * 设备内置 <video> 只吃单一 mp4 (durl), 所以固定 fnval=0 (不要 DASH 双流):
 *   platform=html5 -> H5 口, 直接给 mp4
 *   web            -> 网页口 (少量稿件 H5 口没有, 且能给出更高档位)
 * @param {string} bvid
 * @param {number} cid
 * @param {{source?:string, qn?:number}} [opts]
 * @returns {Promise<{url, backup, duration, size, quality, qualities, currentLabel}>}
 */
export async function playUrl(bvid, cid, opts) {
  const o = opts || {}
  const source = o.source === 'web' ? 'web' : 'html5'
  const wantQn = Number(o.qn) || 0
  const base = source === 'web'
    ? { fnval: 0, fnver: 0, fourk: 0 }
    : { fnval: 0, fnver: 0, fourk: 0, platform: 'html5', high_quality: 1 }
  if (wantQn > 0) base.qn = wantQn
  const params = { bvid: bvid, cid: cid }
  for (const k in base) params[k] = base[k]
  const q = await signQuery(params)
  const body = await getJson(API + '/x/player/wbi/playurl?' + q)
  const d = (body && body.data) || {}
  const durl = d.durl || []
  if (!durl.length) {
    const e = new Error('没有可播放的 mp4 源 (可能需要登录/大会员)')
    e.kind = 'biz'
    throw e
  }
  // accept_quality / accept_description 是"这个稿件可选哪些档位"的权威来源
  const accept = d.accept_quality || []
  const desc = d.accept_description || []
  const pairs = []
  for (let i = 0; i < accept.length; i++) {
    const qn = Number(accept[i])
    if (qn > DEVICE_MAX_QN) continue
    pairs.push({ qn: qn, label: desc[i] ? String(desc[i]) : qualityLabel(qn) })
  }
  if (!pairs.length && d.quality) pairs.push({ qn: Number(d.quality), label: qualityLabel(d.quality) })
  const cur = Number(d.quality) || (pairs[0] && pairs[0].qn) || 0
  return {
    url: F.normalizeUrl(durl[0].url),
    backup: durl[0].backup_url ? durl[0].backup_url.map(F.normalizeUrl) : [],
    duration: Number(d.timelength) || 0,   // 毫秒
    size: Number(durl[0].size) || 0,
    quality: cur,
    qualities: pairs,
    currentLabel: qualityLabel(cur)
  }
}

// ---------------- 互动 ----------------

/** 点赞 / 取消点赞 */
export async function like(aid, on) {
  const s = authState()
  return postForm(API + '/x/web-interface/archive/like',
    'aid=' + aid + '&like=' + (on ? 1 : 2) + '&csrf=' + encodeURIComponent(s ? s.biliJct : ''))
}

/** 投币 */
export async function coin(aid, multiply, alsoLike) {
  const s = authState()
  return postForm(API + '/x/web-interface/coin/add',
    'aid=' + aid + '&multiply=' + (multiply || 1) + '&select_like=' + (alsoLike ? 1 : 0) +
    '&csrf=' + encodeURIComponent(s ? s.biliJct : ''))
}

/** 收藏夹列表 */
export async function favFolders(rid) {
  const q = await signQuery({ up_mid: (authState() || {}).mid || 0, rid: rid || 0 })
  const body = await getJson(API + '/x/v3/fav/folder/created/list-all?' + q, { noError: true })
  return ((body && body.data && body.data.list) || []).map(function (f) {
    return {
      id: f.id,
      title: String(f.title || ''),
      count: Number(f.media_count) || 0,
      // 带 rid 请求时接口会回每个夹子的收藏状态 (0 未收藏 / 1 已收藏)
      favState: Number(f.fav_state) || 0
    }
  })
}

/** 收藏 / 取消收藏 */
export async function fav(aid, addIds, delIds) {
  const s = authState()
  return postForm(API + '/x/v3/fav/resource/deal',
    'rid=' + aid + '&type=2&add_media_ids=' + (addIds || '').toString() +
    '&del_media_ids=' + (delIds || '').toString() +
    '&csrf=' + encodeURIComponent(s ? s.biliJct : ''))
}

// ---------------- 评论 ----------------

/** 评论列表 (Web 老接口, 稳定且无需签名) */
export async function replies(aid, pn, sort, type) {
  const t = Number(type) || 1
  const byTime = sort === 'time'
  // ★ 按时间排序必须走新的 wbi/main 接口 (mode=2):
  //   老的 /x/v2/reply?sort=0 在真机上恒返回空列表 (实测 "评论 0/0"),
  //   这正是用户说的"点时间排序显示没有评论".
  if (byTime) {
    try {
      const q = await signQuery({
        oid: aid, type: t, mode: 2, pagination_str: '{"offset":""}',
        plat: 1, web_location: 1315875
      })
      const body = await getJson(API + '/x/v2/reply/wbi/main?' + q, { noError: true })
      const d = (body && body.data) || {}
      const list = (d.replies || []).map(mapReply)
      const total = Number((d.cursor && d.cursor.all_count) || (d.page && d.page.count) || 0)
      if (list.length > 0) return { list: list, total: total }
      // 新接口也空 -> 落到热度接口 (至少让用户看到内容, 不要空白)
    } catch (e) {}
  }
  const srt = byTime ? 0 : 2
  const url = API + '/x/v2/reply?type=' + t + '&oid=' + encodeURIComponent(aid) +
    '&pn=' + (pn || 1) + '&ps=20&sort=' + srt + (byTime ? '&nohot=1' : '')
  const body = await getJson(url, { noError: true })
  const d = (body && body.data) || {}
  const list = (d.replies || []).map(mapReply)
  const top = d.upper && d.upper.top ? [mapReply(d.upper.top)] : []
  return { list: top.concat(list), total: Number((d.page && d.page.count) || 0) }
}

function mapReply(r) {
  const m = r.member || {}
  const c = r.content || {}
  return {
    rpid: r.rpid || 0,
    author: String(m.uname || ''),
    mid: Number(m.mid) || 0,
    face: F.thumb(m.avatar || '', 60, 60),
    text: String(c.message || ''),
    liked: Number(r.action) === 1,
    likeText: F.playCount(r.like),
    replyCount: Number(r.rcount) || 0,
    timeText: F.relative(r.ctime),
    isUp: false
  }
}

// ---------------- 弹幕 / 字幕 ----------------

/** 弹幕 XML (匿名可用, 不需要 wbi; 走设备 curl 的 --compressed 自动解压) */
export async function danmakuXml(cid) {
  const id = Number(cid) || 0
  if (!id) return ''
  const txt = await getText('https://comment.bilibili.com/' + id + '.xml', { timeout: 20, noError: true })
  return txt && txt.indexOf('<i>') === 0 ? txt : ''
}

/** 字幕正文 (签名 URL, 有时效) */
export async function subtitleBody(url) {
  if (!url) return ''
  return getText(url, { timeout: 20, noError: true })
}

// ---------------- 直播取流 (Web 端) ----------------

/**
 * 直播间取流.
 * 走 Web 端 xlive getRoomPlayInfo (匿名可用, 鉴权在 URL 签名里).
 * 设备内置 <video> 只认容器内的 H.264, 所以每档优先取 HLS/avc, 回落 FLV/avc;
 * hls 的 fmp4 与 ts 都试 (部分房间只给其中一种).
 * @returns {Promise<{url, format, qn, accept: Array<{qn,label,format}>}>}
 */
export async function liveRoomPlayUrl(roomId, preferIndex) {
  const rid = Number(roomId) || 0
  if (!rid) throw new Error('缺少直播间号')
  const url = 'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo' +
    '?room_id=' + rid + '&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8'
  const body = await getJson(url, { noError: true })
  const d = (body && body.data) || {}
  const streams = (d.playurl_info && d.playurl_info.playurl && d.playurl_info.playurl.stream) || []
  const accept = []
  for (let i = 0; i < streams.length; i++) {
    const st = streams[i]
    const formats = st.format || []
    for (let j = 0; j < formats.length; j++) {
      const fm = formats[j]
      const codecs = fm.codec || []
      for (let k = 0; k < codecs.length; k++) {
        const cd = codecs[k]
        // 只要 H.264 (设备硬解保证); 优先级: hls/fmp4 > hls/ts > flv
        if (String(cd.codec_name || '').toLowerCase() !== 'avc') continue
        const infos = cd.url_info || []
        for (let m = 0; m < infos.length; m++) {
          const base = infos[m].host + cd.base_url + infos[m].extra
          const fmt = (cd.format_name === 'fmp4' || cd.format_name === 'ts') ? 'hls' : 'flv'
          accept.push({ url: F.normalizeUrl(base), format: fmt, qn: Number(cd.current_qn) || 0, label: String(fm.format_name || '') })
        }
      }
    }
  }
  if (!accept.length) throw new Error('该直播间没有可播放的 H.264 源')
  // 排序: hls(音视频同源, 更稳) 优先, 其次 flv; 同格式内按原序
  accept.sort(function (a, b) { return (a.format === 'hls' ? 0 : 1) - (b.format === 'hls' ? 0 : 1) })
  const idx = Math.min(Math.max(0, Number(preferIndex) || 0), accept.length - 1)
  const pick = accept[idx]
  return { url: pick.url, format: pick.format, qn: pick.qn, accept: accept }
}

// ---------------- SponsorBlock (第三方片段库, 非 B 站接口) ----------------
const sponsorCache = new Map()

/**
 * 取某支视频的 SponsorBlock 片段.
 * 网络不可达 (国内访问 sponsor.ajay.app 常被重置) 时返回空数组并静默 —— 这是可选功能,
 * 不该影响正常播放; 空结果也缓存 10 分钟, 免得每支视频都白等超时.
 */
export async function sponsorSegments(bvid) {
  const id = String(bvid || '')
  if (!/^BV/.test(id)) return []
  const hit = sponsorCache.get(id)
  if (hit && Date.now() - hit.at < 600000) return hit.list
  let list = []
  try {
    const txt = await getText('https://sponsor.ajay.app/api/skipSegments?videoID=' + encodeURIComponent(id), { timeout: 6, noError: true })
    if (txt && txt.charAt(0) === '[') list = normalizeSegments(JSON.parse(txt))
  } catch (e) { list = [] }
  sponsorCache.set(id, { at: Date.now(), list: list })
  return list
}

/** 兼容别名: 早期调用方用过 qrGenerate/qrPoll 这组名字 */
export const qrGenerate = qrcodeGenerate
export const qrPoll = qrcodePoll

// ---------------- 消息 / 私信 (Web 链路) ----------------

/** 未读汇总 (Web msgfeed) */
export async function msgUnread() {
  const body = await getJson(API + '/x/msgfeed/unread', { noError: true })
  const d = (body && body.data) || {}
  return { reply: Number(d.reply) || 0, at: Number(d.at) || 0, like: Number(d.like) || 0, sys: Number(d.sys_msg) || 0 }
}

/** 回复我的 (Web msgfeed) */
export async function msgReplies(pn) {
  const body = await getJson(API + '/x/msgfeed/reply?platform=web&build=0&mobi_app=web&pn=' + (pn || 1) + '&ps=20', { noError: true })
  const items = ((body && body.data && body.data.items) || []).map(function (it) {
    const u = it.user || {}
    return {
      id: it.id,
      author: String(u.nickname || ''),
      mid: Number(u.mid) || 0,
      face: F.thumb(u.avatar || '', 60, 60),
      text: String((it.item && it.item.source_content) || it.source_content || ''),
      title: String((it.item && it.item.title) || ''),
      timeText: F.relative(it.reply_time || it.time)
    }
  })
  return { list: items }
}

/** 私信会话列表 (Web IM: session_svr, mobi_app=web) */
export async function pmSessions() {
  const url = 'https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions' +
    '?session_type=1&group_fold=1&unfollow_fold=0&sort_rule=2&build=0&mobi_app=web'
  const body = await getJson(url, { noError: true })
  const list = (body && body.data && body.data.session_list) || []
  return list.map(function (s) {
    return {
      talkerId: Number(s.talker_id) || 0,
      unread: Number(s.unread_count) || 0,
      timeText: F.relative(Math.floor((Number(s.session_ts) || 0) / 1000000)),
      // 会话摘要要再请求一次消息列表, 列表页先不取 (省请求)
      preview: ''
    }
  })
}

// ---------------- 我的 (收藏夹 / 观看历史 / 稍后再看) ----------------
// 三个列表都走 Web 端接口 (用户硬约束: 只做 Web API).
// 对应 PiliNara: mine/view.dart 的 fav_item / history_item / later_item 三个分栏.

/** 收藏夹列表 (含默认收藏夹). 出处 lib/http/api.dart:157 /x/v3/fav/folder/created/list-all */
export async function favFoldersAll() {
  const q = await signQuery({ up_mid: (authState() || {}).mid || 0 })
  const body = await getJson(API + '/x/v3/fav/folder/created/list-all?' + q, { noError: true })
  const d = (body && body.data) || {}
  const list = (d.list || []).map(function (f) {
    return {
      id: Number(f.id) || 0,
      title: String(f.title || ''),
      count: Number(f.media_count) || 0,
      isPublic: (Number(f.attr) & 1) === 0,   // attr 低位: 0=公开 1=私密 (PiliNara BiliUtils.isPublicFav)
      cover: F.thumb(f.cover || '', 320, 200) // 16:10 裁切, 与列表卡片一致
    }
  })
  return { count: Number(d.count) || list.length, list: list }
}

/**
 * 收藏夹内容 (视频列表).
 * 出处 lib/http/api.dart:106 /x/v3/fav/resource/list?media_id=&pn=&ps=&keyword=&order=mtime&type=0&tid=0
 */
export async function favResources(mediaId, pn, ps) {
  const q = await signQuery({
    media_id: Number(mediaId) || 0,
    pn: pn || 1,
    ps: ps || 20,
    keyword: '',
    order: 'mtime',
    type: 0,
    tid: 0,
    platform: 'web'
  })
  const body = await getJson(API + '/x/v3/fav/resource/list?' + q, { noError: true })
  const d = (body && body.data) || {}
  const list = (d.medias || []).map(function (m) {
    const upper = m.upper || {}
    const cnt = m.cnt_info || {}
    return {
      bvid: String(m.bvid || ''),
      aid: Number(m.id) || 0,
      cid: Number(m.cid) || 0,
      title: String(m.title || ''),
      pic: F.thumb(m.cover || '', 320, 200),
      author: String(upper.name || ''),
      mid: Number(upper.mid) || 0,
      durationText: F.duration(m.duration),
      duration: Number(m.duration) || 0,
      playText: F.playCount(cnt.play),
      progressText: '',
      business: 'archive',
      openable: !!m.bvid
    }
  })
  return { list: list, hasMore: !!d.has_more }
}

/** 播放进度文案 (历史/稍后再看共用; -1 = 已看完, 秒为单位) */
function watchProgress(sec) {
  const s = Number(sec) || 0
  if (s < 0) return '已看完'
  if (s <= 0) return ''
  return '看到 ' + F.duration(s)
}

/**
 * 观看历史 (游标分页). 出处 lib/http/api.dart:247 /x/web-interface/history/cursor
 * 游标: 首页不带, 之后带上一页的 max + view_at (接口返回 data.cursor).
 */
export async function historyCursor(max, viewAt) {
  const url = API + '/x/web-interface/history/cursor?type=all&ps=20' +
    (max ? '&max=' + max + '&view_at=' + (viewAt || 0) : '')
  const body = await getJson(url, { noError: true })
  const d = (body && body.data) || {}
  const c = d.cursor || {}
  const list = (d.list || []).map(function (h) {
    const hs = h.history || {}
    const business = String(hs.business || '')
    const bvid = String(hs.bvid || '')
    return {
      bvid: bvid,
      aid: Number(hs.oid) || 0,
      cid: Number(hs.cid) || 0,
      title: String(h.title || h.show_title || ''),
      pic: F.thumb(h.cover || (h.covers && h.covers[0]) || '', 320, 200),
      author: String(h.author_name || ''),
      mid: Number(h.author_mid) || 0,
      durationText: F.duration(h.duration),
      duration: Number(h.duration) || 0,
      playText: '',
      progressText: watchProgress(h.progress),
      viewAt: Number(h.view_at) || 0,
      business: business,
      // 只有普通视频稿件才能在笔上播放; 直播/专栏/番剧点开时给提示
      openable: business === 'archive' && bvid !== ''
    }
  })
  // 游标: 接口给了 data.cursor 就用它; 没给就退回最后一条的 oid/view_at
  // (PiliNara 的 HistoryController 也是这么兜的: max = last.history.oid, viewAt = last.viewAt)
  const last = list.length ? list[list.length - 1] : null
  return {
    list: list,
    cursor: {
      max: Number(c.max) || (last ? last.aid : 0),
      view_at: Number(c.view_at) || (last ? last.viewAt : 0)
    }
  }
}

/** 稍后再看 (Web 接口 /x/v2/history/toview; 列表一次拉全) */
export async function toViewList() {
  const body = await getJson(API + '/x/v2/history/toview', { noError: true })
  const d = (body && body.data) || {}
  const list = (d.list || []).map(function (v) {
    const owner = v.owner || {}
    return {
      bvid: String(v.bvid || ''),
      aid: Number(v.aid) || 0,
      cid: Number(v.cid) || 0,
      title: String(v.title || ''),
      pic: F.thumb(v.pic || '', 320, 200),
      author: String(owner.name || ''),
      mid: Number(owner.mid) || 0,
      durationText: F.duration(v.duration),
      duration: Number(v.duration) || 0,
      playText: F.playCount((v.stat && v.stat.view)),
      progressText: watchProgress(v.progress),
      business: 'archive',
      openable: !!v.bvid
    }
  })
  return list
}


// ---------------- 搜索 (全 Web 链路) ----------------

/**
 * 视频搜索 (wbi 版: x/web-interface/wbi/search/type).
 * 参数集对齐 PiliNara lib/http/search.dart searchByType(): page_size 20 / platform pc /
 * web_location 1430654; 缺 page_size 时服务端只回 20 条但分页语义不稳.
 * 返回 { list, total, numPages }.
 *
 * 风控: 匿名请求可能只回 { v_voucher } (需要网页端 JS 挑战换取 gaia vtoken, 笔上做不到)
 *       -> 这里抛 kind='blocked', 由页面提示"稍后再试 / 登录后重试". -412 由 core/net.js 抛.
 */
export async function searchVideo(keyword, page) {
  const q = await signQuery({
    search_type: 'video',
    keyword: String(keyword == null ? '' : keyword),
    page: page || 1,
    page_size: 20,
    platform: 'pc',
    web_location: 1430654
  })
  const body = await getJson(API + '/x/web-interface/wbi/search/type?' + q)
  const d = (body && body.data) || {}
  if (d.v_voucher) {
    const e = new Error('搜索触发风控, 请稍后再试 (登录后更稳)')
    e.kind = 'blocked'
    e.code = -412
    throw e
  }
  return {
    list: (d.result || []).map(mapSearchItem).filter(Boolean),
    total: Number(d.numResults) || 0,
    numPages: Number(d.numPages) || 0
  }
}

/** 搜索结果条目 -> 页面用 feedItem (title 带 <em> 标签, 必须去标签) */
function mapSearchItem(it) {
  if (!it || !it.bvid) return null
  const dur = parseDurText(it.duration)
  return {
    bvid: String(it.bvid),
    aid: Number(it.aid) || 0,
    title: F.stripTags(it.title || ''),
    pic: F.thumb(it.pic || '', 480, 300),
    author: String(it.author || ''),
    mid: Number(it.mid) || 0,
    playText: F.playCount(it.play),
    danmakuText: F.playCount(it.danmaku),
    durationText: F.duration(dur),
    duration: dur,
    pubText: F.date(it.pubdate),
    desc: F.stripTags(it.desc || '')
  }
}

function mapHotItem(it) {
  const kw = String((it && it.keyword) || '')
  if (!kw) return null
  return {
    keyword: kw,
    showName: String((it && it.show_name) || kw),
    icon: F.normalizeUrl((it && it.icon) || '')
  }
}

/** 热搜榜 (s.search.bilibili.com/main/hotword, 无需签名) */
export async function hotSearch() {
  const body = await getJson('https://s.search.bilibili.com/main/hotword', { noError: true })
  return ((body && body.list) || []).map(mapHotItem).filter(Boolean)
}

/** 搜索发现 (api.bilibili.com/x/web-interface/search/square) */
export async function searchSquare(limit) {
  const body = await getJson(API + '/x/web-interface/search/square?limit=' + (limit || 10), { noError: true })
  const t = (body && body.data && body.data.trending) || null
  return ((t && t.list) || []).map(mapHotItem).filter(Boolean)
}

/** 热词兜底: 先 search/square (带运营词), 空则退回 hotword 榜 */
export async function hotKeywords(limit) {
  let list = await searchSquare(limit)
  if (!list.length) list = await hotSearch()
  return list.slice(0, limit || 10)
}

// ---------------- 扫码登录 (Web 链路) ----------------
// ★ 域名纠正: x/passport-login/web/qrcode/* 在 passport.bilibili.com, 不在 api.bilibili.com
//   (api 域名对这两个路径回 404 HTML). 上面的 qrcodeGenerate/qrcodePoll 用了 API 常量,
//   这里补一份正确域名的实现供登录页使用, 原函数保持不动, 待接口归属人统一修正.
const PASSPORT = 'https://passport.bilibili.com'

/** 扫码登录: 申请二维码 (passport 域名) */
export async function qrcodeGenerate() {
  const body = await getJson(PASSPORT + '/x/passport-login/web/qrcode/generate', { noError: true })
  const d = (body && body.data) || {}
  if (!d.url || !d.qrcode_key) throw new Error('二维码获取失败')
  return { url: String(d.url), key: String(d.qrcode_key) }
}

/** 扫码登录: 轮询状态 (passport 域名); 成功后 Cookie 在 data.url 的参数里 */
export async function qrcodePoll(key) {
  const body = await getJson(PASSPORT + '/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(key), { noError: true })
  const d = (body && body.data) || {}
  const code = Number(d.code)
  if (code === 0) {
    const params = {}
    const url = String(d.url || '')
    const qi = url.indexOf('?')
    if (qi >= 0) {
      const qs = url.substring(qi + 1).split('&')
      for (let i = 0; i < qs.length; i++) {
        const kv = qs[i].split('=')
        params[kv[0]] = decodeURIComponent(kv[1] || '')
      }
    }
    return { state: 'ok', cookie: { sessdata: params.SESSDATA || '', biliJct: params.bili_jct || '', dedeUserId: params.DedeUserID || '' } }
  }
  if (code === 86101) return { state: 'waiting' }
  if (code === 86090) return { state: 'scanned' }
  if (code === 86038) return { state: 'expired' }
  return { state: 'error', message: d.message || ('code=' + code) }
}

// ---------------- 电脑同步登录 ----------------

/**
 * 从局域网电脑拉取 Cookie (电脑侧跑 tools/pc-cookie-server.py).
 * ★ 端口 9527 与路径 /pilipro/cookie 是对外契约, 不要改.
 * 返回 { sessdata, biliJct, dedeUserId }.
 */
export async function fetchPcCookie(ip) {
  const host = String(ip == null ? '' : ip).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!host) {
    const e = new Error('请先输入电脑 IP')
    e.kind = 'bad'
    throw e
  }
  const body = await getJson('http://' + host + ':9527/pilipro/cookie', { noError: true, timeout: 8 })
  if (!body) {
    const e = new Error('连不上电脑 (检查 IP / 同一 WiFi / 服务是否在运行)')
    e.kind = 'net'
    throw e
  }
  if (body.ok !== true) {
    const e = new Error(body.message ? String(body.message) : '电脑端还没有保存 Cookie')
    e.kind = 'biz'
    throw e
  }
  if (!body.sessdata) {
    const e = new Error('电脑端 Cookie 缺少 SESSDATA')
    e.kind = 'biz'
    throw e
  }
  return {
    sessdata: String(body.sessdata),
    biliJct: String(body.bili_jct || ''),
    dedeUserId: String(body.dede_userid || body.dedeUserId || '')
  }
}

// ---------------- UP 主 ----------------

/**
 * UP 主名片 (Web card 接口): 昵称 / 头像 / 粉丝数 / 是否已关注.
 * 为什么不用空间那套: space 系列是 App 链路 (appkey 签名), 用户硬约束只做 Web 链路.
 * 返回: { mid, name, face, fansRaw, fansText, following }
 */
export async function userCard(mid) {
  const m = Number(mid) || 0
  if (!m) return { mid: 0, name: '', face: '', fansRaw: 0, fansText: '', following: false }
  const body = await getJson(API + '/x/web-interface/card?mid=' + m + '&photo=false', { noError: true })
  const d = (body && body.data) || {}
  const card = d.card || {}
  const fans = Number(card.fans != null ? card.fans : d.follower) || 0
  // 注意: card.attention 是 UP 主自己关注了多少人 (一个数字), 不是关注态;
  // 权威字段是 data.following (当前登录账号是否关注了该 mid)。
  return {
    mid: m,
    name: String(card.name || ''),
    face: F.thumb(card.face || '', 80, 80),
    fansRaw: fans,
    fansText: F.playCount(fans),
    following: d.following === true
  }
}

/**
 * 关注 / 取关 (Web).
 *   act: 1 = 关注, 2 = 取消关注
 *   re_src: 11 = 视频详情页来源 (与网页端一致, 不引 App 端 re_src)
 * 需要登录态 (SESSDATA) + csrf (bili_jct), 两者都在 core/auth.js 里.
 */
export async function relationModify(mid, act) {
  const m = Number(mid) || 0
  if (!m) { const e = new Error('缺少 mid'); e.kind = 'biz'; throw e }
  const s = authState()
  if (!s || !s.biliJct) { const e = new Error('需要登录 (缺少 csrf)'); e.kind = 'biz'; throw e }
  return postForm(API + '/x/relation/modify',
    'fid=' + m + '&act=' + (Number(act) === 2 ? 2 : 1) +
    '&re_src=11&csrf=' + encodeURIComponent(s.biliJct))
}


/* ==================== 动态 / 用户空间 / 专栏 / 关注粉丝 ==================== */
// 说明: 全部走 Web 接口 (用户要求不碰 app 接口). 动态与空间信息需要 wbi 签名,
// 统一走 signQuery(); 列表项用下面的 map* 收敛成页面用的结构.

/** 时间戳 -> 相对时间 */
function relTime(ts) {
  const n = Number(ts) || 0
  if (!n) return ''
  const d = Math.max(0, Math.floor(Date.now() / 1000) - n)
  if (d < 60) return '刚刚'
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前'
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前'
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前'
  return F.date ? F.date(n) : ''
}

/** 去掉 HTML 标签 (专栏正文/简介) */
function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim()
}

/** 动态卡片 -> 统一结构 */
function mapDynamic(it) {
  if (!it) return null
  const mod = it.modules || {}
  const au = mod.module_author || {}
  const dy = mod.module_dynamic || {}
  const desc = dy.desc || {}
  const major = dy.major || {}
  const out = {
    id: String(it.id_str || ''),
    type: String(it.type || ''),
    author: au.name || '',
    face: F.thumb(au.face || '', 80, 80),
    pubTs: au.pub_ts || 0,
    timeText: relTime(au.pub_ts),
    text: desc.text || '',
    pics: [],
    video: null,
    article: null,
    repost: null
  }
  const draw = major.draw
  if (draw && draw.items) {
    for (let i = 0; i < draw.items.length && i < 9; i++) {
      const src = draw.items[i].src || ''
      if (src) out.pics.push(F.thumb(src, 320, 200))
    }
  }
  const arch = major.archive
  if (arch) {
    out.video = {
      bvid: arch.bvid || '',
      title: arch.title || '',
      cover: F.thumb(arch.cover || '', 480, 300),
      durationText: F.duration ? F.duration(arch.duration) : '',
      playText: F.playCount ? F.playCount(arch.stat && arch.stat.play) : ''
    }
  }
  const opus = major.opus
  if (opus) {
    out.text = out.text || (opus.summary && opus.summary.text) || ''
    if (opus.pics) {
      for (let i = 0; i < opus.pics.length && i < 9; i++) {
        const u = opus.pics[i].url || ''
        if (u) out.pics.push(F.thumb(u, 320, 200))
      }
    }
  }
  const art = major.article
  if (art) out.article = { id: String(art.id || ''), title: art.title || '', covers: art.covers || [] }
  const orig = it.orig
  if (orig) out.repost = mapDynamic(orig)
  return out
}

/** 动态流: type = all(推荐) | video */
export async function dynamicFeed(offset, type) {
  const q = await signQuery({
    offset: offset || '',
    type: type || 'all',
    platform: 'web',
    features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard'
  })
  const body = await getJson(API + '/x/polymer/web-dynamic/v1/feed/all?' + q)
  const d = (body && body.data) || {}
  return {
    items: (d.items || []).map(mapDynamic).filter(Boolean),
    offset: d.offset || '',
    hasMore: !!d.has_more
  }
}

/** 用户空间动态 */
export async function spaceDynamics(mid, offset) {
  const q = await signQuery({
    host_mid: mid,
    offset: offset || '',
    platform: 'web',
    features: 'itemOpusStyle,opusBigCover,onlyfansVote'
  })
  const body = await getJson(API + '/x/polymer/web-dynamic/v1/feed/space?' + q)
  const d = (body && body.data) || {}
  return {
    items: (d.items || []).map(mapDynamic).filter(Boolean),
    offset: d.offset || '',
    hasMore: !!d.has_more
  }
}

/** 用户空间基本信息 */
export async function spaceInfo(mid) {
  const q = await signQuery({ mid: mid })
  const body = await getJson(API + '/x/space/wbi/acc/info?' + q)
  const d = (body && body.data) || {}
  return {
    mid: d.mid || mid,
    name: d.name || '',
    face: F.thumb(d.face || '', 120, 120),
    sign: d.sign || '',
    level: (d.level) || 0,
    fans: (d.fans) || 0,
    fansText: F.count ? F.count(d.fans) : String(d.fans || 0),
    archive: (d.archive_count) || 0,
    like: (d.likes) || 0,
    vip: d.vip && d.vip.status ? (d.vip.label && d.vip.label.text) || '大会员' : ''
  }
}

/** 用户投稿视频 */
export async function spaceVideos(mid, pn) {
  const q = await signQuery({ mid: mid, pn: pn || 1, ps: 20, order: 'pubdate', platform: 'web' })
  const body = await getJson(API + '/x/space/wbi/arc/search?' + q)
  const d = (body && body.data) || {}
  const list = (d.list && d.list.vlist) || []
  return list.map(function (v) {
    return {
      bvid: v.bvid || '',
      title: v.title || '',
      author: v.author || '',
      pic: F.thumb(v.pic || '', 480, 300),
      playText: F.playCount ? F.playCount(v.play) : '',
      danmakuText: F.count ? F.count(v.video_review) : '',
      durationText: F.duration ? F.duration(v.length) : ''
    }
  }).filter(function (v) { return v.bvid })
}

/** 关注 / 粉丝列表: kind = follow | fans */
export async function relationList(mid, kind, pn) {
  const q = await signQuery({ vmid: mid, pn: pn || 1, ps: 20, order: 'desc', order_type: 'desc' })
  const url = kind === 'fans'
    ? API + '/x/relation/fans?' + q
    : API + '/x/relation/followings?' + q
  const body = await getJson(url)
  const d = (body && body.data) || {}
  const list = d.list || []
  return list.map(function (u) {
    return {
      mid: u.mid,
      name: u.uname || '',
      face: F.thumb(u.face || '', 80, 80),
      sign: u.sign || '',
      fansText: F.count ? F.count(u.fans) : ''
    }
  }).filter(function (u) { return u.mid })
}

/** 专栏详情 */
export async function articleInfo(cv) {
  const body = await getJson(API + '/x/article/view?cv=' + encodeURIComponent(cv))
  const d = (body && body.data) || {}
  const opus = d.opus || {}
  let text = ''
  if (opus.content && opus.content.paragraphs) {
    const ps = opus.content.paragraphs
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      if (p.text && p.text.nodes) {
        let line = ''
        for (let j = 0; j < p.text.nodes.length; j++) line += (p.text.nodes[j].word && p.text.nodes[j].word.words) || ''
        if (line) text += line + '\n'
      } else if (p.pic && p.pic.pics) {
        // 图片段落: 用占位行表示 (页面只渲染文字, 图片另行展示)
        text += '[图片]\n'
      }
    }
  }
  if (!text) text = stripHtml(d.content || '')
  return {
    id: d.id || cv,
    title: (opus.title) || d.title || '',
    author: (opus.author && opus.author.name) || d.author_name || '',
    face: F.thumb((opus.author && opus.author.face) || d.author_face || '', 80, 80),
    pubText: relTime((opus.author && opus.author.pub_ts) || d.publish_time || 0),
    banner: F.thumb((opus.top && opus.top.url) || d.banner_url || '', 640, 360),
    stats: {
      view: (d.stats && d.stats.view) || d.view || 0,
      like: (d.stats && d.stats.like) || d.like || 0,
      coin: (d.stats && d.stats.coin) || d.coin || 0,
      fav: (d.stats && d.stats.favorite) || d.favorite || 0
    },
    text: text
  }
}

/** 用户专栏列表 */
export async function articleList(mid, pn) {
  const q = await signQuery({ mid: mid, pn: pn || 1, ps: 20, sort: 'publish_time' })
  const body = await getJson(API + '/x/space/wbi/article?' + q)
  const d = (body && body.data) || {}
  const list = (d.articles) || []
  return list.map(function (a) {
    return {
      id: a.id,
      title: a.title || '',
      cover: F.thumb((a.image_urls && a.image_urls[0]) || '', 320, 200),
      viewText: F.count ? F.count(a.view) : '',
      timeText: relTime(a.publish_time)
    }
  }).filter(function (a) { return a.id })
}
