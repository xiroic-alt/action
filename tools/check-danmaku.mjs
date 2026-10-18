// 离线门禁: 视频弹幕纯逻辑 (services/danmaku.js)
//
// 为什么需要它: 弹幕这条链上的东西**全是纯几何 + 时间**, 但真机验证成本极高 ——
// 要有一个弹幕密集的视频、要盯着 266px 的屏看叠不叠字, 而且播放中每帧都在算.
// 这里把可证明的部分钉死:
//   解析(转义/坏行/颜色/模式白名单) · Pakku 合并(窗口/阈值/放大上限) · 屏蔽(非法正则不炸)
//   · 泳道不相交(500 条随机性质测试) · 顶底弹幕不合并 · 时刻命中 · 空/畸形输入不抛.
//
// 加载方式照 tools/check-live.mjs: 先注入 __bilinet / $falcon 桩件, 再 register('./esm-hooks.mjs')
// 让 ui/src 下的 .js 在 Node 18 上也被当成 ESM 解析 (Node 24 会自动猜, CI 上不会).
// danmaku.js 本身是纯逻辑 (不 import 任何模块), 桩件只是让这条链路与其它门禁保持同一套姿势.
//
// 用法: node tools/check-danmaku.mjs   (退出码非 0 = 有断言失败, CI 可直接拦)

import assert from 'node:assert/strict'
import { register } from 'node:module'
import fs from 'node:fs'

globalThis.__bilinet = { readFile: () => '', writeFile: () => true, mkdirs: () => true }
globalThis.$falcon = { Page: class Page {}, App: class App {}, eventMap: {} }
globalThis.$page = { options: {}, setTimeout, clearTimeout, setInterval, clearInterval }
register('./esm-hooks.mjs', import.meta.url)

const SRC = new URL('../ui/src/services/danmaku.js', import.meta.url)
const dm = await import(SRC)
const raw = fs.readFileSync(SRC, 'utf8')
// 纯度检查要跳过注释: 注释里写着"不碰 bilinet"不代表代码碰了
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => (l.trim().slice(0, 2) === '//' ? '' : l))
  .join('\n')

