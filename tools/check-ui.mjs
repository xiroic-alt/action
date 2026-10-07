// 离线回归: 主题 / 配置 / 播放线路 三个服务模块 (按设备侧 QuickJS 的模块形态真实链接 + 运行)
//
// 走 Node 原生 ESM 加载 (tools/esm-hooks.mjs 把 'bilinet' / 'pm' 映射到桩件), 不用手写
// vm.SourceTextModule 的 link/evaluate 记账 —— 那样模块身份(缓存)会和真实加载器不一致,
// 同一份 config.js 被两份实例加载, 内存缓存测试就会假失败.
//
// 用法: node tools/check-ui.mjs     (退出码非 0 = 有断言失败, CI 可直接拦)

import { register } from 'node:module'

// ---- 设备文件系统桩 (config.js / log.js 走 bilinet.readFile/writeFile) ----
const disk = new Map()
const execCalls = []
// ---- sqlite 桩: 用 Node 自带的真 SQLite, 不手写 SQL 解析 ----
// 教训: 第一版桩件是 `dbExec: () => true`, 于是 services/store.js 的 initStore 从没被跑过、
// kvReady() 恒为 false —— "配置进数据库"这条路径在本地是**零覆盖**的 (真机上 kv 表建出来了
// 却一行数据没有, 就是这么漏过去的). 第二版自己写了个 SQL 解析器, 又因为分隔符匹配
// 写错而永远 return false, 结论依然是错的. 直接用 node:sqlite 的真引擎 —— 行为不会撒谎.
let DatabaseSync
try {
  ({ DatabaseSync } = await import('node:sqlite'))
} catch (e) {
  console.error('这个静态门禁需要 Node 22.5+ (node:sqlite 内置模块), 当前是 ' + process.version)
  console.error('CI 里请把 actions/setup-node 的 node-version 提到 22 以上.')
  process.exit(2)
}
const sqlite = new DatabaseSync(':memory:')
function dbExec(sql) {
  const s = String(sql)
  try {
    if (/^\s*(create|drop|alter)\b/i.test(s)) { sqlite.exec(s); return true }
    sqlite.prepare(s).run()
    return true
  } catch (e) { return false }
}
function dbQuery(sql) {
  try { return JSON.stringify(sqlite.prepare(String(sql)).all()) } catch (e) { return '[]' }
}
// 断言里直接查库 (替代手写的 dbKv)
function kvRows() { try { return sqlite.prepare('select k, v from kv').all() } catch (e) { return [] } }
function kvOf(k) {
  // 表还没建出来时 prepare 会抛 —— 这是合法状态 (数据库没打开), 当成"没有"就行
  try {
    const r = sqlite.prepare('select v from kv where k = ?').all(k)
    return r && r.length ? String(r[0].v) : null
  } catch (e) { return null }
}
function kvHas(k) { return kvOf(k) !== null }
function kvPut(k, v) {
  try { sqlite.prepare('insert or replace into kv (k, v, updated_at) values (?, ?, ?)').run(k, v, 1) } catch (e) {}
}
function kvDrop(k) { try { sqlite.prepare('delete from kv where k = ?').run(k) } catch (e) {} }
function tableExists(n) {
  const r = sqlite.prepare("select name from sqlite_master where type='table' and name=?").all(n)
  return r && r.length > 0
}

globalThis.__bilinet = {
  readFile: (p) => (disk.has(p) ? disk.get(p) : ''),
  writeFile: (p, d) => { disk.set(p, String(d)); return true },
  deleteFile: (p) => { const had = disk.has(p); disk.delete(p); return had },
  mkdirs: () => true,
  fileExists: (p) => disk.has(p),
  httpGet: () => '',
  httpPost: () => '',
  httpGetAsync: () => Promise.resolve(''),
  httpPostAsync: () => Promise.resolve(''),
  exec: () => '',
  dbOpen: (p) => true,
  dbExec: dbExec,
  dbQuery: dbQuery,
  dbClose: () => true,
  execAsync: (cmd) => {
    execCalls.push(cmd)
    // 被测 URL 现在写在 curl 配置文件里 (命令行放不下, 见 lines.js 的 512 字符说明),
    // 所以桩件要从磁盘读回来判断该返回哪一档结果.
    const rc = disk.get('/userdisk/xiro/.curlrc') || ''
    if (rc.indexOf('BADSITE') >= 0) return Promise.resolve('code=403 ttfb=0.10 speed=0 size=150 total=0.5')
    if (rc.indexOf('SLOWSITE') >= 0) return Promise.resolve('code=206 ttfb=1.20 speed=262144 size=524288 total=2.1')
    if (rc.indexOf('url = ') < 0) return Promise.resolve('code=0 ttfb=0 speed=0 size=0 total=0')
    return Promise.resolve('code=206 ttfb=0.21 speed=1048576 size=524288 total=0.71')
  }
}

