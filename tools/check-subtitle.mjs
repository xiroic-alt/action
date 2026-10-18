// 离线门禁: 字幕服务 (ui/src/services/subtitle.js) 的纯逻辑回归
//
// 为什么需要它:
//   笔上"零字幕"不是 UI 缺控件, 而是三件事都没人做 ——
//     1) 从 x/player/wbi/v2 的 detail 里把字幕列表抠出来 (三种入参形态都在真实响应里出现过);
//     2) 把 CC 正文 JSON / VTT / SRT 解析成同一种 cue (秒);
//     3) 选帧 (from <= t < to) 与对轴偏移, 以及导出 VTT/SRT 给"保存字幕"用.
//   这四条全是纯函数, 真机验证成本极高 (要一部有 CC 的片子 + 一遍遍对轴), 所以在这里钉死.
//
// 桩件与加载方式照 tools/check-live.mjs:
//   globalThis.__bilinet + register('./esm-hooks.mjs') 让 'bilinet' 等原生模块名能被 Node
//   真实 ESM 链接. subtitle.js 本身不 import 任何东西, 但走同一套加载路径能保证
//   "它真的是合法 ESM 模块、导出的名字真的存在" —— 少写导出在这里就红.
//
// 用法: node tools/check-subtitle.mjs   (退出码非 0 = 有断言失败, CI 可直接拦)

import assert from 'node:assert/strict'
import { register } from 'node:module'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---- 设备侧桩件 (subtitle.js 不用, 但保持与其余门禁一致的加载环境) ----
globalThis.__bilinet = {
  readFile: () => '',
  writeFile: () => true,
  deleteFile: () => true,
  mkdirs: () => true,
  fileExists: () => false,
  exec: () => '',
  httpGet: () => '',
  httpGetAsync: () => Promise.resolve('')
}
globalThis.$falcon = { Page: class Page {}, App: class App {}, eventMap: {} }
register('./esm-hooks.mjs', import.meta.url)

const sub = await import('../ui/src/services/subtitle.js')
const { parseSubtitleJson, parseVtt, parseSrt, pickCue, pickSubtitles, offsetCues, cuesToVtt, cuesToSrt } = sub