let pass = 0
const fails = []
function ok(cond, msg) { if (cond) { pass++; return } fails.push(msg) }
function eq(a, b, msg) {
  try { assert.deepEqual(a, b); pass++ } catch (e) {
    fails.push(msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')
  }
}
function safe(fn, msg) {
  try { return fn() } catch (e) { fails.push(msg + ' -> 抛了: ' + (e && e.message ? e.message : e)); return undefined }
}
const Q = String.fromCharCode(39)     // '  —— 期望值里避开转义地狱, 一律拼出来
const DQ = String.fromCharCode(34)    // "

const {
  parseDanmakuXml, mergeDanmaku, filterDanmaku, buildTracks, estimateWidth, visibleAt, colorHex
} = dm

// ================= 0. 模块纯度 (页面和门禁都要能直接加载) =================
ok(!/(^|\n)\s*import\s/.test(code), 'danmaku.js 不 import 任何模块 (纯逻辑, 不许有依赖)')
ok(!/\brequire\s*\(/.test(code), 'danmaku.js 不使用 require')
ok(!/bilinet|readFile|writeFile/.test(code), 'danmaku.js 不碰 bilinet / 文件系统')
ok(typeof parseDanmakuXml === 'function' && typeof mergeDanmaku === 'function'
  && typeof filterDanmaku === 'function' && typeof buildTracks === 'function'
  && typeof estimateWidth === 'function' && typeof visibleAt === 'function',
  '六个约定导出都在 (parseDanmakuXml/mergeDanmaku/filterDanmaku/buildTracks/estimateWidth/visibleAt)')
ok(typeof colorHex === 'function', 'colorHex 导出在 (十进制 RGB -> #rrggbb 的唯一转换点)')

// ================= 1. 正常 XML 解析 =================
// 真实响应形态 (docs/danmaku/danmaku_xml.md): 头部一堆 <chatserver>/<chatid>/... 混在文档里
const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<i>',
  '  <chatserver>chat.bilibili.com</chatserver>',
  '  <chatid>144541892</chatid>',
  '  <maxlimit>1500</maxlimit>',
  '  <d p="490.19100,1,25,16777215,1584268892,0,a16fe0dd,29950852386521095">从结尾回来看这里，更感动了！</d>',
  '  <d p="18.77300,1,25,16777215,1584268920,0,4fe08d3,29950867226492933">咦三体居然还有动画</d>',
  '  <d p="3.50000,5,18,16646914,1584268999,0,deadbeef,1">顶端红字</d>',
  '  <d p="4.25000,4,36,255,1584269001,0,deadbeee,2">底端蓝字</d>',
  '</i>'
].join('\n')
const parsed = safe(() => parseDanmakuXml(XML), 'parseDanmakuXml: 正常 XML')
eq(parsed.length, 4, 'parseDanmakuXml: 只认 <d> 行, 头部元信息不算弹幕')
eq(parsed[0], { t: 490.191, mode: 1, size: 25, color: 16777215, text: '从结尾回来看这里，更感动了！' }, 'parseDanmakuXml: 首条字段与形状')
eq(parsed[2].mode, 5, 'parseDanmakuXml: 模式 5 = 顶端')
eq(parsed[2].size, 18, 'parseDanmakuXml: 字号 18 = 小')
eq(parsed[2].color, 16646914, 'parseDanmakuXml: 颜色保持十进制整数 (与签名一致)')
eq(parsed[3].mode, 4, 'parseDanmakuXml: 模式 4 = 底端')
ok(Object.keys(parsed[0]).sort().join(',') === 'color,mode,size,t,text', 'parseDanmakuXml: 输出恰好 5 个字段')
ok(typeof parsed[0].t === 'number' && typeof parsed[0].mode === 'number'
  && typeof parsed[0].size === 'number' && typeof parsed[0].color === 'number'
  && typeof parsed[0].text === 'string', 'parseDanmakuXml: 字段类型 (t/mode/size/color 数字, text 字符串)')

// ================= 2. 转义与坏行 =================
const ESC = [
  '<i>',
  '<d p="1,1,25,16777215,0,0,h,1">A&amp;B &lt;3 &gt;2 &quot;引&quot; &#39;单&#39; &apos;二&apos;</d>',
  // ★ 双重转义: 只能解一层 ("&amp;lt;" -> "&lt;"), 不能连解成 "<"
  '<d p="2,1,25,16777215,0,0,h,2">&amp;lt;3 &amp;amp; &#38;</d>',
  // 未知实体原样保留 (不造怪字符)
  '<d p="3,1,25,16777215,0,0,h,3">&bogus; &amp;</d>',
  '<d p="4,1,25,16777215,0,0,h,4">  </d>',                        // 只有空白: 丢
  '<d>没有 p 属性</d>',                                             // 丢
  '<d p="5,1,25">p 只有 3 段</d>',                                  // 丢
  '<d p="-1,1,25,16777215">负时间</d>',                             // 丢
  '<d p="abc,1,25,16777215">时间不是数字</d>',                       // 丢
  '<d p="6,7,25,16777215">高级弹幕</d>',                             // 丢 (本机不支持)
  '<d p="7,8,25,16777215">代码弹幕</d>',                             // 丢
  '<d p="8,9,25,16777215">BAS 弹幕</d>',                             // 丢
  '<d p="9,0,25,16777215">非法模式 0</d>',                           // 丢
  // 脏字号/脏颜色不丢整行, 退默认 (字号 25 / 白色): 弹幕本体是好的, 只是参数脏
  '<d p="10,1,0,99999999,0,0,h,10">字号颜色都越界</d>',
  '</i>'
].join('\n')
const esc = safe(() => parseDanmakuXml(ESC), 'parseDanmakuXml: 转义与坏行')
eq(esc.length, 4, 'parseDanmakuXml: 13 条坏行全跳过, 只剩 4 条好行')
eq(esc.map((x) => x.text), [
  'A&B <3 >2 ' + DQ + '引' + DQ + ' ' + Q + '单' + Q + ' ' + Q + '二' + Q,
  '&lt;3 &amp; &',
  '&bogus; &',
  '字号颜色都越界'
], 'parseDanmakuXml: 实体单次反转义 (不连解, 未知实体原样留)')
eq(esc[3], { t: 10, mode: 1, size: 25, color: 16777215, text: '字号颜色都越界' }, 'parseDanmakuXml: 脏字号退 25 / 脏颜色退白')
ok(esc.every((x) => x.t >= 0 && x.mode >= 1 && x.mode <= 6), 'parseDanmakuXml: 输出里没有负时间/非法模式')

// 单引号包裹的属性值也要认 (XML 合法, 真实数据少见)
const sq = safe(() => parseDanmakuXml("<i><d p='11.5,6,25,65280'>逆向绿字</d></i>"), 'parseDanmakuXml: 单引号 p')
eq(sq.length, 1, 'parseDanmakuXml: 单引号属性也认')
eq(sq[0].mode, 6, 'parseDanmakuXml: 模式 6 = 逆向')

// ================= 3. 颜色转换 (十进制 RGB -> #rrggbb) =================
eq(colorHex(16777215), '#ffffff', 'colorHex: 白')
eq(colorHex(0), '#000000', 'colorHex: 黑')
eq(colorHex(16646914), '#fe0302', 'colorHex: FE0302 (协议文档里的红)')
eq(colorHex(52480), '#00cd00', 'colorHex: 00CD00 (协议文档里的绿, 需要补零)')
eq(colorHex(0x00cd00), '#00cd00', 'colorHex: 与十六进制字面量一致')
eq(colorHex(-5), '#ffffff', 'colorHex: 负值退白')
eq(colorHex('abc'), '#ffffff', 'colorHex: 非数字退白')
eq(colorHex(0x1000000), '#ffffff', 'colorHex: 超 24 位退白')

// ================= 4. Pakku 合并: 窗口与阈值 =================
// 同一句话 0/5/10 秒各一条, window=6: 0 与 5 同簇 (差 5), 与 10 差 10 超窗 -> 另起一簇.
// ★ 锚点必须是"簇内最早那条": 若拿上一条当参照, 0/5/10 会链式并成一簇, 弹幕整体被拖晚.
const chain = [
  { t: 10, text: 'awsl', color: 16777215 },
  { t: 0, text: 'awsl', color: 16777215 },
  { t: 5, text: 'awsl', color: 16777215 }
]
const merged = safe(() => mergeDanmaku(chain, { windowSec: 6, threshold: 3, growth: 0.12, maxScale: 2.2 }), 'mergeDanmaku: 窗口')
eq(merged.length, 2, 'mergeDanmaku: 0/5 同簇, 10 另起一簇 (不链式并簇)')
eq(merged[0], { t: 0, text: 'awsl', color: 16777215, count: 2, scale: 1 }, 'mergeDanmaku: 取最早时间 + count 累加 + 未过阈值不放大')
eq(merged[1].t, 10, 'mergeDanmaku: 第二簇从 10 秒开始')
eq(Object.keys(merged[0]).sort().join(','), 'color,count,scale,t,text', 'mergeDanmaku: 输出形状恰好 5 个字段')
eq(chain[0].t, 10, 'mergeDanmaku: 不修改入参 (也不会顺手排序入参)')

// 阈值: count <= threshold 不放大; 过阈值线性放大; 到 maxScale 封顶
function countOf(n) {
  const list = []
  for (let i = 0; i < n; i++) list.push({ t: i * 0.01, text: 'hit', color: 1 })
  const r = mergeDanmaku(list, { windowSec: 6, threshold: 3, growth: 0.12, maxScale: 2.2 })
  return r.length === 1 ? r[0] : null
}
eq(countOf(1).scale, 1, 'mergeDanmaku: 单条不放大')
eq(countOf(3).scale, 1, 'mergeDanmaku: count == threshold 仍不放大')
ok(Math.abs(countOf(4).scale - 1.12) < 1e-9, 'mergeDanmaku: count=4 -> 1 + 1*0.12')
ok(Math.abs(countOf(5).scale - 1.24) < 1e-9, 'mergeDanmaku: count=5 -> 1 + 2*0.12')
ok(Math.abs(countOf(100).scale - 2.2) < 1e-9, 'mergeDanmaku: 放大上限 maxScale=2.2 (不会无限变大)')
eq(countOf(100).count, 100, 'mergeDanmaku: 封顶只影响 scale, count 仍如实累计')
// 自定义 opts: threshold=0 + growth=0.5, 3 条 -> 1 + 3*0.5 = 2.5 (未到 maxScale=9 的封顶)
const custom = mergeDanmaku([
  { t: 0, text: 'y' }, { t: 0.1, text: 'y' }, { t: 0.2, text: 'y' }
], { threshold: 0, growth: 0.5, maxScale: 9 })
eq(custom.length, 1, 'mergeDanmaku: 自定义 opts 仍按 windowSec 合并成一簇')
ok(Math.abs(custom[0].scale - 2.5) < 1e-9, 'mergeDanmaku: threshold=0 + growth=0.5 -> scale 2.5 (opts 真的生效)')

// 窗口边界: 差恰好 == windowSec 算同簇 (<=), 略超即分簇
eq(mergeDanmaku([{ t: 0, text: 'x' }, { t: 6, text: 'x' }], { windowSec: 6 }).length, 1, 'mergeDanmaku: 差恰好等于 windowSec 也算同簇')
eq(mergeDanmaku([{ t: 0, text: 'x' }, { t: 6.001, text: 'x' }], { windowSec: 6 }).length, 2, 'mergeDanmaku: 略超窗口即分簇')

// 不同文本不合并; 单条原样输出; 空文本丢弃
eq(mergeDanmaku([{ t: 0, text: 'a' }, { t: 1, text: 'b' }]).length, 2, 'mergeDanmaku: 不同文本不合并')
eq(mergeDanmaku([{ t: 0, text: 'a' }]).length, 1, 'mergeDanmaku: 单条原样输出')
eq(mergeDanmaku([{ t: 0, text: '' }, { t: 1, text: 'ok' }]).length, 1, 'mergeDanmaku: 空文本丢弃')
// 文本可以是 __proto__ 这种键 (普通对象会把分组表打穿)
const proto = safe(() => mergeDanmaku([{ t: 0, text: '__proto__' }, { t: 1, text: '__proto__' }]), 'mergeDanmaku: __proto__ 键')
eq(proto.length, 1, 'mergeDanmaku: text="__proto__" 也能正常分组合并')
eq(proto[0].count, 2, 'mergeDanmaku: __proto__ 组 count=2')
const ctor = safe(() => mergeDanmaku([{ t: 0, text: 'constructor' }, { t: 1, text: 'toString' }]), 'mergeDanmaku: prototype 键')
eq(ctor.length, 2, 'mergeDanmaku: constructor/toString 这类键也各自成组')

// ================= 5. 顶/底弹幕不参与合并 =================
// 4 = 底端, 5 = 顶端: 定点停留, 同文本同时刻也是两条独立弹幕 -> 必须原样各留一条
const tb = mergeDanmaku([
  { t: 0, text: '重复的话', mode: 5 },
  { t: 0, text: '重复的话', mode: 5 },
  { t: 0, text: '重复的话', mode: 4 },
  { t: 1, text: '重复的话', mode: 4 },
  { t: 0, text: '重复的话', mode: 1 }
], { keepMode: true })
eq(tb.length, 5, 'mergeDanmaku: 顶/底弹幕一条都不合并')
eq(tb.filter((x) => x.mode === 5).length, 2, 'mergeDanmaku: 两条顶端弹幕都在')
eq(tb.filter((x) => x.mode === 4).length, 2, 'mergeDanmaku: 两条底端弹幕都在')
eq(tb.map((x) => x.count), [1, 1, 1, 1, 1], 'mergeDanmaku: 顶/底弹幕 count 恒为 1')
const scrollMerge = mergeDanmaku([
  { t: 0, text: 'emmm', mode: 1 }, { t: 0.5, text: 'emmm', mode: 6 }, { t: 1, text: 'emmm', mode: 3 }
])
eq(scrollMerge.length, 1, 'mergeDanmaku: 滚动类 1/2/3/6 之间正常合并')
eq(scrollMerge[0].count, 3, 'mergeDanmaku: 滚动合并 count = 3')
eq(scrollMerge[0].mode, undefined, 'mergeDanmaku: 默认不带 mode (形状与约定一致)')
eq(mergeDanmaku([{ t: 0, text: 'm', mode: 1 }, { t: 1, text: 'm', mode: 1 }], { keepMode: true })[0].mode, 1, 'mergeDanmaku: keepMode 时才带出 mode')

// ================= 6. 屏蔽过滤 =================
const base = [
  { t: 0, text: '这是广告', color: 1, count: 4, scale: 1.12 },
  { t: 1, text: 'awsl', color: 2 },
  { t: 2, text: '前面的别走', color: 3, mode: 5 },
  { t: 3, text: '233333', color: 4, mode: 4 },
  { t: 4, text: 'x', color: 5 }
]
const keep = safe(() => filterDanmaku(base, { keywords: ['广告'], regexes: [], modes: [], minLength: 0 }), 'filterDanmaku: 关键词')
eq(keep.map((x) => x.text), ['awsl', '前面的别走', '233333', 'x'], 'filterDanmaku: keywords 子串命中即丢')
eq(keep[0].count, undefined, 'filterDanmaku: 没命中的字段按原样 (无 count 就没有)')
ok(keep !== base && keep[0] !== base[1], 'filterDanmaku: 输出是新数组 + 浅拷贝 (不与入参共享对象)')
eq(base.length, 5, 'filterDanmaku: 不修改入参数组')

const keepAll = filterDanmaku(base, { keywords: [] })
eq(keepAll[0].count, 4, 'filterDanmaku: count 保留不丢')
eq(keepAll[0].scale, 1.12, 'filterDanmaku: scale 保留不丢')
eq(keepAll[2].mode, 5, 'filterDanmaku: mode 保留不丢')

eq(filterDanmaku(base, { regexes: ['^\\d+$'] }).map((x) => x.text), ['这是广告', 'awsl', '前面的别走', 'x'], 'filterDanmaku: 字符串正则命中即丢')
eq(filterDanmaku(base, { regexes: [/^a/] }).map((x) => x.text), ['这是广告', '前面的别走', '233333', 'x'], 'filterDanmaku: RegExp 实例也能用')
eq(filterDanmaku(base, { regexes: /^2/ }).map((x) => x.text).length, 4, 'filterDanmaku: 单个正则(不包数组)也接受')
// ★ 非法正则: 忽略这一条, 不能抛, 其它规则照常生效
const badRe = safe(() => filterDanmaku(base, { regexes: ['([', 'a)b', /ok/g], keywords: ['广告'] }), 'filterDanmaku: 非法正则')
eq(badRe.map((x) => x.text), ['awsl', '前面的别走', '233333', 'x'], 'filterDanmaku: 非法正则被忽略, 其余规则仍然生效')
// /g 正则的 lastIndex 会推进: 连跑两次结果必须一致 (否则"一条命中、一条漏过")
const gRe = filterDanmaku(base, { regexes: [/^a/g] })
const gRe2 = filterDanmaku(base, { regexes: [/^a/g] })
eq(gRe.length, gRe2.length, 'filterDanmaku: /g 正则重复调用结果稳定 (lastIndex 复位)')
// 空正则/空屏蔽词: 跳过 (否则命中一切, 全屏清空)
eq(filterDanmaku(base, { regexes: [''], keywords: [''] }).length, 5, 'filterDanmaku: 空正则 / 空屏蔽词不会被当成"命中一切"')
eq(filterDanmaku(base, { regexes: ['x'.repeat(500)] }).length, 5, 'filterDanmaku: 超长正则直接跳过 (防回溯冻住主线程)')

eq(filterDanmaku(base, { modes: [5, 4] }).map((x) => x.text), ['这是广告', 'awsl', 'x'], 'filterDanmaku: modes 命中即丢')
eq(filterDanmaku(base, { modes: [] }).length, 5, 'filterDanmaku: modes 为空数组 = 不过滤')
eq(filterDanmaku(base, { minLength: 3 }).map((x) => x.text), ['这是广告', 'awsl', '前面的别走', '233333'], 'filterDanmaku: minLength 小于即丢')
// minLength 按码点计: emoji 是一个字 (UTF-16 长度 2), 不该被 minLength=2 留下
eq(filterDanmaku([{ t: 0, text: '😀' }, { t: 1, text: 'ab' }], { minLength: 2 }).map((x) => x.text), ['ab'], 'filterDanmaku: minLength 按码点计 (emoji 算 1 个字)')

// ================= 7. 宽度估算 =================
eq(estimateWidth('', 22), 0, 'estimateWidth: 空串 0')
eq(estimateWidth('ab', 22), Math.ceil(2 * 0.55 * 22), 'estimateWidth: 两个 ASCII = 0.55*2*字号, 向上取整')
eq(estimateWidth('中文', 22), 44, 'estimateWidth: 两个全角 = 2*字号')
eq(estimateWidth('a中', 22), Math.ceil(0.55 * 22) + 22, 'estimateWidth: 混排按字符累加后向上取整')
ok(estimateWidth('中文', 22) > estimateWidth('ab', 22), 'estimateWidth: 全角比半角宽')
ok(estimateWidth('abc', 22) % 1 === 0, 'estimateWidth: 返回整数')
eq(estimateWidth('ab', 0), Math.ceil(2 * 0.55 * 22), 'estimateWidth: 非法字号退默认 22')
ok(estimateWidth('ab') === estimateWidth('ab', 22), 'estimateWidth: 默认字号 22')

// ================= 8. 泳道: 基本性质 =================
const basic = buildTracks([
  { t: 0, text: 'a' }, { t: 0, text: 'b' }, { t: 0, text: 'c' },
  { t: 1, text: 'd' }, { t: 9, text: 'e' }
], { areaW: 474, areaH: 266, fontSize: 22, speedPx: 60 })
eq(basic.lanes, 8, 'buildTracks: 缺省泳道数 = floor(266 / (22*1.5)) = 8')
eq(basic.items.length, 5, 'buildTracks: 全部装得下')
eq(basic.items.map((x) => x.lane), [0, 1, 2, 3, 0], 'buildTracks: 同刻各占一条泳道, 空出的 0 号被后续复用')
ok(Math.abs(basic.items[0].dur - 474 / 60) < 1e-9, 'buildTracks: 缺省 dur = areaW / speedPx')
ok(basic.items.every((x) => x.w > 0 && x.lane >= 0 && x.lane < basic.lanes), 'buildTracks: 每项都有合法 lane 与正宽度')
eq(basic.items[0].w, estimateWidth('a', 22), 'buildTracks: w 来自 estimateWidth')
eq(basic.items.map((x) => x.t), [0, 0, 0, 1, 9], 'buildTracks: 输出按 t 升序')
eq(basic.items[0].text, 'a', 'buildTracks: text/color 原样带出')
eq(buildTracks([{ t: 0, text: 'a', count: 4, scale: 1.12 }], {}).items[0].scale, 1.12, 'buildTracks: count/scale 原样带出 (合并后的放大要能到页面)')

// 显式 dur 优先于默认
eq(buildTracks([{ t: 0, text: 'a', dur: 2.5 }], {}).items[0].dur, 2.5, 'buildTracks: 元素自带 dur 时照用')
// maxLanes 截断: 装不下的丢弃, 绝不叠成一团
const crowded = []
for (let i = 0; i < 50; i++) crowded.push({ t: 0, text: 'same-instant-' + i })
const capped = buildTracks(crowded, { areaH: 266, fontSize: 22, maxLanes: 3 })
eq(capped.lanes, 3, 'buildTracks: maxLanes 生效')
eq(capped.items.length, 3, 'buildTracks: 泳道满 -> 多余弹幕丢弃 (50 条同时刻只剩 3 条)')
ok(capped.items.every((x) => x.lane < 3), 'buildTracks: 没有任何项落在 maxLanes 之外')
// areaH 小于一行也要给 1 条泳道 (0 泳道 = 整页一条都没有, 比挤压更像坏了)
eq(buildTracks([{ t: 0, text: 'a' }], { areaH: 10, fontSize: 22 }).lanes, 1, 'buildTracks: 退化高度至少 1 条泳道')
// 顶/底弹幕默认停留 4s
eq(buildTracks([{ t: 0, text: 'top', mode: 5 }, { t: 0, text: 'bottom', mode: 4 }], {}).items.map((x) => x.dur), [4, 4], 'buildTracks: 顶/底弹幕默认停留 4s')
// 乱序输入也能排 (内部排序): 与已排序输入结果一致
const unsorted = [{ t: 9, text: 'e' }, { t: 1, text: 'd' }, { t: 0, text: 'a' }]
eq(buildTracks(unsorted, {}).items.map((x) => x.t), [0, 1, 9], 'buildTracks: 乱序输入内部排序')
eq(buildTracks(basic.items, {}).items.length, 5, 'buildTracks: 对自家输出再排一次也稳定 (页面重排用)')

// ================= 9. 泳道性质测试: 500 条随机数据, 同泳道时间区间绝不相交 =================
// 这只是"性质", 不是"必须排满": 断言只看可证明的那半句 —— 同 lane 内不重叠.
function rnd(seed) {
  let s = seed >>> 0
  return function () { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296 }
}
const rand = rnd(20261018)
const pool = ['前方高能', 'awsl', '哈哈哈哈', '这段太强了', '2333', 'up加油', '来了来了', '泪目']
const rndList = []
for (let i = 0; i < 500; i++) {
  const mode = [1, 2, 3, 4, 5, 6][Math.floor(rand() * 6)]
  rndList.push({
    t: Math.round(rand() * 60000) / 100,     // 0..600s, 百分之一秒
    mode,
    text: pool[Math.floor(rand() * pool.length)] + (rand() < 0.3 ? String(Math.floor(rand() * 5)) : ''),
    color: Math.floor(rand() * 0xffffff)
  })
}
const tracks = safe(() => buildTracks(rndList, { areaW: 474, areaH: 266, fontSize: 22, speedPx: 60, maxLanes: 6 }), 'buildTracks: 500 条随机')
ok(tracks.items.length > 0, 'buildTracks: 500 条随机数据至少排出一部分')
ok(tracks.items.length <= 500, 'buildTracks: 不会凭空多出弹幕')
ok(tracks.items.every((x) => x.t >= 0 && x.dur > 0 && x.w > 0), 'buildTracks: 每项 t>=0 / dur>0 / w>0')
ok(tracks.items.every((x) => x.lane >= 0 && x.lane < tracks.lanes), 'buildTracks: lane 全在 0..lanes-1 之间')
let overlap = null
const byLane = {}
for (const it of tracks.items) {
  const key = String(it.lane)
  if (!byLane[key]) byLane[key] = []
  byLane[key].push(it)
}
for (const key of Object.keys(byLane)) {
  const laneItems = byLane[key].slice().sort((a, b) => a.t - b.t)
  for (let i = 1; i < laneItems.length; i++) {
    const prev = laneItems[i - 1]
    const cur = laneItems[i]
    // 左闭右开: prev 的结束正好等于 cur 的开始是**允许**的 (同一帧不会两条同时出现)
    if (prev.t + prev.dur > cur.t + 1e-9) {
      overlap = 'lane ' + key + ': [' + prev.t + ',' + (prev.t + prev.dur) + ') 与 [' + cur.t + ',' + (cur.t + cur.dur) + ') 相交'
      break
    }
  }
  if (overlap) break
}
ok(overlap === null, 'buildTracks: 500 条随机数据同泳道时间区间两两不相交 ' + (overlap || ''))
eq(Object.keys(byLane).length, tracks.lanes, 'buildTracks: 声明的 lanes 都被用到 (没有虚报泳道数)')
eq(new Set(tracks.items).size, tracks.items.length, 'buildTracks: 每个条目只排一次 (不会重复)')
// 决定性: 同一条弹幕不会在两帧里跳泳道 (纯函数 -> 同样输入同样输出)
eq(buildTracks(rndList, { areaW: 474, areaH: 266, fontSize: 22, speedPx: 60, maxLanes: 6 }).items.map((x) => x.lane),
  tracks.items.map((x) => x.lane), 'buildTracks: 同一输入两次调用结果完全一致')

// ================= 10. 时刻命中 visibleAt =================
const vis = [
  { t: 0, text: 'a', dur: 2 },
  { t: 5, text: 'b', dur: 7.9 },
  { t: 6, text: 'c', mode: 5 }
]
eq(visibleAt(vis, 0).map((x) => x.text), ['a'], 'visibleAt: 左闭 (t 时刻命中)')
eq(visibleAt(vis, 1.999).map((x) => x.text), ['a'], 'visibleAt: 区间内命中')
eq(visibleAt(vis, 2).map((x) => x.text), [], 'visibleAt: 右开 (t+dur 时刻不再命中)')
eq(visibleAt(vis, -0.1), [], 'visibleAt: 片头之前什么都没有')
eq(visibleAt(vis, 6).map((x) => x.text).sort(), ['b', 'c'], 'visibleAt: 多条同时命中')
ok(visibleAt(vis, 6)[0] === vis[1], 'visibleAt: 返回原对象引用 (逐帧调用不复制)')
eq(visibleAt(vis, NaN), [], 'visibleAt: 非数字时刻 -> 空数组')
eq(visibleAt(null, 1), [], 'visibleAt: items 为 null -> 空数组')
eq(visibleAt([{ t: 0, text: 'x' }], 0).length, 1, 'visibleAt: 缺 dur 时按缺省时长兜底')
eq(visibleAt([{ t: 0, text: 'x' }], 100).length, 0, 'visibleAt: 缺 dur 的过了兜底时长就消失')
eq(visibleAt([{ t: 0, text: 'x', mode: 5 }], 3.9).length, 1, 'visibleAt: 顶端弹幕按 4s 兜底')
eq(visibleAt([{ t: 0, text: 'x', mode: 5 }], 4).length, 0, 'visibleAt: 顶端弹幕 4s 后消失')

// ================= 11. 空 / 畸形输入: 返回空, 绝不抛 =================
const weird = [
  ['parseDanmakuXml("")', () => parseDanmakuXml('')],
  ['parseDanmakuXml(null)', () => parseDanmakuXml(null)],
  ['parseDanmakuXml(undefined)', () => parseDanmakuXml(undefined)],
  ['parseDanmakuXml(123)', () => parseDanmakuXml(123)],
  ['parseDanmakuXml({})', () => parseDanmakuXml({})],
  ['parseDanmakuXml(半截 XML)', () => parseDanmakuXml('<i><d p="1,1,25,16777215">没闭合')],
  ['parseDanmakuXml(p 为空)', () => parseDanmakuXml('<i><d p="">x</d></i>')],
  ['mergeDanmaku()', () => mergeDanmaku()],
  ['mergeDanmaku(null)', () => mergeDanmaku(null)],
  ['mergeDanmaku([null, undefined, {}])', () => mergeDanmaku([null, undefined, {}])],
  ['filterDanmaku()', () => filterDanmaku()],
  ['filterDanmaku(null, null)', () => filterDanmaku(null, null)],
  ['filterDanmaku([null], {})', () => filterDanmaku([null], {})],
  ['buildTracks()', () => buildTracks()],
  ['buildTracks(null, null)', () => buildTracks(null, null)],
  ['buildTracks([null, {t:-1,text:"x"}, {t:0}])', () => buildTracks([null, { t: -1, text: 'x' }, { t: 0 }])],
  ['visibleAt()', () => visibleAt()],
  ['estimateWidth(null)', () => estimateWidth(null)]
]
for (const [name, fn] of weird) {
  let res
  try { res = fn(); pass++ } catch (e) {
    fails.push(name + ' -> 抛了: ' + (e && e.message ? e.message : e)); continue
  }
  ok(res === undefined || res instanceof Array || typeof res === 'number' || (res && res.items instanceof Array),
    name + ' -> 返回了非法形状')
}
eq(parseDanmakuXml(''), [], 'parseDanmakuXml: 空串 -> []')
eq(parseDanmakuXml(null), [], 'parseDanmakuXml: null -> []')
eq(parseDanmakuXml('<i><d p="1,1,25,16777215">没闭合'), [], 'parseDanmakuXml: 未闭合 <d> 不产出 (也不会抛)')
eq(mergeDanmaku([]), [], 'mergeDanmaku: [] -> []')
eq(filterDanmaku([], {}), [], 'filterDanmaku: [] -> []')
eq(buildTracks([]), { lanes: 8, items: [] }, 'buildTracks: 空输入 -> 8 条空泳道')
eq(visibleAt([], 0), [], 'visibleAt: 空列表 -> []')
eq(estimateWidth(null), 0, 'estimateWidth: null -> 0')

// ★ 整链的关键接线: 合并默认**不带 mode** (输出形状严格按约定 { t, text, color, count, scale }),
//   而 buildTracks 要靠 mode 区分顶/底弹幕 -> 想保住顶/底语义, 合并时必须传 { keepMode: true }.
//   下面两条断言把这个边界钉死, 免得接错线时"顶端弹幕变成横向滚过去"没人发现.
const wholeNoMode = safe(() => {
  const t2 = buildTracks(mergeDanmaku(parseDanmakuXml(XML), {}), { areaW: 474, areaH: 266, fontSize: 22, speedPx: 60 })
  return t2
}, '整链: 默认合并 (不带 mode)')
ok(wholeNoMode.items.every((x) => Math.abs(x.dur - 474 / 60) < 1e-9),
  '整链: 默认合并丢掉 mode -> 顶/底弹幕被当成滚动弹幕 (dur = areaW/speedPx), 这是刻意的形状取舍')

// 整链跑一遍 (页面就是这么用的): 解析 -> 合并(keepMode) -> 过滤 -> 排泳道 -> 取帧
const whole = safe(() => {
  const list = parseDanmakuXml(XML)
  const m2 = mergeDanmaku(list, { keepMode: true })
  const kept2 = filterDanmaku(m2, { keywords: ['三体'], regexes: [], modes: [], minLength: 2 })
  const t2 = buildTracks(kept2, { areaW: 474, areaH: 266, fontSize: 22, speedPx: 60 })
  return { kept: kept2, t2, frame: visibleAt(t2.items, 0), late: visibleAt(t2.items, 4.3) }
}, '整链 (解析->合并->过滤->排泳道->取帧)')
eq(whole && whole.kept.length, 3, '整链: "咦三体居然还有动画" 被关键词丢掉, 剩 3 条')
eq(whole && whole.kept.map((x) => x.mode).sort(), [1, 4, 5], '整链: keepMode 下 mode 一路保留 (滚动 1 / 底端 4 / 顶端 5)')
eq(whole && whole.t2.items.length, 3, '整链: 泳道装得下全部')
eq(whole && whole.frame.length, 0, '整链: 0 秒处没有 3.5s 之后的弹幕')
// 4.3s: 3.5s 的顶端弹幕还在 (3.5+4=7.5), 4.25s 的底端弹幕刚开始 (4.25+4=8.25)
eq(whole && whole.late.map((x) => x.text).sort(), ['底端蓝字', '顶端红字'], '整链: 4.3 秒处顶/底弹幕各一条')
eq(whole && whole.late.every((x) => x.dur === 4), true, '整链: 顶/底弹幕 dur 都是 4s (定点停留)')
eq(whole && whole.late.every((x) => x.mode === 4 || x.mode === 5), true, '整链: 顶/底弹幕 mode 一路带到页面 (页面据此定 x 位置)')

// ================= 报告 =================
for (const m of fails) console.log('BAD  ' + m)
if (fails.length === 0) {
  console.log('PASS check-danmaku: ' + pass + ' 条断言全过')
  console.log('PASS 覆盖: XML 解析/转义单次/坏行跳过 · 十进制 RGB -> #rrggbb · Pakku 合并(窗口+阈值+放大上限 2.2)')
  console.log('PASS      顶底弹幕不合并 · 屏蔽(关键词/正则/非法正则忽略/模式/最短长度按码点) · 宽度估算')
  console.log('PASS      泳道不相交(500 条随机性质测试) · visibleAt 左闭右开 · 空/畸形输入不抛')
  console.log('PASS 退出码 0')
} else {
  console.log('FAIL check-danmaku: ' + fails.length + ' 条失败 / 共 ' + (pass + fails.length) + ' 条断言')
}
process.exit(fails.length === 0 ? 0 : 1)
