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
console.log('PASS feed layout, cache isolation, scroll target, complete feed integration')
