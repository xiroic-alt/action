<template>
  <!-- 富文本: 把"文字 + emoji"拆成多个 text 运行段
       为什么必须拆: 框架的字体管理没有字形回退 (libfalcon 里没有
       matchFamilyStyleCharacter 之类的入口), 一个 <text> 只用一种字体族.
       中文用系统默认字体, emoji 必须单独用 Twemoji 字体族渲染, 否则就是豆腐块.
       比"每个 emoji 一张图"更好: 矢量/COLR 清晰、基线自动对齐、没有图片节点开销. -->
  <div class="rt" :style="rootStyle">
    <text v-for="(s, i) in segs" :key="i"
          :class="s.t === 'text' ? 'rt-t' : 'rt-e'"
          :lines="s.t === 'text' ? lines : 1"
          :style="s.t === 'text' ? textStyle : emojiStyle">{{ s.v }}</text>
  </div>
</template>

<script>
// 纯逻辑在 services/text.js (可在 Node 门禁里单测), 这里只负责渲染
import { segment } from '../services/text.js'

export default {
  name: 'rich-text',
  props: {
    text: { type: String, default: '' },
    // 字号 / 颜色由调用方给 (页面自己持有 ui token)
    size: { type: Number, default: 14 },
    color: { type: String, default: '#ffffff' },
    lines: { type: Number, default: 2 },
    // emoji 字体族名: 必须与 fonts.xml 里声明的 name 一致
    emojiFamily: { type: String, default: 'Twemoji' },
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
        // Unicode emoji: 走 Twemoji 字体; 调用方要求丢弃时直接跳过
        if (!this.dropEmoji) out.push({ t: 'emoji', v: s.v })
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
    emojiStyle() {
      return {
        fontSize: this.size + 'px',
        fontFamily: this.emojiFamily,
        color: this.color,
        lineHeight: Math.round(this.size * 1.45) + 'px'
      }
    }
  }
}
</script>

<style>
.rt { flex-direction: row; flex-wrap: wrap; }
.rt-t { }
.rt-e { }
</style>
