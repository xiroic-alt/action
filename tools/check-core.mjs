// 静态体检 #3: 核心纯逻辑 —— MD5 / wbi 签名 / 格式化 / BV-av / 弹幕 / 字幕
//
// 这些都是"算错了才会发现"的模块: md5 错一位 -> 所有 wbi 接口 -352; BV 算错 -> 点开跳错视频;
// 弹幕时序算错 -> 满屏重叠. 真机验证成本很高, 这里用**标准测试向量**离线钉死.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const U = (p) => pathToFileURL(path.join(ROOT, 'src', p)).href

let pass = 0
const ok = (c, m) => { assert.ok(c, m); pass++ }
const eq = (a, b, m) => { assert.equal(a, b, m); pass++ }

// ---------------- MD5: RFC 1321 + UTF-8 ----------------
const { md5 } = await import(U('services/md5.js'))
eq(md5(''), 'd41d8cd98f00b204e9800998ecf8427e', 'md5("") = 标准向量')
eq(md5('abc'), '900150983cd24fb0d6963f7d28e17f72', 'md5("abc") = 标准向量')
eq(md5('a'), '0cc175b9c0f1b6a831c399e269772661', 'md5("a")')
eq(md5('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0', 'md5("message digest")')
eq(md5('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b', 'md5(字母表)')
eq(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
  '57edf4a22be3c955ac49da2e2107b67a', 'md5(80 位数字) = 标准向量')
// UTF-8 (中文 != latin1)
eq(md5('中文'), 'a7bac2239fcdcb3a067903d8077c4a07', 'md5("中文") 走 UTF-8 而非 latin1')
// 长度跨越 64 字节分块边界
eq(md5('a'.repeat(55)).length, 32, '55 字节边界')
eq(md5('a'.repeat(56)).length, 32, '56 字节边界 (需要补一块)')
eq(md5('a'.repeat(64)).length, 32, '64 字节整块')
ok(md5('a'.repeat(55)) !== md5('a'.repeat(56)), '不同长度结果不同 (填充正确)')

// ---------------- wbi: 置换表 + RFC3986 ----------------
// 签名逻辑走纯模块 (无 bilinet 依赖), 因此门禁不需要任何桩件
const wbi = await import(U('services/wbi-sign.js'))
eq(wbi.rfc3986("!*'()"), '%21%2A%27%28%29', 'RFC3986 编码 !*\'()')
eq(wbi.rfc3986('中 文'), '%E4%B8%AD%20%E6%96%87', 'RFC3986 编码中文与空格')
// 用固定 mixin_key 离线验签: w_rid 必须等于 md5(排序后的 query + key)
const MIX = '7cd084941338484aae1ad9425b84077c'
const qs = wbi.buildQuery({ bvid: 'BV17x411w7KC', cid: 123 }, MIX, 1700000000)
ok(/wts=1700000000/.test(qs), 'wts 用指定时间戳')
ok(/w_rid=[0-9a-f]{32}$/.test(qs), 'w_rid 是 32 位 md5')
ok(qs.indexOf('bvid=') < qs.indexOf('cid='), '参数按 key 升序')
eq(qs.split('&w_rid=')[1], md5(qs.split('&w_rid=')[0] + MIX), 'w_rid = md5(query + mixin_key)')
// 参数顺序不影响签名 (排序后拼接)
const qs2 = wbi.buildQuery({ cid: 123, bvid: 'BV17x411w7KC' }, MIX, 1700000000)
eq(qs2, qs, '参数传入顺序不影响签名')

// ---------------- 格式化 ----------------
const F = await import(U('services/format.js'))
eq(F.playCount(1234), '1234', '播放量 < 1万 原样')
eq(F.playCount(12345), '1.2万', '播放量 万')
eq(F.playCount(123456789), '1.2亿', '播放量 亿')
eq(F.playCount(-1), '--', '接口隐藏播放量 (-1) -> --')
eq(F.duration(65), '1:05', '时长 m:ss')
eq(F.duration(3665), '1:01:05', '时长 h:mm:ss')
eq(F.stripTags('<em class="k">关键词</em>'), '关键词', '去 HTML 标签')
eq(F.normalizeUrl('//i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg', '补 https')
eq(F.normalizeUrl('http://i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg', 'http 升 https')
ok(F.thumb('https://x/a.webp', 480, 300).endsWith('a.webp@480w_300h_1c.jpg'), '图片裁切保留原扩展名')
eq(F.relative(0), '', '时间戳 0 -> 空')

// ---------------- BV / av 互转 (现行算法) ----------------
const bv = await import(U('services/bv.js'))
const VEC = [[170001, 'BV17x411w7KC'], [111298867365120, 'BV1L9Uoa9EUx'],
  [1004871019, 'BV16x4y1H7M1'], [1906473802, 'BV1MU411S7iJ']]
for (const [av, b] of VEC) {
  eq(bv.avToBv(av), b, 'av' + av + ' -> ' + b)
  eq(bv.bvToAv(b), av, b + ' -> av' + av)
}
ok(bv.avToBv(1906473802) !== 'BV1CY4k1A7a3', '不是旧版 fZodR9 算法 (否则会跳到别的视频)')
eq(bv.avToBv(0), '', 'av 0 非法')
eq(bv.avToBv(2251799813685248), '', 'av 超 2^51 非法')
eq(bv.bvToAv('BV1xx411c7m0'), 0, '码表外字符 (0) 非法')
eq(bv.findVideoIds('看 av170001 和 BV1MU411S7iJ, have 170001 不算').length, 2, '评论里认出 2 个视频号')
eq(bv.findVideoIds('bv17x411w7kc').length, 0, '小写前缀不当视频号 (会解到别的号)')
const txt = '前 BV17x411w7KC 后 av1004871019'
eq(bv.splitByVideoIds(txt).map((s) => s.text).join(''), txt, '切片拼回原文')
eq(bv.normalizeQuery('BV17x411w7KC').kind, 'video', '搜索框 bvid 直达视频')
eq(bv.normalizeQuery(' av170001 ').kind, 'video', '搜索框 av 号直达视频')
eq(bv.normalizeQuery('如何评价').kind, 'search', '普通词照常搜')

// ---------------- 弹幕 (解析/合并/泳道) ----------------
const dm = await import(U('services/danmaku.js'))
const XML = '<i><d p="1.5,1,25,16777215,1700000000,0,abc,1">第一条</d>' +
  '<d p="2.5,5,25,255,1700000001,0,abc,2">顶端&amp;转义</d>' +
  '<d p="bad">坏行</d><d p="3.5,7,25,0,1,0,a,3">高级弹幕</d></i>'
const list = dm.parseDanmakuXml(XML)
eq(list.length, 2, '解析出 2 条 (高级弹幕丢弃)')
eq(list[0].t, 1.5, '时间解析')
eq(list[0].text, '第一条', '正文')
eq(list[1].text, '顶端&转义', 'XML 实体解码')
eq(dm.colorHex(16777215), '#ffffff', '十进制 RGB -> 十六进制')
const merged = dm.mergeDanmaku(dm.parseDanmakuXml(
  '<i><d p="1,1,25,0,1,0,a,1">H</d><d p="2,1,25,0,1,0,a,2">H</d><d p="3,1,25,0,1,0,a,3">H</d></i>'),
  { windowSec: 6, threshold: 2, growth: 0.12, maxScale: 2.2, keepMode: true })
eq(merged.length, 1, '窗口内同文合并成 1 条')
ok(merged[0].count >= 3, '合并计数')
ok(merged[0].scale > 1, '超过阈值后放大')
eq(dm.parseDanmakuXml('').length, 0, '空输入 -> 空数组')
eq(dm.filterDanmaku(dm.parseDanmakuXml(XML), { keywords: ['第一条'], regexes: [], modes: [], minLength: 0 }).length, 1, '关键词屏蔽')
eq(dm.filterDanmaku(dm.parseDanmakuXml(XML), { keywords: [], regexes: ['['], modes: [], minLength: 0 }).length, 2, '非法正则忽略不炸')
const tracks = dm.buildTracks(dm.parseDanmakuXml(
  '<i><d p="1,1,25,0,1,0,a,1">A</d><d p="1.1,1,25,0,1,0,a,2">B</d><d p="1.2,1,25,0,1,0,a,3">C</d></i>'),
  { areaW: 474, areaH: 266, fontSize: 24, speedPx: 60, laneH: 36, maxLanes: 4 })
eq(tracks.lanes, 4, '泳道数按 maxLanes')
ok(tracks.items.length <= 3, '放进泳道')
const lanes = {}
for (const it of tracks.items) { (lanes[it.lane] = lanes[it.lane] || []).push(it) }
for (const l in lanes) {
  const arr = lanes[l].slice().sort((a, b) => a.t - b.t)
  for (let i = 1; i < arr.length; i++) ok(arr[i].t >= arr[i - 1].t + arr[i - 1].dur - 1e-9, '同泳道不重叠')
}
eq(dm.visibleAt(tracks.items, 0).length, 0, '时间未到 -> 不可见')

// ---------------- 字幕 (VTT/SRT 往返) ----------------
const sub = await import(U('services/subtitle.js'))
const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n你好\n\n00:00:04.500 --> 00:00:06.000\n世界'
const cues = sub.parseVtt(vtt)
eq(cues.length, 2, 'VTT 解析 2 条')
eq(cues[0].from, 1, 'VTT 起始时间')
eq(cues[0].text, '你好', 'VTT 正文')
eq(sub.cuesToSrt(cues).split('\n')[0], '1', 'SRT 序号从 1')
ok(sub.cuesToSrt(cues).indexOf('00:00:01,000 --> 00:00:03,000') > 0, 'SRT 时间戳用逗号')
eq(sub.parseSrt(sub.cuesToSrt(cues)).length, 2, 'SRT 往返等价')
eq(sub.pickCue(cues, 1.5).text, '你好', 'pickCue 命中')
eq(sub.pickCue(cues, 3), null, 'pickCue 右开区间 (to 不命中)')
eq(sub.pickCue(cues, 0.5), null, 'pickCue 未到')
eq(sub.offsetCues(cues, 2)[0].from, 3, '时间偏移')
eq(sub.parseVtt('').length, 0, '空字幕 -> 空数组')

console.log('CHECK-CORE PASSED (' + pass + ' 条断言: MD5 标准向量 / wbi 签名 / 格式化 / BV 现行算法 / 弹幕 / 字幕)')

// ---------------- 清晰度 (设备解码上限) ----------------
const api = await import(U('services/api.js'))
eq(api.qualityLabel(80), '1080P 高清', 'qn=80 中文标签')
eq(api.qualityLabel(120), '4K 超清', 'qn=120 中文标签')
eq(api.qualityLabel(999), '999P', '未知 qn 兜底')
eq(api.deviceQualities([120, 80, 32, 16]).join(','), '80,32,16', '设备过滤: 4K 被去掉, 保留 1080P 及以下')
eq(api.deviceQualities([]).length, 0, '空档位 -> 空')
eq(api.DEVICE_MAX_QN, 80, '设备解码上限 = 1080P (RK3562 硬解 H.264)')
eq(JSON.stringify(api.deviceQualities([6, 16, 32, 64, 80])), '[6,16,32,64,80]', '设备过滤保留 <=1080P 的全部档位 (含 240P)')
// 配置默认清晰度不得超过设备上限
const cfg = await import(U('core/config.js'))
ok(cfg.specOf('defaultQuality')[2][1] <= api.DEVICE_MAX_QN, 'defaultQuality 上限 <= 设备解码上限')