// 设备侧全局对象: 页面/服务的顶层就会碰到它们 (base-page.js 注册 BasePage 类),
// 这里给最小桩件, 让模块能真实求值
globalThis.$falcon = {
  // base-page.js 顶层就 extends $falcon.Page, 所以这里必须是真类而不是函数
  Page: class Page { constructor() {} },
  App: class App { constructor() {} },
  navTo() {}, navBack() {}, finish() {},
  on() { return 0 }, off() {}, trigger() {}, eventMap: {},
  useDefaultBasePageClass() {},
  env: { custom: { $set() {}, $get() { return {} } } }
}
globalThis.$page = { onNewOptions: null, options: {}, finish() {}, setTimeout, clearTimeout, setInterval, clearInterval }

register('./esm-hooks.mjs', import.meta.url)

// 静音被测模块的 console (services/log.js 无条件打 console.log); 断言输出走 ok/eq
const realLog = console.log
console.log = () => {}

const SRC = new URL('../ui/src/', import.meta.url).href

let fails = 0
let pass = 0
const failMsgs = []
function ok(cond, msg) { if (cond) { pass++; return } fails++; failMsgs.push(msg) }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')') }

// ================= 1. M3 配色表 =================
const scheme = await import(SRC + 'services/m3-scheme.js')
const ROLES = scheme.M3_ROLES
const SEEDS = scheme.M3_SEEDS
const SCHEMES = scheme.M3_SCHEMES

eq(SEEDS.length, 8, '种子色数量')
eq(ROLES.length, 32, '语义角色数量')
const keys = Object.keys(SCHEMES)
eq(keys.length, 32, '配色套数 (8 种子 x 2 明暗 x 2 对比度)')
ok(ROLES.indexOf('primaryContainer') > 0 && ROLES.indexOf('surfaceContainerHighest') > 0, 'M3 容器角色齐备')

