<template>
  <!-- 富文本: 把 "文字 + emoji" 拆成 文字段 与 emoji 图片段.
       为什么 emoji 走图片而不是字体:
         框架的字体管理没有字形回退 (一个 <text> 只能用一种字体族), 想让 emoji 出字形
         就必须往**系统字体表**里塞字体; 而那个目录本身是系统挂载点, 已三次导致整机
         字体异常 (详见 services/system-font.js 的教训注释).
       现在的方案: 573 个 emoji 预先渲染成 36px PNG (共 340 KB) 随应用包分发,
         静态 require 映射在 components/emoji-img.vue 里, 完全不动系统字体.
       代价: 视角/肤色等 ZWJ 组合没有素材时会退化成第一个基础码位. -->
  <div class="rt" :style="rootStyle">
    <template v-for="(s, i) in segs">
      <EmojiImg v-if="s.t === 'emoji'" :key="'e' + i" :name="s.k" :size="size" :fallback="s.v"></EmojiImg>
      <text v-else :key="'t' + i" class="rt-t" :lines="lines" :style="textStyle">{{ s.v }}</text>
    </template>
  </div>
</template>

<script>
// 纯逻辑在 services/text.js (可在 Node 门禁里单测), 这里只负责渲染
import { segment } from '../services/text.js'
import EmojiImg from './emoji-img.vue'

export default {
  name: 'rich-text',
  components: { EmojiImg },
  props: {
    text: { type: String, default: '' },
    // 字号 / 颜色由调用方给 (页面自己持有 ui token)
    size: { type: Number, default: 14 },
    color: { type: String, default: '#ffffff' },
    lines: { type: Number, default: 2 },
    // 没装 emoji 字体时: true = 丢掉 emoji, false = 当普通文字显示
    dropEmoji: { type: Boolean, default: true },
    weight: { type: String, default: 'normal' }
  },
  computed: {
    segs() {
      const raw = segment(this.text)
      const out = []
      for (let i = 0; i < raw.length; i++) {
        const s = raw[i]
        if (s.t === 'text') { out.push({ t: 'text', v: s.v }); continue }
        if (s.t === 'bili') {
          // B 站表情代码: 没有联网图时退化成 "[名称]" 文字
          out.push({ t: 'text', v: '[' + s.v + ']' })
          continue
        }
        // Unicode emoji: 走本地图片; 调用方要求丢弃时直接跳过
        if (!this.dropEmoji) out.push({ t: 'emoji', v: s.v, k: s.key || '' })
      }
      return out
    },
    rootStyle() {
      return { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }
    },
    textStyle() {
      return {
        fontSize: this.size + 'px',
        color: this.color,
        fontWeight: this.weight,
        lineHeight: Math.round(this.size * 1.45) + 'px'
      }
    },
  }
}
</script>

<style>
.rt { flex-direction: row; flex-wrap: wrap; }
.rt-t { }
.rt-e { }
</style>
