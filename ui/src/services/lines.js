// 播放线路: 取流口 (API) x CDN 节点 (host 替换) x 可达性测速
//
// 设计参考 Starfallan/PiliNara 的 CDN 设置 (21 个内置 CDN 枚举 + 自定义 host + 真实下载测速),
// 按本机约束重写:
//   - 本机没有 fetch / AbortController / 流式进度回调, 只有 bilinet.exec / execAsync
//     (内部 popen 调设备自带 /bin/curl 7.79.1) —— 所以测速直接借 curl 的
//     -r (Range) + -w (http_code/time_starttransfer/speed_download/size_download),
//     一次拿全 状态码 / 首字节 / 吞吐 / 字节数, 比"累计进度算速率"更准且零额外开销.
//   - 测速走 execAsync (工作线程), 同步 exec 会把 QuickJS 主线程冻住 (HANDOVER §16).
//
// ★ 设备实测的防盗链真门槛 (2026-10-05, 10 组 A/B 对照, 见 §源探针):
//     无 header            -> 403
//     UA=浏览器            -> 206
//     UA=GStreamer         -> 206
//     UA=curl/7.79.1       -> 403
//     只有 Referer (curl UA)-> 403
//     空 UA + Referer      -> 403
//   **门槛是 User-Agent, Referer 完全不影响**. (HANDOVER §27.10 记的"Referer 防盗链"
//   是错的 —— 当时把 UA 和 Referer 一起换了, 归因给了 Referer.)
//   含义: 框架内置 <video> 的 souphttpsrc 自带 GStreamer UA, 天然过闸; 换 CDN host 也一样过.
//   我们把 CDN 节点选择做成"换 host 不换签名"就是因为这条.

import { bilinet } from './native.js'
import { getCfg } from './config.js'
import { log } from './log.js'

// 与 native/bilinet 一致的浏览器 UA (BiliNet.cpp: UA/REFERER 常量)
export var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
export var REFERER = 'https://www.bilibili.com'

// curl 配置文件的落盘位置 + 换行常量.
// 为什么用文件: native exec/execAsync 限 512 字符, 签名 URL 装不下 (见 probe() 注释).
const NL = String.fromCharCode(10)
export var RC_PATH = '/userdisk/xiro/.curlrc'

// ---------- 取流口 ----------
// 本机内置 <video> 只吃单一 http(s) 源的 mp4 (durl), DASH 需要双源 -> 不提供.
export var SOURCES = [
  ['auto', '自动', '优先后台口, 失败自动换备用口'],
  ['html5', 'HTML5 口', 'mp4 直链, 兼容性最好 (默认)'],
  ['web', '网页口', '与 HTML5 口同源, 部分新片更全'],
  ['backup', '备用地址', '接口下发的 backup_url, 主地址失效时用']
]

// ---------- CDN 节点 (host 替换) ----------
// 厂商分组只为在设置页好看: 同一份 upgcxcode 资源, 换 host 就能换一路 CDN.
export var CDN_NODES = [
  ['default', '接口默认', '', '默认'],
  ['ali', '阿里云 1', 'upos-sz-mirrorali.bilivideo.com', '阿里云'],
  ['alib', '阿里云 2', 'upos-sz-mirroralib.bilivideo.com', '阿里云'],
  ['alio1', '阿里云 3', 'upos-sz-mirroralio1.bilivideo.com', '阿里云'],
  ['cos', '腾讯云 1', 'upos-sz-mirrorcos.bilivideo.com', '腾讯云'],
  ['cosb', '腾讯云 2', 'upos-sz-mirrorcosb.bilivideo.com', '腾讯云'],
  ['coso1', '腾讯云 3', 'upos-sz-mirrorcoso1.bilivideo.com', '腾讯云'],
  ['tftx', '腾讯 融合', 'upos-tf-all-tx.bilivideo.com', '腾讯云'],
  ['hw', '华为云 1', 'upos-sz-mirrorhw.bilivideo.com', '华为云'],
  ['hwb', '华为云 2', 'upos-sz-mirrorhwb.bilivideo.com', '华为云'],
  ['hwo1', '华为云 3', 'upos-sz-mirrorhwo1.bilivideo.com', '华为云'],
  ['hw08c', '华为 08c', 'upos-sz-mirror08c.bilivideo.com', '华为云'],
  ['hw08h', '华为 08h', 'upos-sz-mirror08h.bilivideo.com', '华为云'],
  ['hw08ct', '华为 08ct', 'upos-sz-mirror08ct.bilivideo.com', '华为云'],
  ['tfhw', '华为 融合', 'upos-tf-all-hw.bilivideo.com', '华为云'],
  ['aliov', '阿里 海外', 'upos-sz-mirroraliov.bilivideo.com', '海外'],
  ['cosov', '腾讯 海外', 'upos-sz-mirrorcosov.bilivideo.com', '海外'],
  ['hwov', '华为 海外', 'upos-sz-mirrorhwov.bilivideo.com', '海外'],
  ['akamai', 'Akamai', 'upos-hz-mirrorakam.akamaized.net', '海外'],
  ['hkb', 'B站 香港', 'cn-hk-eq-bcache-01.bilivideo.com', '海外'],
  ['proxyws', 'B站 代理', 'proxy-tf-all-ws.bilivideo.com', 'B站']
]

