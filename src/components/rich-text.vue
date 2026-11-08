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
      <!-- B 站表情 ([doge] 这类): 表里有就渲染真图, 没有才退回文字 -->
      <image v-else-if="s.t === 'biliimg'" :key="'bi' + i" class="rt-eb" :src="s.u" :style="{ width: size + 'px', height: size + 'px' }"></image>
      <!-- 强制换行: 根容器是 flex(row+wrap), 文本里的 \n 不会生效,
           必须插一个"整行宽 + 零高"的元素把后续内容挤到下一行. -->
      <div v-else-if="s.t === 'br'" :key="'b' + i" class="rt-br"></div>
      <text v-else :key="'t' + i" class="rt-t" :lines="lines" :style="textStyle">{{ s.v }}</text>
    </template>
  </div>
</template>

<script>
// 纯逻辑在 services/text.js (可在 Node 门禁里单测), 这里只负责渲染
import { segment } from '../services/text.js'
import EmojiImg from './emoji-img.vue'
import { emojiMap } from '../services/bili-emoji.js'

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
      const raw = segment(this.text, { biliEmoji: emojiMap() })
      const out = []
      for (let i = 0; i < raw.length; i++) {
        const s = raw[i]
        if (s.t === 'text') {
          // ★ 保留原文换行: 按 \n 切开, 段间插 br 段.
          //   之前整段直接丢给一个 <text>, 而 flex(row+wrap) 布局不认 \n,
          //   于是简介里原有的换行全部丢失 (用户反馈"简介没换行").
          const parts = String(s.v).split('\n')
          for (let k = 0; k < parts.length; k++) {
            if (k > 0) out.push({ t: 'br' })
            if (parts[k] !== '') out.push({ t: 'text', v: parts[k] })
          }
          continue
        }
        if (s.t === 'bili') {
          // ★ 表里有图就渲染真图; 没有 (首次还没加载完 / 该表情不在面板里) 才退化成 [名称] 文字.
          //   之前这里**无条件**退化成文字, 所以评论里的 [doge] 一直显示成 "[doge]" ——
          //   用户反馈的"表情无法加载"就是这个.
          if (s.url) { out.push({ t: 'biliimg', v: s.v, u: s.url }); continue }
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
.rt-br { width: 100%; height: 0px; }
.rt-eb { margin-left: 2px; margin-right: 2px; }
</style>
