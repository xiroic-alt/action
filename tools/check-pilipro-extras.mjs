// PiliPRO 离线门禁: BV/av 识别 (评论区跳转 + 搜索直达) 与 SponsorBlock 跳过决策
//
// 为什么单独一个门禁: 这两块是纯逻辑模块 (无 import / 不碰 bilinet), 但它们的**正确性**
// 直接决定"点开是不是跳到别的视频" —— 那是用户一眼就能看到的错, 必须在烧 CI 之前拦住.
// BV 算法尤其危险: 2023 年 B 站换过一轮编码, 用旧常量算 2021 年后的稿件会得到另一个合法号,
// 表现就是"点开跳到别的视频". 这里用**在线接口核对过的真实对照**钉死.
//
// 用法: node tools/check-pilipro-extras.mjs   (退出码非 0 = 有断言失败)
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SVC = path.join(__dirname, '..', 'ui', 'src', 'services')

const bv = await import(new URL('bv.js', 'file://' + SVC.replace(/\\/g, '/') + '/').href)
const sb = await import(new URL('sponsorblock.js', 'file://' + SVC.replace(/\\/g, '/') + '/').href)

let pass = 0
function ok(cond, msg) { assert.ok(cond, msg); pass++ }
function eq(a, b, msg) { assert.equal(a, b, msg); pass++ }

// ---- BV <-> av: 在线接口核实过的对照 (data.aid) ----
const VECTORS = [
  [170001, 'BV17x411w7KC'],
  [111298867365120, 'BV1L9Uoa9EUx'],
  [1004871019, 'BV16x4y1H7M1'],
  [1906473802, 'BV1MU411S7iJ']
]
for (const [av, bvid] of VECTORS) {
  eq(bv.avToBv(av), bvid, 'av' + av + ' -> ' + bvid)
  eq(bv.bvToAv(bvid), av, bvid + ' -> av' + av)
  eq(bv.bvToAv(bv.avToBv(av)), av, 'av->bv->av 回环 ' + av)
}
eq(bv.avToBv('170001'), 'BV17x411w7KC', 'avToBv 收字符串数字')
eq(bv.avToBv('av170001'), 'BV17x411w7KC', 'avToBv 收 av 前缀')
eq(bv.bvToAv('  BV17x411w7KC  '), 170001, 'bvToAv 允许首尾空白')
// ★ 回归守护: 旧版算法 (fZodR9.../177451812) 对 2021 年后的稿件会算错 ——
//   真机表现就是"点开跳到别的视频". 这条断言专门盯着"有人把常量改回旧版".
ok(bv.avToBv(1906473802) !== 'BV1CY4k1A7a3', 'BV 算法必须是现行版 (旧版会把 av1906473802 算成 BV1CY4k1A7a3)')
ok(bv.bvToAv('BV1MU411S7iJ') !== 0, '现行版能解出 2024 年的稿件')
// 非法输入
eq(bv.avToBv(0), '', 'avToBv(0) 非法')
eq(bv.avToBv(-1), '', 'avToBv 负数')
eq(bv.avToBv('abc'), '', 'avToBv 非数字')
eq(bv.avToBv(1.5), '', 'avToBv 小数 -> 不是合法 av')
eq(bv.avToBv(2251799813685248), '', 'avToBv 超 2^51')
// 码表不含 0 / I / O / l —— 只有这类字符才算"非法 bvid".
// 注意: 现行编码是全空间双射, 任意 12 位合法字符组合都会解出一个**真实存在**的 av 号,
// 所以"形似但不合法"这个说法不成立 (X/z/9 都在表里) —— 这也是"大小写写错会跳到别的视频"的根源.
eq(bv.bvToAv('BV1xx411c7m0'), 0, 'bvToAv 码表外字符 (数字 0 不在表里)')
eq(bv.bvToAv('BV1xx411c7ml'), 0, 'bvToAv 码表外字符 (小写 l 不在表里)')
eq(bv.bvToAv('BV1xx411c7m'), 0, 'bvToAv 长度不足')
eq(bv.bvToAv('AV17x411w7KC'), 0, 'bvToAv 前缀必须是 BV1')
eq(bv.bvToAv(null), 0, 'bvToAv(null)')