// host 白名单: 只接受 B 站自家域 (参考 PiliNara 的防投毒白名单)
var HOST_OK = /\.(bilivideo\.com|bilivideo\.cn|akamaized\.net|acgvideo\.com|hdslb\.com)$/i

export function nodeById(id) {
  for (var i = 0; i < CDN_NODES.length; i++) if (CDN_NODES[i][0] === id) return CDN_NODES[i]
  return CDN_NODES[0]
}

export function nodeLabel(id) {
  var n = nodeById(id)
  return n[1]
}

export function isValidHost(h) {
  var s = String(h || '').trim().toLowerCase()
  if (!s || s.length > 96) return false
  if (!/^[a-z0-9.-]+(:[0-9]{1,5})?$/.test(s)) return false
  return HOST_OK.test(s.replace(/:[0-9]+$/, ''))
}

// 把已签名 URL 的 host 换成目标节点 (path 与全部 query 原样保留 —— 签名是按原始
// URL 的 path+query 算的, 动 query 就会 403).
export function applyHost(url, host) {
  var u = String(url || '')
  if (!host) return u
  var h = String(host).trim()
  if (!h) return u
  if (h === 'proxy-tf-all-ws.bilivideo.com') {
    // B 站代理形态: 换的是 path 而非 host
    return 'https://' + h + '/?url=' + encodeURIComponent(u)
  }
  if (!isValidHost(h)) return u
  return u.replace(/^https?:\/\/[^/]+/i, 'https://' + h)
}

// 取当前设置下该用的 host (自定义 host 优先于内置节点; 空串 = 用接口返回的 host)
export function currentHost() {
  var custom = String(getCfg('customHost') || '').trim()
  if (custom && isValidHost(custom)) return custom
  var id = String(getCfg('cdnNode') || 'default')
  var n = nodeById(id)
  return n[2] || ''
}

// 当前线路的一句话描述 (设置页/播放页提示用)
export function currentLineLabel() {
  var custom = String(getCfg('customHost') || '').trim()
  if (custom && isValidHost(custom)) return '自定义 ' + custom
  var n = nodeById(String(getCfg('cdnNode') || 'default'))
  return n[1]
}

