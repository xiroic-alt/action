import assert from 'node:assert/strict'
import { register } from 'node:module'
import fs from 'node:fs'
globalThis.__bilinet = { readFile: () => '', mkdirs: () => true, writeFile: () => true }
globalThis.$falcon = { Page: class {}, eventMap: {} }
register('./esm-hooks.mjs', import.meta.url)
const { prepareFeedCards } = await import('../ui/src/services/feed-layout.js')
const { scrollTopMixin } = await import('../ui/src/services/scroll-top.js')
const original = { id: '1', pics: Array.from({length:9}, (_,i)=>({w:200,h:200,full:'https://i0.hdslb.com/'+i,src:'thumb'})), orig: { pics: [{w:400,h:240,full:'original',src:'thumb'}] }, stat: { liked: false } }
const cards = prepareFeedCards([original], 872, 4)
assert.equal(cards[0].rows.length, 3)
assert.ok(cards[0].rows[0].reduce((n,p)=>n+p.w+6,0) <= 808)
assert.equal(original.rows, undefined)
assert.equal(cards[0].orig.rows.length, 1)
cards[0].stat.liked = true
assert.equal(original.stat.liked, false)
const state = scrollTopMixin.data()
const calls = []
const vm = {...state, $refs:{topA:{}}, $page:{$dom:{scrollToElement:(...args)=>calls.push(args)}}}
Object.assign(vm, scrollTopMixin.methods)
vm.trackTop({contentOffset:{y:210}}, 'topA')
assert.equal(vm.topShown, true)
vm.goTop()
assert.equal(calls.length, 1)
assert.equal(vm.topShown, false)
vm.trackTop({contentOffset:{y:-25}}, 'topA')
assert.equal(vm.topShown, false)
const src = fs.readFileSync(new URL('../ui/src/pages/index/index.vue',import.meta.url),'utf8')
assert.match(src, /<DynamicFeed/)
assert.doesNotMatch(src, /v-for="(item, i) in dynItems"/)
// ---- 照片查看器整屏: 宿主把窗格放大, 因为渲染器不吃负偏移 ----
// 真机实测 (2026-10-11 14:46): 往 .iview 写 left:-88px 无效, 查看器只铺满窗格,
// 左导轨露着且返回按钮被裁 -> 改成"打开时藏导航 + 窗格 960x266".
const feedSrc = fs.readFileSync(new URL('../ui/src/pages/feed/feed.vue', import.meta.url), 'utf8')
assert.match(feedSrc, /this\.\$emit\('viewer', true\)/, 'feed: 打开查看器要通知宿主')
assert.match(feedSrc, /this\.\$emit\('viewer', false\)/, 'feed: 关闭查看器要通知宿主')
assert.match(feedSrc, /onUnload\(\) \{[^}]*\$emit\('viewer', false\)/, 'feed: 卸载时也要复位 (切 tab 不会留全屏态)')
assert.match(src, /@viewer="onFeedViewer"/, 'index: 接住查看器开关')
assert.match(src, /:pane-width="feedViewer \? 960 :/, 'index: 查看器打开时窗格放大到 960')
assert.match(src, /:pane-height="feedViewer \? 266 :/, 'index: 查看器打开时窗格放大到 266')
assert.match(src, /<div v-if="!feedViewer" class="nav"/, 'index: 查看器打开时隐藏导航栏')
assert.match(src, /feedViewer: false/, 'index: feedViewer 声明在 data 里')
console.log('PASS feed layout, cache isolation, scroll target, complete feed integration, fullscreen viewer')