let pass = 0
const fails = []
function ok(cond, msg) { if (cond) { pass++; return } fails.push(msg) }
function eq(a, b, msg) {
  try { assert.deepEqual(a, b); pass++ } catch (e) {
    fails.push(msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')
  }
}
// 不抛即算过; 抛了就记红并把异常塞进失败信息
function noThrow(fn, msg) {
  try { fn(); pass++ } catch (e) { fails.push(msg + ' -> ' + (e && e.message ? e.message : e)) }
}

const SRC = new URL('../ui/src/services/subtitle.js', import.meta.url)
const code = fs.readFileSync(fileURLToPath(SRC), 'utf8')

// ---------- 0. 模块契约: 8 个导出一个不少, 且是纯逻辑 ----------
const EXPORTS = ['cuesToSrt', 'cuesToVtt', 'offsetCues', 'parseSrt', 'parseSubtitleJson', 'parseVtt', 'pickCue', 'pickSubtitles']
for (const name of EXPORTS) ok(typeof sub[name] === 'function', '导出缺失或不是函数: ' + name)
ok(!/^\s*import\s/m.test(code), 'subtitle.js 必须无 import (纯逻辑, 页与门禁都能直接加载)')
// 去掉注释再查"碰没碰设备/宿主全局": 注释里本来就要解释"本模块不碰 bilinet", 直接 grep 会假红
const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
ok(!/bilinet|require\(|process\.|window\.|document\./.test(bare), 'subtitle.js 不许碰 bilinet/Node/浏览器全局')

// ---------- 1. VTT / SRT 互相转换后 cues 等价 ----------
const VTT = [
  'WEBVTT',
  'Kind: captions',
  'Language: zh-CN',
  '',
  'NOTE 这是注记, 整块要跳过',
  '第二行注记',
  '',
  'STYLE',
  '::cue { color: yellow }',
  '',
  'cue-1',
  '00:00:01.000 --> 00:00:04.000',
  '第一行',
  '第二行',
  '',
  '00:01:02.500 --> 00:01:05.250 align:start line:0',
  '跨分钟 <b>加粗</b> 保留',
  '',
  '01:02:03.400 --> 01:02:04.000',
  '跨小时',
  ''
].join('\n')

const vttCues = parseVtt(VTT)
eq(vttCues, [
  { from: 1, to: 4, text: '第一行 第二行' },
  { from: 62.5, to: 65.25, text: '跨分钟 <b>加粗</b> 保留' },
  { from: 3723.4, to: 3724, text: '跨小时' }
], 'parseVtt: 跳过 WEBVTT/NOTE/STYLE, 多行合并, 带 cue 设置, 跨小时')

// VTT -> SRT -> 再解析: 逐条等价 (时间量化到 ms, 不该有任何漂移)
const srtFromVtt = cuesToSrt(vttCues)
eq(parseSrt(srtFromVtt), vttCues, 'VTT -> SRT -> parseSrt: cues 等价')
// SRT -> VTT -> 再解析: 逐条等价
eq(parseVtt(cuesToVtt(vttCues)), vttCues, 'SRT 侧数据 -> VTT -> parseVtt: cues 等价')
// 再转一圈也稳定 (幂等, 不累积漂移)
eq(cuesToSrt(parseSrt(srtFromVtt)), srtFromVtt, 'VTT->SRT 文本二次导出逐字稳定')
eq(cuesToVtt(parseVtt(cuesToVtt(vttCues))), cuesToVtt(vttCues), 'VTT 二次导出逐字稳定')
// 反向: 把 VTT 原文丢给 parseSrt 也不能捡到垃圾 —— 指令行/cue 标识行都没有 "-->",
// 所以两个解析器对同一份 VTT 给出同样的 cues (只有 NOTE 块里的正文才会被当成"无箭头行"跳过)
eq(parseSrt(VTT), vttCues, 'srt 解析器吃 VTT 原文: 不捡进指令块与 cue 标识')

// ---------- 2. 跨小时 / 逗号与点号 / 缺小时位 ----------
eq(parseVtt('00:00:00.000 --> 00:00:01.000\nx\n').length, 1, 'VTT 点号时间戳可解析')
eq(parseVtt('00:00:00,000 --> 00:00:01,000\nx\n').length, 1, 'VTT 逗号小数点也收 (脏数据兼容)')
eq(parseSrt('00:00:00,000 --> 00:00:01,000\nx\n').length, 1, 'SRT 逗号时间戳可解析')
eq(parseSrt('00:00:00.000 --> 00:00:01.000\nx\n').length, 1, 'SRT 点号也收')
eq(parseSrt('01:02:03,400 --> 01:02:04,000\n跨小时\n'), [{ from: 3723.4, to: 3724, text: '跨小时' }], 'SRT 跨小时')
eq(parseSrt('02:03.500 --> 02:05.000\n缺小时位\n'), [{ from: 123.5, to: 125, text: '缺小时位' }], 'SRT 缺小时位 (MM:SS.mmm)')
eq(parseVtt('01:02.345 --> 01:03.000\n缺小时位\n'), [{ from: 62.345, to: 63, text: '缺小时位' }], 'VTT 缺小时位 (MM:SS.mmm)')
eq(parseSrt('00:00:01 --> 00:00:02\n无毫秒\n'), [{ from: 1, to: 2, text: '无毫秒' }], '无毫秒位可解析')
eq(parseSrt('00:00:01,5 --> 00:00:02,25\n短毫秒\n'), [{ from: 1.5, to: 2.25, text: '短毫秒' }], '1-3 位毫秒按左补零')
// 10 小时以上不能截断 (小时位是位数不限的)
eq(parseSrt('10:00:00,000 --> 10:00:01,000\n长片\n'), [{ from: 36000, to: 36001, text: '长片' }], '两位数小时不丢')
eq(cuesToVtt([{ from: 36000, to: 36001, text: 'x' }]), 'WEBVTT\n\n10:00:00.000 --> 10:00:01.000\nx\n', '导出两位数小时')

// ---------- 3. 缺序号 SRT / 序号错乱 ----------
eq(parseSrt('00:00:01,000 --> 00:00:02,000\n无序号\n\n00:00:03,000 --> 00:00:04,000\n还是无序号\n'), [
  { from: 1, to: 2, text: '无序号' },
  { from: 3, to: 4, text: '还是无序号' }
], '缺序号 SRT 可解析')
eq(parseSrt('7\n00:00:01,000 --> 00:00:02,000\n序号乱写\n').length, 1, '序号是多少都不影响解析')
// 导出侧: 序号从 1 递增, 与入参里的任何 id 无关
const numbered = cuesToSrt([{ from: 0, to: 1, text: 'a' }, { from: 1, to: 2, text: 'b' }, { from: 2, to: 3, text: 'c' }])
ok(/^1\n/.test(numbered), 'cuesToSrt: 第一条序号是 1')
ok(/\n\n2\n/.test(numbered), 'cuesToSrt: 第二条序号是 2')
ok(/\n\n3\n/.test(numbered), 'cuesToSrt: 第三条序号是 3')
ok(numbered.endsWith('\n'), 'cuesToSrt: 末尾有换行')
ok(numbered.endsWith('\n\n'), 'cuesToSrt: 空行分隔且以换行收尾')

// ---------- 4. 坏行丢弃但不抛 ----------
noThrow(() => parseVtt(null), 'parseVtt(null) 不抛')
noThrow(() => parseSrt(undefined), 'parseSrt(undefined) 不抛')
noThrow(() => parseSubtitleJson(null), 'parseSubtitleJson(null) 不抛')
eq(parseVtt(null), [], 'parseVtt(null) -> []')
eq(parseSrt(undefined), [], 'parseSrt(undefined) -> []')
eq(parseSrt(''), [], '空文本 -> []')
eq(parseVtt('WEBVTT\n'), [], '只有头 -> []')

const dirty = [
  '00:00:01,000 --> 00:00:02,000',   // 缺文本 (合法清屏 cue, 要保留)
  '',
  '这不是时间轴',
  'xx:yy:zz,000 --> 00:00:03,000',   // 起始时间坏
  '垃圾文本',
  '',
  '00:00:04,000 --> aa:bb:cc,000',   // 结束时间坏
  '要丢',
  '',
  '00:00:05,000 --> 00:00:05,000',   // to == from
  '零长度要丢',
  '',
  '00:00:06,000 --> 00:00:05,000',   // to < from
  '倒序要丢',
  '',
  '00:00:07,000 --> 00:00:08,000',
  '好的一条'
].join('\n')
const dirtyCues = parseSrt(dirty)
eq(dirtyCues, [
  { from: 1, to: 2, text: '' },
  { from: 7, to: 8, text: '好的一条' }
], '坏行 (坏时间戳/零长度/倒序/无箭头) 全部丢弃, 只剩合法 cue')

// 缺空行分隔时不能把下一条的时间行吞进上一条文本
eq(parseSrt('00:00:01,000 --> 00:00:02,000\nA\n00:00:03,000 --> 00:00:04,000\nB\n'), [
  { from: 1, to: 2, text: 'A' },
  { from: 3, to: 4, text: 'B' }
], '缺空行分隔也能切开 (箭头行不并入文本)')
// CRLF + BOM 都要能吃
eq(parseSrt('\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nCRLF\r\n'), [{ from: 1, to: 2, text: 'CRLF' }], 'BOM + CRLF')

// ---------- 5. pickCue 边界 ----------
const cues = parseSrt('00:00:01,000 --> 00:00:04,000\nA\n\n00:00:04,000 --> 00:00:06,000\nB\n')
eq(pickCue(cues, 1), cues[0], 'pickCue: from 边界命中 (左闭)')
eq(pickCue(cues, 0.999), null, 'pickCue: from 之前不命中')
eq(pickCue(cues, 3.999), cues[0], 'pickCue: to 之前一刻仍命中')
eq(pickCue(cues, 4), cues[1], 'pickCue: 恰好 to (右开) 不命中 A, 命中下一条 B')
eq(pickCue(cues, 6), null, 'pickCue: 最后一条的 to 不命中')
eq(pickCue(cues, 100), null, 'pickCue: 越界 -> null')
eq(pickCue([], 1), null, 'pickCue: 空数组 -> null')
eq(pickCue(null, 1), null, 'pickCue: null 入参 -> null')
eq(pickCue(cues, NaN), null, 'pickCue: 非数时间 -> null')
eq(pickCue(cues, '2'), cues[0], 'pickCue: 数字字符串也认 (video.currentTime 常是字符串化的)')
// 重叠: 取第一条
const overlap = [
  { from: 0, to: 10, text: 'first' },
  { from: 2, to: 5, text: 'second' }
]
eq(pickCue(overlap, 3).text, 'first', 'pickCue: 多条命中取第一条')
// 不修改 cue 本身
ok(pickCue(overlap, 3) === overlap[0], 'pickCue 返回原对象引用 (页面不必再拷一次)')

// ---------- 6. offsetCues: 夹紧 / 保持 from < to / 不原地改 ----------
const src = [{ from: 1, to: 3, text: 'x', extra: 'keep' }, { from: 10, to: 12, text: 'y' }]
const shifted = offsetCues(src, 2.5)
eq(shifted.map((c) => [c.from, c.to]), [[3.5, 5.5], [12.5, 14.5]], 'offsetCues: 正偏移整体平移')
eq(src[0].from, 1, 'offsetCues: 不原地改入参')
ok(shifted[0] !== src[0], 'offsetCues: 返回新对象')
eq(shifted[0].extra, 'keep', 'offsetCues: cue 上的其它字段原样保留')
eq(shifted[0].text, 'x', 'offsetCues: 文本不变')

const clamped = offsetCues(src, -2.5)
eq(clamped.map((c) => [c.from, c.to]), [[0, 0.5], [7.5, 9.5]], 'offsetCues: 负偏移夹紧 from/to >= 0')
ok(clamped.every((c) => c.from >= 0 && c.to >= 0), 'offsetCues: 没有任何负时间戳')
const allNeg = offsetCues(src, -100)
ok(allNeg.every((c) => c.from === 0 && c.to > 0), 'offsetCues: 全推过 0 -> [0, 0.001] 退化但不出现 from >= to')
ok(allNeg.length === src.length, 'offsetCues: 退化的 cue 不删, 数组长度稳定')
ok(offsetCues(src, -1).every((c) => c.from < c.to), 'offsetCues: 夹紧后 from 仍严格小于 to')
eq(offsetCues([{ from: 1, to: 2, text: 'x' }], 0.1)[0].from, 1.1, 'offsetCues: 浮点偏移不产生 1.1000000000000001')
eq(offsetCues([{ from: 0.1, to: 0.3, text: 'x' }], 0.2)[0], { from: 0.3, to: 0.5, text: 'x' }, 'offsetCues: 0.1+0.2 量化到毫秒')
eq(offsetCues([], 5), [], 'offsetCues: 空数组 -> 空数组')
eq(offsetCues(null, 5), [], 'offsetCues: null -> 空数组')
eq(offsetCues(src, 'abc').length, 2, 'offsetCues: 非数偏移当 0 (不产出 NaN)')
ok(offsetCues(src, 'abc').every((c) => c.from === c.from && c.to === c.to), 'offsetCues: 非数偏移不产出 NaN')

// ---------- 7. pickSubtitles: 三种入参形态归一化 ----------
const rawSubs = [
  { id: 12345, id_str: '12345', lan: 'zh-CN', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/x/a.json', ai_type: 1 },
  { id: 99, lan: 'en-US', lan_doc: 'English', subtitle_url: 'http://aisubtitle.hdslb.com/x/b.json', ai_type: 0 },
  { id: 100, lan: 'zh-HK', lan_doc: '粵語', subtitle_url: '', ai_type: 0 }
]
const want = [
  { id: '12345', lan: 'zh-CN', lanDoc: '中文（自动生成）', url: 'https://aisubtitle.hdslb.com/x/a.json', aiType: 1 },
  { id: '99', lan: 'en-US', lanDoc: 'English', url: 'https://aisubtitle.hdslb.com/x/b.json', aiType: 0 }
]
eq(pickSubtitles({ data: { subtitle: { subtitles: rawSubs } } }), want, 'pickSubtitles: {data:{subtitle:{subtitles}}} 形态')
eq(pickSubtitles({ subtitle: { subtitles: rawSubs } }), want, 'pickSubtitles: {subtitle:{subtitles}} 形态')
eq(pickSubtitles(rawSubs), want, 'pickSubtitles: 数组本身形态')
eq(pickSubtitles({ data: rawSubs }), want, 'pickSubtitles: {data:[...]} 形态')
eq(pickSubtitles({ data: { subtitle: { subtitles: [] } } }), [], 'pickSubtitles: 空列表 -> []')
eq(pickSubtitles(null), [], 'pickSubtitles: null -> []')
eq(pickSubtitles({}), [], 'pickSubtitles: 空对象 -> []')
eq(pickSubtitles([{ lan: 'zh-CN' }]), [], 'pickSubtitles: 没有 url 的条目丢掉 (点了也没内容)')
// id 形态: 只有数字 id, 用 id_str 缺省
eq(pickSubtitles([{ id: 7, lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://a/b.json' }])[0].id, '7',
  'pickSubtitles: id 统一成字符串')
// ai_type 缺失 -> 0 (只有明确标 1 才打 AI 角标)
eq(pickSubtitles([{ lan: 'zh-CN', subtitle_url: 'https://a/b.json' }])[0].aiType, 0, 'pickSubtitles: ai_type 缺失按 0')
// lan_doc 缺失退回 lan
eq(pickSubtitles([{ lan: 'zh-CN', subtitle_url: 'https://a/b.json' }])[0].lanDoc, 'zh-CN', 'pickSubtitles: lan_doc 缺失退回 lan')
// 不修改入参
const keepRaw = [{ id: 1, lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//h/a.json' }]
pickSubtitles(keepRaw)
eq(keepRaw[0].subtitle_url, '//h/a.json', 'pickSubtitles: 不原地改成 https')
eq(Object.keys(pickSubtitles(keepRaw)[0]).sort(), ['aiType', 'id', 'lan', 'lanDoc', 'url'], 'pickSubtitles: 输出字段恰好 5 个')

// ---------- 8. parseSubtitleJson: 字符串 / 对象 / B 站真形态 ----------
const jsonObj = { body: [{ from: 0.5, to: 2.25, content: '你好' }, { from: 2.25, to: 4, content: '世界' }] }
const wantCues = [{ from: 0.5, to: 2.25, text: '你好' }, { from: 2.25, to: 4, text: '世界' }]
eq(parseSubtitleJson(jsonObj), wantCues, 'parseSubtitleJson: 对象入参')
eq(parseSubtitleJson(JSON.stringify(jsonObj)), wantCues, 'parseSubtitleJson: 字符串入参')
eq(parseSubtitleJson({ data: jsonObj }), wantCues, 'parseSubtitleJson: {data:{body}} 形态')
eq(parseSubtitleJson(jsonObj.body), wantCues, 'parseSubtitleJson: 数组本身形态')
eq(parseSubtitleJson('{坏 json'), [], 'parseSubtitleJson: 坏 JSON -> [] (不抛)')
eq(parseSubtitleJson(''), [], 'parseSubtitleJson: 空串 -> []')
eq(parseSubtitleJson(null), [], 'parseSubtitleJson: null -> []')
eq(parseSubtitleJson({ body: [] }), [], 'parseSubtitleJson: 空 body -> []')
noThrow(() => parseSubtitleJson('{坏 json'), 'parseSubtitleJson: 坏 JSON 不抛')
// 脏条目: 非数时间 / to<=from 丢弃, 文本里的换行压平
eq(parseSubtitleJson({ body: [
  { from: 1, to: 2, content: '好' },
  { from: 'x', to: 2, content: '坏 from' },
  { from: 3, to: 3, content: '零长度' },
  { from: 4, to: 3, content: '倒序' },
  null,
  { from: 5, to: 6, content: '换\n行' }
] }), [{ from: 1, to: 2, text: '好' }, { from: 5, to: 6, text: '换 行' }], 'parseSubtitleJson: 脏条目丢弃, 换行压平')
// CC JSON 解析结果能直接喂给导出/选帧 (同一条链)
eq(parseVtt(cuesToVtt(parseSubtitleJson(jsonObj))), wantCues, 'CC JSON -> VTT -> parseVtt 等价')
eq(parseSrt(cuesToSrt(parseSubtitleJson(jsonObj))), wantCues, 'CC JSON -> SRT -> parseSrt 等价')
eq(pickCue(parseSubtitleJson(jsonObj), 1).text, '你好', 'CC JSON -> pickCue 命中')
ok(cuesToVtt(parseSubtitleJson(jsonObj)).startsWith('WEBVTT\n'), 'cuesToVtt: 必须以 WEBVTT 头开始')
ok(cuesToVtt(parseSubtitleJson(jsonObj)).endsWith('\n'), 'cuesToVtt: 末尾有换行')

// ---------- 9. HTML 标签原样保留 (B 站字幕带 <b>/<i>) ----------
const html = [{ from: 1, to: 2, text: '<b>重点</b> <i>斜体</i> &amp;' }]
eq(parseVtt(cuesToVtt(html))[0].text, '<b>重点</b> <i>斜体</i> &amp;', 'VTT: HTML 标签不被吃掉')
eq(parseSrt(cuesToSrt(html))[0].text, '<b>重点</b> <i>斜体</i> &amp;', 'SRT: HTML 标签不被吃掉')

// ---------- 10. 空输入的导出侧 ----------
eq(cuesToVtt([]), 'WEBVTT\n', 'cuesToVtt: 空数组给合法空 VTT')
eq(cuesToSrt([]), '', 'cuesToSrt: 空数组给空串')
eq(cuesToVtt(null), 'WEBVTT\n', 'cuesToVtt: null 不抛')
eq(cuesToSrt(null), '', 'cuesToSrt: null 不抛')
eq(parseVtt(cuesToVtt([])), [], '空 VTT 再解析 -> []')
eq(parseSrt(cuesToSrt([])), [], '空 SRT 再解析 -> []')

// ---------- 汇总 ----------
if (fails.length) {
  console.log('FAIL subtitle: ' + fails.length + ' 条断言红了 (过 ' + pass + ' 条)')
  for (const m of fails) console.log('  - ' + m)
  process.exit(1)
}
console.log('PASS subtitle parse (VTT/SRT 互转等价 · 跨小时 · 逗号点号 · 缺序号 · 坏行丢弃 · 缺小时位)')
console.log('PASS subtitle pick (pickCue 左闭右开 · from 命中 to 不命中 · 重叠取首条)')
console.log('PASS subtitle offset (夹紧 >= 0 · 恒 from < to · 不原地改 · 毫秒量化)')
console.log('PASS subtitle list (detail 三种入参形态 · id 字符串化 · url 补协议 · aiType 默认 0)')
console.log('PASS subtitle export (cuesToVtt/cuesToSrt 末尾换行 · SRT 序号从 1 · HTML 标签保留 · 空输入)')
console.log('PASS ' + pass + ' 条断言全部通过 (subtitle.js 纯逻辑, 无 import)')