// ---- findVideoIds / splitByVideoIds (评论区 / 搜索) ----
const ids = bv.findVideoIds('看 av170001 和 BV1MU411S7iJ, have 170001 不算')
eq(ids.length, 2, 'findVideoIds 认出 2 个号')
eq(ids[0].kind, 'av', '第一个是 av')
eq(ids[0].bvid, 'BV17x411w7KC', 'av 号带出 bvid')
eq(ids[1].bvid, 'BV1MU411S7iJ', '第二个是 bvid')
eq(bv.findVideoIds('have 170001 only').length, 0, 'have 170001 不算视频号 (av 必须独立成词)')
eq(bv.findVideoIds('bv17x411w7kc').length, 0, '小写 bv 前缀不当视频号 (9 位区分大小写, 猜错的号会跳错视频)')
eq(bv.findVideoIds('BV1zzzzzzzzz').length, 1, 'z 在码表里 -> 是合法号 (全空间双射, 不做"形似"过滤)')
eq(bv.findVideoIds('BV1xx411c7m0').length, 0, '码表外字符 (0) 不认')
eq(bv.findVideoIds('').length, 0, '空串 -> 空')
eq(bv.findVideoIds(null).length, 0, 'null -> 空')
const text = '前文 BV17x411w7KC 中间 av1004871019 后文'
const segs = bv.splitByVideoIds(text)
eq(segs.map((s) => s.text).join(''), text, 'splitByVideoIds 拼回去 === 原文')
eq(segs.filter((s) => s.kind).length, 2, '切出 2 个可点片段')
eq(bv.splitByVideoIds('无号').length, 1, '无号时整段返回')

// ---- normalizeQuery (搜索框) ----
eq(JSON.stringify(bv.normalizeQuery('BV17x411w7KC')), '{"kind":"video","bvid":"BV17x411w7KC"}', '搜索框输入 bvid 直接进视频')
eq(bv.normalizeQuery('av170001').kind, 'video', '搜索框输入 av 号直接进视频')
eq(bv.normalizeQuery('AV1906473802').bvid, 'BV1MU411S7iJ', '搜索框 av 号大小写不敏感')
eq(bv.normalizeQuery('   ').kind, 'search', '空白 -> search')
eq(bv.normalizeQuery('如何评价 xx').keyword, '如何评价 xx', '普通关键词照常搜')
eq(bv.normalizeQuery('bv17x411w7kc').kind, 'search', '小写前缀不猜 (避免跳错视频)')

// ---- SponsorBlock ----
const SEGS = [
  { segment: [10, 20], category: 'sponsor', actionType: 'skip', UUID: 'a' },
  { segment: [30, 31], category: 'intro', actionType: 'skip', UUID: 'b' },
  { segment: [50, 200], category: 'selfpromo', actionType: 'skip', UUID: 'c' },
  { segment: [5, 5], category: 'sponsor' },
  { segment: [8, 6], category: 'sponsor' },
  null
]
const norm = sb.normalizeSegments(SEGS)
eq(norm.length, 3, 'normalizeSegments 丢弃空/倒置片段')
eq(norm[0].start, 10, '按 start 升序')
eq(sb.normalizeSegments({ segments: SEGS }).length, 3, '兼容 { segments: [...] }')
eq(sb.normalizeSegments(null).length, 0, 'null -> 空')
ok(sb.CATEGORIES.length >= 8, 'CATEGORIES 至少 8 类')
eq(sb.categoryLabel('sponsor'), '赞助广告', 'categoryLabel 已知类别')
eq(sb.categoryLabel('nope'), 'nope', 'categoryLabel 未知原样')

const opts = { categories: ['sponsor'], minLenSec: 1, maxSkipSec: 90 }
eq(sb.shouldSkip(5, norm, { categories: [] }), null, '一个类别都没勾 -> 不跳')
eq(sb.shouldSkip(5, norm, opts), null, '不在片段内 -> null')
eq(sb.shouldSkip(15, norm, opts).to, 20, '在片段内 -> 跳到片段末尾')
eq(sb.shouldSkip(15, norm, opts).category, 'sponsor', '带出类别')
eq(sb.shouldSkip(30, norm, opts), null, '类别没勾的片段不跳')
eq(sb.shouldSkip(30, norm, { categories: ['intro'], minLenSec: 2 }), null, '短于 minLenSec 不跳')
const clamp = sb.shouldSkip(55, norm, { categories: ['selfpromo'], maxSkipSec: 10 })
eq(clamp.to, 65, 'maxSkipSec 夹紧 (不一次跳完整支视频)')
eq(sb.shouldSkip(15, null, opts), null, 'segs 为 null 不炸')
eq(sb.shouldSkip(NaN, norm, opts), null, '时间非法 -> null')

console.log('PASS pilipro extras (' + pass + ' 条断言): BV/av 现行算法对照 4 组 + 非法输入 · 评论区取号与切片还原 · 搜索框直达 · SponsorBlock 归一化/勾选/长度/夹紧')