// ---------- 测速 / 可达性 ----------
// 用 curl 的 -r 只拉一段, -w 一次性拿到状态码/首字节/吞吐/字节数.
// 成功判据: HTTP 206 或 200 且真的收到字节 (与 PiliNara 一致: 收到 >=1 字节即通).
export function probe(url, opts) {
  var o = opts || {}
  var bytes = o.bytes || 524288           // 默认 512KB, 266px 屏上"通不通"够用且省流量
  var timeoutSec = o.timeoutSec || 8
  function bad(msg) {
    return Promise.resolve({ ok: false, code: 0, bytes: 0, ms: 0, ttfbMs: 0, mbps: 0, err: msg })
  }
  if (!bilinet || typeof bilinet.execAsync !== 'function') return bad('当前固件缺少 execAsync')
  var safeUrl = String(url || '')
  // shell 是 popen('/bin/sh -c'), 单引号包裹前必须保证 URL 里没有单引号/反引号/反斜杠
  if (!/^https?:\/\/[-A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%]+$/.test(safeUrl)) return bad('URL 含非法字符')
  if (safeUrl.indexOf("'") >= 0 || safeUrl.indexOf('`') >= 0 || safeUrl.indexOf('\\') >= 0) return bad('URL 含非法字符')
  // ★ 关键约束: native 的 exec/execAsync 有 512 字符长度上限
  // (BiliNet.cpp: cmd.size() > 512 就 postError invalid cmd).
  // 而 B 站签名 URL 本身就 600~900 字符 —— 直接拼命令行必然超限.
  // 真机第一次跑就是「执行失败: execAsync: invalid cmd」, 21 个节点全灭.
  // 解法: 把长参数 (url / UA / Referer / -w 格式) 写进 curl 的配置文件, 用 -K 引用,
  // 命令行只剩 ~50 字符. 这是 curl 原生能力, 不用改 native, 也不放宽那条安全限制.
  var fmt = 'code=%{http_code} ttfb=%{time_starttransfer} speed=%{speed_download} size=%{size_download} total=%{time_total}'
  // -w 格式留在命令行: curl 的配置文件会做 %VAR 环境变量展开, 把 %{http_code} 这种
  // 度量占位符放进去有被误解析的风险 (curl 文档: config 文件里 %name 会展开成环境变量).
  // 实测命令行加上 -w 也只有 ~200 字符, 离 512 还很远.
  var rc = 'url = "' + safeUrl + '"' + NL
    + 'user-agent = "' + UA + '"' + NL
    + 'referer = "' + REFERER + '"' + NL
  try {
    if (bilinet && typeof bilinet.writeFile === 'function') bilinet.writeFile(RC_PATH, rc)
  } catch (e) { /* 写不了就自然失败, err 会把原因带出来 */ }
  var cmd = 'curl -s -o /dev/null -m ' + timeoutSec
    + ' -r 0-' + (bytes - 1)
    + " -w '" + fmt + "'"
    + ' -K ' + RC_PATH
  var t0 = Date.now()
  return bilinet.execAsync(cmd).then(function (out) {
    var ms = Date.now() - t0
    var s = String(out || '')
    var code = num(s, 'code=')
    var ttfb = num(s, 'ttfb=')
    var speed = num(s, 'speed=')
    var size = num(s, 'size=')
    var ok = (code === 200 || code === 206) && size > 0
    return {
      ok: ok, code: code, bytes: size, ms: ms,
      ttfbMs: Math.round(ttfb * 1000),
      mbps: speed > 0 ? speed / 1048576 : 0,
      err: ok ? '' : (code === 403 ? '被 CDN 拒绝 (403)' : (code === 0 ? '连接失败/超时' : 'HTTP ' + code))
    }
  }).catch(function (e) {
    return { ok: false, code: 0, bytes: 0, ms: Date.now() - t0, ttfbMs: 0, mbps: 0, err: '执行失败: ' + (e && e.message ? e.message : e) }
  })
}

function num(s, key) {
  var i = String(s).indexOf(key)
  if (i < 0) return 0
  var j = i + key.length
  var out = ''
  while (j < s.length) {
    var c = s.charAt(j)
    if ((c >= '0' && c <= '9') || c === '.' || c === '-') { out += c; j++ } else break
  }
  var v = parseFloat(out)
  return isFinite(v) ? v : 0
}

// 把一次测速结果格式化成一行短文案 (266px 屏, 越短越好)
export function fmtProbe(r) {
  if (!r) return '未测'
  if (!r.ok) return r.err || '不可用'
  var s = r.mbps >= 10 ? r.mbps.toFixed(0) : r.mbps.toFixed(1)
  return s + ' MB/s · ' + r.ttfbMs + 'ms'
}
