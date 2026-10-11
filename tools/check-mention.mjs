// @ 提及 (mention) 与"媒体浮层控件"的行为回归.
//
// 为什么需要它:
//   1) B 站协议要求"回复某人时正文以 @昵称 + 空格 开头", 否则对方收不到 @ 通知.
//      以前三个评论页面各写各的, 楼中楼发送时根本没带前缀 -> 用户报"@ 功能要适配".
//   2) 查看器是恒黑浮层, 控件必须用白图标; 曾经 feed 用了跟随主题的 MIc ->
//      浅色下图标是深色, 黑压黑, 用户报"照片查看器的返回按钮是黑色的".
//
// 用法: node tools/check-mention.mjs   (退出码非 0 = 有断言失败)
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SRC = new URL('../ui/src/', import.meta.url)
const read = (p) => fs.readFileSync(new URL(p, SRC), 'utf8')
const { applyMention, mentionPrefix, splitMentionSegs, stripMention } = await import(new URL('services/mention.js', SRC))

let pass = 0
const fails = []
function ok(cond, msg) { if (cond) { pass++; return } fails.push(msg) }

// ---------- 1. 发送侧: @ 前缀 ----------
ok(mentionPrefix('小明') === '@小明 ', 'mentionPrefix: @昵称 + 一个空格 (B 站语义)')
ok(mentionPrefix('  ') === '', 'mentionPrefix: 空昵称 -> 空串 (回复主楼不加前缀)')
assert.equal(applyMention('你好', '小明'), '@小明 你好', 'applyMention: 补前缀')
assert.equal(applyMention('@小明 你好', '小明'), '@小明 你好', 'applyMention: 已带前缀不重复')
assert.equal(applyMention('@小明', '小明'), '@小明', 'applyMention: 只有 @他 也不重复加')
assert.equal(applyMention('你好', ''), '你好', 'applyMention: 无目标 -> 原样')
assert.equal(applyMention('@小明你好', '小明'), '@小明 @小明你好', 'applyMention: @昵称后面紧跟字 (不是提及) 仍要补')
assert.equal(stripMention('@小明 你好', '小明'), '你好', 'stripMention: 去掉前缀')
pass += 6

// ---------- 2. 渲染侧: 正文里的 @昵称 切成提及段 ----------
const segs = splitMentionSegs([{ t: 0, v: '回复 @小明 你说的对' }])
assert.deepEqual(segs, [{ t: 0, v: '回复 ' }, { t: 3, v: '@小明' }, { t: 0, v: ' 你说的对' }],
  'splitMentionSegs: 文本段里的 @昵称 切成 t=3')
pass++

const withPunct = splitMentionSegs([{ t: 0, v: '@小明，你看' }])
assert.deepEqual(withPunct, [{ t: 3, v: '@小明' }, { t: 0, v: '，你看' }], 'splitMentionSegs: 末尾标点不算昵称')
pass++

const multi = splitMentionSegs([{ t: 0, v: '@A 和 @B 都在' }])
assert.deepEqual(multi.map((s) => s.v), ['@A', ' 和 ', '@B', ' 都在'], 'splitMentionSegs: 多个提及')
pass++

const keep = splitMentionSegs([{ t: 0, v: '没有提及' }])
assert.deepEqual(keep, [{ t: 0, v: '没有提及' }], 'splitMentionSegs: 没提及 -> 原样 (不产生空段)')
pass++

const mixed = splitMentionSegs([{ t: 0, v: '看@小明' }, { t: 1, v: 'emoji.png', w: 20, h: 20 }])
assert.deepEqual(mixed[1].v, '@小明', 'splitMentionSegs: 提及在段尾')
assert.equal(mixed[2].t, 1, 'splitMentionSegs: 图片段原样透传')
pass += 2

// ---------- 3. 三个评论页面都接了提及渲染 ----------
const pages = ['pages/page/page.vue', 'pages/dyn/dyn.vue', 'pages/subreply/subreply.vue']
for (const p of pages) {
  const src = read(p)
  ok(/seg\.t === 3/.test(src), p + ': 评论正文渲染 mention 段 (t=3)')
  ok(/\.mn \{/.test(src), p + ': 有 .mn 提及高亮样式')
}
// 评论 segs 只有一个生成点 -> 在 mapReply 里统一切, 三页自动受益
const biliSrc = read('services/bili.js')
ok(/segs: splitMentionSegs\(parseMessage\(content\.message/.test(biliSrc),
  'bili.js: 评论 segs 在 mapReply 里统一切提及 (三页共用一处)')
ok(/import \{ splitMentionSegs \} from '\.\/mention\.js'/.test(biliSrc), 'bili.js: 引入 mention 助手')
// 发送侧: 楼中楼是唯一"有回复目标"的输入口
const sub = read('pages/subreply/subreply.vue')
ok(/applyMention\(message, this\.target \? this\.target\.author : ''\)/.test(sub),
  'subreply: 发送时补 @昵称 前缀 (回复主楼不加)')
ok(/await addReply\(this\.aid, body, this\.root, parent, this\.ctype\)/.test(sub),
  'subreply: 发出去的是补过前缀的正文')
// 输入框提示保留"回复 @某人"
ok(/回复 @' \+ this\.target\.author/.test(sub), 'subreply: 输入框提示写明回复对象')

// ---------- 4. 媒体浮层控件必须用白图标 ----------
const viewers = ['pages/feed/feed.vue', 'pages/dyn/dyn.vue', 'pages/page/page.vue', 'pages/subreply/subreply.vue']
for (const p of viewers) {
  const src = read(p)
  ok(/class="iv-back-ic" :src="MI\.back"/.test(src), p + ': 查看器返回按钮用白图标 (恒黑浮层)')
  ok(/:src="MI\.minus"/.test(src) && /:src="MI\.plus"/.test(src), p + ': 查看器缩放按钮用白图标')
  // 只在**查看器块内**查: 顶栏的返回按钮本来就该跟随主题用 MIc, 不能整文件扫 (第一版就是这么红的)
  const ivStart = src.indexOf('class="iview"')
  const ivEnd = src.indexOf('</template>', ivStart)
  const iv = ivStart >= 0 ? src.slice(ivStart, ivEnd > 0 ? ivEnd : src.length) : ''
  ok(iv !== '' && !/:src="MIc\./.test(iv), p + ': 查看器块内不出现跟随主题的深色图标')
}

for (const m of fails) console.log('BAD  ' + m)
console.log('')
console.log(fails.length === 0
  ? ('CHECK-MENTION PASSED (' + pass + ' 断言: @ 前缀/@ 切段/三页渲染/浮层白图标)')
  : (fails.length + ' 个断言失败 / 共 ' + (pass + fails.length)))
process.exit(fails.length === 0 ? 0 : 1)
