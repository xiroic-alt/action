// 从 src/assets/emoji/png-index.json 生成 components/emoji-img.vue
//
// 为什么要生成 .vue 而不是 .js:
//   设备侧 `require('...png')` 只能写在 .vue 的 script 里 (.js 里会 ReferenceError),
//   这是打包器的资源处理约定. 所以 emoji 图片表必须落在一个 .vue 文件里.
//
// 用法: node tools/gen-emoji-map.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IDX = path.join(ROOT, 'src/assets/emoji/png-index.json')
const OUT = path.join(ROOT, 'src/components/emoji-img.vue')

if (!fs.existsSync(IDX)) {
  console.error('缺少 ' + IDX + ', 先跑 python tools/gen-emoji.py --pngs')
  process.exit(1)
}
const idx = JSON.parse(fs.readFileSync(IDX, 'utf8'))
const keys = Object.keys(idx).sort()

const lines = []
lines.push('<template>')
lines.push('  <!-- emoji 图片 (由 tools/gen-emoji-map.mjs 生成, 不要手改) -->')
lines.push('  <image v-if="src" class="emj" :src="src" :style="{ width: px, height: px }"></image>')
lines.push('  <text v-else class="emj-miss" :style="{ fontSize: size + \'px\' }">{{ fallback }}</text>')
lines.push('</template>')
lines.push('')
lines.push('<script>')
lines.push('// 由 tools/gen-emoji-map.mjs 从 png-index.json 生成 —— ' + keys.length + ' 个 emoji')
lines.push('// require 必须写在本文件里 (.vue 才支持资源 require)')
lines.push('const MAP = {')
for (let i = 0; i < keys.length; i++) {
  const k = keys[i]
  lines.push('  ' + JSON.stringify(k) + ': require(\'../assets/emoji/png/' + idx[k] + '\'),')
}
lines.push('}')
lines.push('')
lines.push('export default {')
lines.push('  name: \'emoji-img\',')
lines.push('  props: {')
lines.push('    name: { type: String, default: \'\' },   // 码位键, 如 1F600 / 1F468-200D-1F469')
lines.push('    size: { type: Number, default: 16 },  // 显示边长 (px)')
lines.push('    fallback: { type: String, default: \'\' }')
lines.push('  },')
lines.push('  computed: {')
lines.push('    src() {')
lines.push('      const k = this.name')
lines.push('      if (!k) return \'\'')
lines.push('      if (MAP[k]) return MAP[k]')
lines.push('      // 退化: 带肤色/ZWJ 的组合没有素材时, 用第一个码位的基础 emoji')
lines.push('      const base = k.split(\'-\')[0]')
lines.push('      return MAP[base] || \'\'')
lines.push('    },')
lines.push('    px() { return this.size + \'px\' }')
lines.push('  }')
lines.push('}')
lines.push('</script>')
lines.push('')
lines.push('<style scoped>')
lines.push('.emj { }')
lines.push('.emj-miss { }')
lines.push('</style>')
lines.push('')

fs.writeFileSync(OUT, lines.join('\n'))
const size = fs.statSync(OUT).size
console.log('生成 emoji-img.vue: ' + keys.length + ' 个 emoji, ' + (size / 1024).toFixed(0) + ' KB')
