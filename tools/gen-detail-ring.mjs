#!/usr/bin/env node
/**
 * 生成详情页副本环 (page2..pageN).
 *
 * 用户反馈: "详情页不要硬编码那么多页面, 想办法可以切换页面".
 * 背景见 ui/src/services/detail-ring.js 顶部的注释 —— 换页面名是固件限制下唯一可行的
 * 入栈手段, 所以名字必须预先注册; 但**文件**没必要手写 11 份.
 *
 * 这个脚本做的事 (幂等):
 *   1) 按 services/detail-ring.js 的 RING 生成 ui/src/pages/<name>/<name>.vue
 *      (page 本身是真实实现, 跳过)
 *   2) 同步 app.json 的 pages 表: 补上环里的每一个名字
 *   3) --check 模式只比对不写入, 供 validate.mjs 当门禁用
 *
 * 副本内容里没有任何"下一站"字面量: 一律调 nextOf('<自己的名字>'),
 * 环的顺序改动只会影响 detail-ring.js 一个文件.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const UI = path.join(ROOT, 'ui')
const PAGES = path.join(UI, 'src', 'pages')
const APPJSON = path.join(UI, 'src', 'app.json')
const CHECK = process.argv.indexOf('--check') >= 0

const ringSrc = fs.readFileSync(path.join(UI, 'src', 'services', 'detail-ring.js'), 'utf8')
const m = /RING = \[([\s\S]*?)\]/.exec(ringSrc)
if (!m) { console.error('detail-ring.js 里找不到 RING 数组'); process.exit(2) }
const RING = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)

function wrapper(name) {
  return [
    '<!-- 详情页副本 ' + name + ' (生成产物, 不要手改)',
    '     由 tools/gen-detail-ring.mjs 按 services/detail-ring.js 的 RING 生成.',
    '     固件对同名页 navTo 只替换不入栈, 所以"详情套详情"必须换页面名 —— 见 detail-ring.js 说明. -->',
    '<template>',
    "  <DetailPage ref=\"d\" :next-page=\"nextOf('" + name + "')\" />",
    '</template>',
    '',
    '<script>',
    "import DetailPage from '../page/page.vue'",
    "import { nextOf } from '../../services/detail-ring.js'",
    '',
    'export default {',
    "  name: '" + name + "',",
    '  components: { DetailPage: DetailPage },',
    '  methods: {',
    '    nextOf: nextOf,',
    '    // BasePage 只向页面根组件转发 onShow/onHide/onUnload, 这里继续转给详情组件',
    '    forward: function (hook) {',
    '      var d = this.$refs && this.$refs.d',
    "      if (d && typeof d[hook] === 'function') {",
    "        try { d[hook]() } catch (e) { console.log('[" + name + "] forward ' + hook + ' error: ' + (e && e.message ? e.message : e)) }",
    '      }',
    '    },',
    "    onShow: function () { this.forward('onShow') },",
    "    onHide: function () { this.forward('onHide') },",
    "    onUnload: function () { this.forward('onUnload') }",
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
}

let wrote = 0, drift = []
for (const name of RING) {
  if (name === 'page') continue           // 真实实现, 不生成
  const dir = path.join(PAGES, name)
  const file = path.join(dir, name + '.vue')
  const want = wrapper(name)
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (have === want) continue
  if (CHECK) { drift.push(name); continue }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, want, 'utf8')
  wrote++
  console.log('GEN  ' + name)
}

// app.json 的 pages 表
const app = JSON.parse(fs.readFileSync(APPJSON, 'utf8'))
let appChanged = false
const ordered = {}
for (const name of RING) {
  const key = name
  if (app.pages[key] === undefined) {
    ordered[key] = 'pages/' + name + '/' + name + '.vue'
    appChanged = true
  }
}
if (appChanged && !CHECK) {
  // 追加在末尾, 保持原有键的顺序不变
  for (const k in ordered) app.pages[k] = ordered[k]
  fs.writeFileSync(APPJSON, JSON.stringify(app, null, 2) + '\n', 'utf8')
}

if (CHECK) {
  if (drift.length) {
    console.error('详情页副本与生成器输出不一致: ' + drift.join(', '))
    console.error('跑 node tools/gen-detail-ring.mjs 重新生成')
    process.exit(1)
  }
  console.log('DETAIL-RING OK (' + RING.length + ' 环位)')
} else {
  console.log('ring=' + RING.length + ' 生成 ' + wrote + ' 个副本' + (appChanged ? ' + app.json 已补登记' : ''))
  console.log('DETAIL-RING OK')
}