function lum(hex) {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
function ratio(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }

const PAIRS = [['onSurface', 'surface', 4.5], ['onSurfaceVariant', 'surface', 4.5], ['onPrimary', 'primary', 4.5], ['onPrimaryContainer', 'primaryContainer', 4.5], ['onErrorContainer', 'errorContainer', 4.5], ['onSurface', 'surfaceContainerHigh', 4.5], ['primary', 'surface', 3.0]]
let contrastBad = 0
let hexBad = 0
for (const k of keys) {
  const vals = SCHEMES[k].split(',')
  if (vals.length !== 32) { hexBad++; continue }
  const o = {}
  ROLES.forEach((r, i) => { o[r] = vals[i] })
  for (const r of ROLES) if (!/^#[0-9a-f]{6}$/.test(o[r])) hexBad++
  for (const [fg, bg, min] of PAIRS) if (ratio(o[fg], o[bg]) + 1e-9 < min) contrastBad++
}
eq(hexBad, 0, '所有角色均为 6 位 hex')
eq(contrastBad, 0, 'M3 可访问性对比度 (onX/X >= 4.5:1)')

const surf = (k) => SCHEMES[k].split(',')[ROLES.indexOf('surface')]
ok(surf('rose|dark|0') !== surf('rose|light|0'), '深色/浅色 surface 必须不同')
ok(surf('rose|dark|0') !== surf('blue|dark|0'), '不同种子色 surface 必须不同 (色相染色)')

// ================= 2. 配置持久化 =================
// ★ 先复现真机的时序 bug, 再走正常路径.
//   真机现象: kv 表建出来了却一行数据都没有, cfg.json 一直留着.
//   根因: app.js 原来先 setLogLevel(getCfg("logLevel")) 再 initAuth() (initAuth 里面才
//   initStore 开库) —— 配置在数据库就绪**之前**被读走并缓存成"文件版本",
//   之后缓存一直命中, 迁移逻辑再也跑不到.
//   这里故意让 config.js 先于 initStore 被 import, 把那时的状态复刻出来.
const cfg = await import(SRC + 'services/config.js')
const store = await import(SRC + 'services/store.js')
ok(!store.kvReady(), '数据库尚未打开时 kvReady() 为 false (时序前提成立)')
disk.set(cfg.CFG_PATH, JSON.stringify({ _v: 2, themeSeed: 'red', btaudioMs: 111 }))
cfg.__reloadForTest()
eq(cfg.getCfg('themeSeed'), 'red', '数据库未就绪: 先走文件兜底读到配置')
ok(!kvHas('settings'), '数据库未就绪: 库里还没有 settings 行')
store.initStore()
ok(store.kvReady(), 'store.initStore() 之后 kvReady() 必须为 true')
ok(tableExists('kv'), 'initStore 建出了 kv 表')
eq(cfg.getCfg('themeSeed'), 'red', '数据库就绪后: 值不变 (不能把用户设置读丢)')
ok(kvHas('settings'), '数据库就绪后**自动补做迁移**: 旧文件进库')
ok(!disk.has(cfg.CFG_PATH), '补迁移后旧文件被删除 (不留两份真源)')

cfg.resetConfig()
cfg.__reloadForTest()
const all = cfg.loadConfig()
eq(all.themeSeed, 'rose', '默认主题色')
eq(all.themeMode, 'dark', '默认明暗')
eq(all.navPos, 'left', '默认导航位置 = 左侧竖排')
eq(all.btaudioMs, 200, '默认蓝牙补偿')
eq(cfg.CFG_PATH, '/userdisk/xiro/bilibilipan.cfg.json', '配置路径: 与日志同在 /userdisk/xiro')

cfg.setCfg('btaudioMs', 99999)
eq(cfg.getCfg('btaudioMs'), 800, '超界整数被夹紧')
cfg.setCfg('themeSeed', 'not-a-seed')
eq(cfg.getCfg('themeSeed'), 'rose', '非法枚举回落到默认值')
cfg.setCfg('themeSeed', 'blue')
eq(cfg.getCfg('themeSeed'), 'blue', '合法枚举写入成功')
cfg.setCfg('motion', 0)
eq(cfg.getCfg('motion'), false, 'bool 归一化')

// ★ 配置必须进数据库 (用户要求: 和登录信息一起存, 不要单独文件)
const kvRaw = kvOf('settings')
ok(typeof kvRaw === 'string' && kvRaw.length > 20, '配置已写进 bilibili.db 的 kv 表')
ok(kvRaw && (kvRaw.indexOf('"_v":2') >= 0 || kvRaw.indexOf('"_v": 2') >= 0), 'kv 里的配置带 schema 版本')
ok(!disk.has(cfg.CFG_PATH), '数据库可用时不再落 cfg.json 文件')

// 手改/损坏数据: 已知键夹紧, 未知键保留 (改的是数据库里那一行)
// 反向验证一下桩件本身是活的: 写进去读得回来, 否则后面的断言全是假绿
kvPut('__probe__', 'hello')
ok(kvOf('__probe__') === 'hello', 'sqlite 桩件可写可读 (断言的前提)')
ok(tableExists('kv'), 'sqlite 桩件真的建了表')
kvPut('settings', JSON.stringify({ _v: 1, btaudioMs: 123456, themeSeed: 'violet', futureKey: 'keep-me' }))
cfg.__reloadForTest()
eq(cfg.getCfg('btaudioMs'), 800, '手改超界值被夹紧')
eq(cfg.getCfg('themeSeed'), 'violet', '手改合法值被采纳')
eq(cfg.getCfg('futureKey'), 'keep-me', '未知键保留 (回滚不丢数据)')
kvPut('settings', '{ this is not json')
cfg.__reloadForTest()
eq(cfg.getCfg('themeSeed'), 'rose', '损坏 JSON 回落到默认值, 不抛错')

// 老版本升级路径: 库里没有 settings, 但设备上留着一份旧的 cfg.json -> 必须迁移进库并删文件
kvDrop('settings')
disk.set(cfg.CFG_PATH, JSON.stringify({ _v: 2, themeSeed: 'green', btaudioMs: 321 }))
cfg.__reloadForTest()
eq(cfg.getCfg('themeSeed'), 'green', '旧 cfg.json 被迁移进数据库')
ok(kvHas('settings'), '迁移后数据库里有了 settings 行')
ok(!disk.has(cfg.CFG_PATH), '迁移后旧 cfg.json 被删除 (不留两份真源)')

cfg.resetConfig()
eq(cfg.getCfg('navPos'), 'left', '恢复默认')

// ================= 3. 主题 =================
const theme = await import(SRC + 'services/theme.js')
const t = theme.tokens()
for (const k of ['page', 'bar', 'card', 'cardHi', 'inset', 'txt', 'txt2', 'txt3', 'line', 'accent', 'accentBg', 'accentTxt', 'accentChip', 'err', 'inverse', 'snack', 'rad', 'shapeCard', 'den', 'fs', 'navPos', 'navW', 'dark', 'motion']) {
  ok(t[k] !== undefined, 'tokens() 缺少 ' + k)
}
eq(t.page.backgroundColor, t.c.surface, 'page 用 surface')
eq(t.txt.color, t.c.onSurface, 'txt 用 onSurface')
eq(t.txt2.color, t.c.onSurfaceVariant, 'txt2 用 onSurfaceVariant')
eq(t.rad.btn, '999px', '标准圆角: 按钮全圆角 (M3)')
ok(t.coverR.width !== undefined && t.coverR.borderTopLeftRadius === '12px', '封面组合样式带圆角')
eq(t.t.title.color, t.c.onSurface, 't.title 用 onSurface')
eq(t.t.title.fontSize, '22px', 't.title 字号来自字级表')
eq(t.t.weak.color, t.c.outline, 't.weak 用 outline (第三级文字)')
eq(t.t.accent.color, t.c.primary, 't.accent 用 primary')
eq(t.t.onAccent.color, t.c.onPrimary, 't.onAccent 用 onPrimary (反白)')
ok(t.t.err.color === t.c.error, 't.err 用 error 角色')
eq(theme.seedHex('rose'), '#FB7299', '种子色查表')

cfg.setCfg('pureBlack', true); cfg.setCfg('themeMode', 'dark')
eq(theme.tokens().c.surface, '#000000', 'AMOLED 纯黑: surface = #000')
ok(theme.tokens().c.surfaceContainerLow !== '#000000', '纯黑只压 surface, 容器保留层次')
cfg.setCfg('pureBlack', false); cfg.setCfg('themeMode', 'light')
eq(theme.tokens().dark, false, 'tokens().dark 反映当前明暗')
ok(theme.tokens().c.surface !== '#000000', '浅色模式 surface 合理')
cfg.setCfg('themeMode', 'dark')

cfg.setCfg('radiusStyle', 'flat'); eq(theme.tokens().rad.btn, '6px', '方正: 按钮 6px (把按钮从胶囊压成直角)')
cfg.setCfg('radiusStyle', 'std'); eq(theme.tokens().rad.card, '12px', '标准: 卡片 12px')
cfg.setCfg('radiusStyle', 'round'); eq(theme.tokens().rad.card, '32px', '圆润: 卡片 32px (与标准 12 一眼可辨)')
ok(theme.tokens().rad.btn === '999px', '圆润: 按钮仍是 M3 全圆角')
cfg.setCfg('density', 'compact'); eq(theme.tokens().den.itemH, 96, '紧凑行高 96')
cfg.setCfg('density', 'cozy'); eq(theme.tokens().den.itemH, 128, '宽松行高 128')
// B 站稿件封面原图是 1146x717 = 1.598 (16:10), 不是 16:9 —— 沿用 180/112 的比例,
// 三档密度都必须保持这个比例, 否则 resize="cover" 会把封面裁掉两边.
for (const d of ['compact', 'std', 'cozy']) {
  cfg.setCfg('density', d)
  const w = parseInt(theme.tokens().cover.width, 10)
  const h = parseInt(theme.tokens().cover.height, 10)
  ok(Math.abs(w / h - 1.6) < 0.02, d + ' 封面比例保持 16:10 (got ' + w + 'x' + h + ')')
}
cfg.setCfg('fontScale', 'lg'); eq(parseInt(theme.tokens().fs.body, 10), 22, '大字: 正文 19 -> 22')
cfg.setCfg('fontScale', 'sm'); eq(parseInt(theme.tokens().fs.body, 10), 17, '小字: 正文 19 -> 17')
cfg.setCfg('density', 'std'); cfg.setCfg('fontScale', 'std'); cfg.setCfg('radiusStyle', 'std')
cfg.setCfg('navPos', 'top'); eq(theme.tokens().navW, 0, '顶部导航时左侧栏宽度 0')
eq(theme.tokens().navH, 44, '顶部导航高度 44')
eq(theme.tokens().mainH, 222, '顶部导航时内容高 222')
cfg.setCfg('navPos', 'left')
eq(theme.tokens().navW, 88, '左侧导轨宽 88 (M3 NavigationRail)')
eq(theme.tokens().mainW, 872, '左侧导轨时内容宽 872')
eq(theme.tokens().mainH, 266, '左侧导轨时内容吃满 266 (= 省下 44px 顶栏)')
cfg.setCfg('density', 'compact'); eq(parseInt(theme.tokens().cover.height, 10), 96, '紧凑封面高 96')
cfg.setCfg('density', 'std')

// ================= 4. 播放线路 =================
const lines = await import(SRC + 'services/lines.js')
eq(lines.CDN_NODES.length, 21, '内置 CDN 节点数')
eq(lines.SOURCES.length, 4, '取流口数量')
ok(lines.CDN_NODES.filter((n) => n[2]).every((n) => lines.isValidHost(n[2])), '内置节点 host 全在白名单内')
ok(lines.CDN_NODES.filter((n) => n[2]).every((n) => /^(upos|proxy|cn-hk)/.test(n[2])), '内置节点命名与 B 站一致')

const signed = 'https://upos-sz-mirrorcoso1.bilivideo.com/upgcxcode/99/88/196018899/196018899_nb3-1-16.mp4?e=AAA&og=hw&nbs=1&deadline=1791311403'
const swapped = lines.applyHost(signed, 'upos-sz-mirrorali.bilivideo.com')
eq(swapped, signed.replace('upos-sz-mirrorcoso1.bilivideo.com', 'upos-sz-mirrorali.bilivideo.com'), 'host 替换: 只换 host, 其余逐字节相同')
eq(swapped.slice(swapped.indexOf('?')), signed.slice(signed.indexOf('?')), 'host 替换不动 query (签名按 query 算)')
eq(lines.applyHost(signed, 'evil.example.com'), signed, '非白名单 host 被拒绝')
eq(lines.applyHost(signed, ''), signed, '空 host 原样返回')
ok(lines.applyHost(signed, 'proxy-tf-all-ws.bilivideo.com').indexOf('/?url=https%3A%2F%2F') > 0, 'B站代理形态走 ?url=')
ok(lines.isValidHost('upos-sz-mirror08c.bilivideo.com'), '白名单后缀通过')
ok(!lines.isValidHost('bilivideo.com.evil.com'), '伪装后缀被拒')
ok(!lines.isValidHost('a b.com'), '带空格被拒')

const r1 = await lines.probe(signed, { bytes: 524288, timeoutSec: 8 })
eq(r1.ok, true, '测速: 206 判定为可用')
ok(Math.abs(r1.mbps - 1) < 0.001, '测速: MB/s 换算')
eq(r1.ttfbMs, 210, '测速: 首字节 ms 换算')
ok(execCalls.length >= 1 && execCalls[0].indexOf('-r 0-524287') > 0, 'curl 带 Range')
ok(execCalls[0].indexOf('-o /dev/null') > 0, 'curl 丢弃响应体')
// native exec/execAsync 有 512 字符硬上限, 超了直接 postError invalid cmd —— 真机踩过.
ok(execCalls[0].length <= 512, 'curl 命令行不超过 native 的 512 字符上限 (实际 ' + execCalls[0].length + ')')
ok(execCalls[0].indexOf('-K ' + lines.RC_PATH) > 0, '长参数走 -K 配置文件而不是命令行')
// 配置文件里必须带齐 url / UA / Referer / -w 格式 (换 host 测速的全部输入)
const rc = disk.get(lines.RC_PATH) || ''
ok(rc.indexOf('url = "https://upos-sz-mirrorcoso1.bilivideo.com') === 0, '配置文件首行是被测 URL')
ok(rc.indexOf('user-agent =') > 0 && rc.indexOf('Mozilla/5.0') > 0, '配置文件带浏览器 UA (CDN 的唯一门槛)')
ok(rc.indexOf('referer =') > 0, '配置文件带 Referer')
ok(execCalls[0].indexOf('speed_download') > 0, '-w 度量格式在命令行 (避开 curl 配置文件的 %VAR 展开)')
const r2 = await lines.probe('https://upos-sz-mirrorali.bilivideo.com/BADSITE', {})
eq(r2.ok, false, '测速: 403 判定为不可用')
ok(r2.err.indexOf('403') > 0, '403 有可读原因')
const r3 = await lines.probe('https://upos-sz-mirrorali.bilivideo.com/SLOWSITE', {})
eq(r3.ok, true, '测速: 慢节点也可用')
ok(r3.mbps < 0.3, '慢节点速率更低')
const bad = await lines.probe("https://x.com/a'b; rm -rf /", {})
eq(bad.ok, false, 'URL 注入被拒绝 (不抛异常)')
eq(lines.fmtProbe({ ok: true, mbps: 12.34, ttfbMs: 88 }), '12 MB/s · 88ms', '结果文案')
eq(lines.fmtProbe(null), '未测', '空结果文案')

// 当前线路解析
cfg.setCfg('cdnNode', 'ali'); cfg.setCfg('customHost', '')
eq(lines.currentHost(), 'upos-sz-mirrorali.bilivideo.com', '当前 host = 选中节点')
cfg.setCfg('customHost', 'upos-sz-mirror08h.bilivideo.com')
eq(lines.currentHost(), 'upos-sz-mirror08h.bilivideo.com', '自定义 host 优先于内置节点')
cfg.setCfg('customHost', 'evil.com')
eq(lines.currentHost(), 'upos-sz-mirrorali.bilivideo.com', '非法自定义 host 被忽略')
cfg.setCfg('customHost', ''); cfg.setCfg('cdnNode', 'default')
eq(lines.currentHost(), '', '默认节点不替换 host')

// ================= 5. 页面脚本真实链接 =================
// 每个页面的 <script> 都当真实 ES 模块加载一遍: 命名导出写错 / 模块名写错 /
// 语法错误 会在这一步炸出来, 不用等装机黑屏 (HANDOVER §25.7).
const fs = await import('node:fs')
const path = await import('node:path')
const { fileURLToPath } = await import('node:url')
const PAGES = fileURLToPath(SRC + 'pages')
const appJson = JSON.parse(fs.readFileSync(fileURLToPath(SRC + 'app.json'), 'utf8'))
const pageNames = Object.keys(appJson.pages)
eq(pageNames.length, 27, 'app.json 注册页面数 (25 - vprobe + lines/live/msg)')
let linked = 0
for (const name of pageNames) {
  const rel = appJson.pages[name]
  const url = SRC + rel
  try {
    const mod = await import(url)
    const d = mod.default
    if (!d || typeof d !== 'object') { ok(false, name + ' 没有 default 导出对象'); continue }
    if (d.name !== name) { ok(false, name + ' 的组件 name 是 ' + JSON.stringify(d.name) + ', 与 app.json 的键不一致'); continue }
    // 生命周期必须挂在 methods 里 (0.9.61 事故: 写成组件根级选项 -> 永不触发)
    if (d.methods) {
      for (const life of ['onShow', 'onUnload', 'onNewOptions', 'onHide']) {
        if (d[life] && !d.methods[life]) ok(false, name + ' 的 ' + life + ' 在 methods 之外 (不会被调用)')
      }
      if (!d.methods.onShow && !d.methods.onUnload) ok(false, name + ' 既没有 onShow 也没有 onUnload (无法重取主题/无法释放资源)')
    }
    linked++
  } catch (e) {
    ok(false, name + ' (' + rel + ') 加载失败: ' + (e && e.message ? e.message : e))
  }
}
eq(linked, pageNames.length, '全部页面脚本可真实链接')

// 主题接入面: 重设计过的页面必须真的用了语义 token, 不能只是"看着像换了皮"
for (const [name, marker] of [['index', 'T.t.'], ['settings', 'T.t.']]) {
  const src = fs.readFileSync(path.join(PAGES, name, name + '.vue'), 'utf8')
  const uses = (src.match(/T\./g) || []).length
  ok(uses >= 10, name + '.vue 语义 token 绑定数应 >= 10, 实际 ' + uses)
  ok(src.indexOf(marker) >= 0, name + '.vue 应使用 T.t.* 文字组合样式')
}

console.log = realLog
for (const m of failMsgs) realLog('BAD  ' + m)
console.log('')
console.log(fails === 0 ? ('CHECK-UI PASSED (' + pass + ' 断言, ' + keys.length + ' 套配色, ' + linked + ' 个页面)') : (fails + ' 个断言失败 / 共 ' + (pass + fails)))
process.exit(fails === 0 ? 0 : 1)
