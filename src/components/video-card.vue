<template>
  <!-- 视频卡片 —— PiliNara 同款:
       Style.cardSpace=8 / mdRadius=10 / aspectRatio=16:10 / 标题最多 2 行
       播放量 + 时长药丸盖在封面右下, 与上游首页卡片一致 -->
  <div class="card" :style="{ width: cardWS, height: cardHS, backgroundColor: U.c.surfaceContainerLow, borderRadius: U.rad.card + 'px' }" @click="onTap">
    <div class="cover" :style="{ width: cardWS, height: coverHS, borderRadius: U.rad.card + 'px', backgroundColor: U.c.surfaceContainerHighest }">
      <image v-if="v.pic" class="coverimg" :src="thumb(v.pic, picW)" :style="{ width: picWS, height: coverHS, borderRadius: U.rad.card + 'px' }" resize="cover"></image>
      <div class="meta" v-if="U.den.showStat !== false">
        <text class="mt" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">{{ v.playText }}</text>
        <text class="mt2" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">{{ v.durationText }}</text>
      </div>
    </div>
    <div class="body">
      <text class="title" :lines="2" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurface }">{{ v.title }}</text>
      <div class="subrow">
        <text class="awname" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ v.author }}</text>
        <text v-if="v.danmakuText" class="dm" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ v.danmakuText }}</text>
      </div>
    </div>
  </div>
</template>

<script>
import { ui } from '../design/ui.js'
import { SPEC } from '../design/tokens.js'

export default {
  name: 'video-card',
  props: {
    v: { type: Object, required: true },
    w: { type: Number, default: 208 }        // 卡片宽 (px)
  },
  data() {
    return { U: ui(), RATIO: SPEC.coverRatio }
  },
  computed: {
    // ★ 两套值, 别混用:
    //   coverH / picW 是**数字** (picW 要拼进图片 URL 的 @..w 参数)
    //   *S 结尾的是给 style 用的**带 px 字符串** (框架的 style 不吃裸数字, 否则盒子塌成 0)
    coverH() { return Math.round(this.w / this.RATIO) },
    picW() { return Math.round(this.w * 2) },
    coverHS() { return this.coverH + 'px' },
    picWS() { return this.picW + 'px' },
    cardWS() { return this.w + 'px' },
    // 卡片总高 = 封面 + 文字区 (标题 2 行 + 副信息). 给死高度网格才整齐.
    cardHS() { return (this.coverH + 54) + 'px' }
  },
  methods: {
    /**
     * 封面 URL.
     * ★ 幂等: api.js 的 list 接口已经调用过 format.thumb(480x300), 所以这里的 pic
     *   往往**已经带裁切参数**. 再拼一次会得到
     *     ...jpg@480w_300h_1c.jpg@556w_347h_1c.jpg
     *   这种非法 URL -> 真机上图片静默不显示. 所以必须先判断.
     */
    thumb(url, w) {
      const u = String(url || '')
      if (!u) return ''
      const base = u.indexOf('//') === 0 ? 'https:' + u : u
      if (base.indexOf('@') >= 0) return base          // 已有裁切参数, 直接用
      return base + '@' + w + 'w_' + Math.round(w / this.RATIO) + 'h_1c.jpg'
    },
    onTap() { this.$emit('open', this.v) }
  }
}
</script>

<style scoped>
.card { flex-direction: column; overflow: hidden; }
.cover { position: relative; overflow: hidden; }
.coverimg { }
.meta { position: absolute; right: 6px; bottom: 6px; flex-direction: row; align-items: center;
         background-color: rgba(0,0,0,0.55); border-radius: 8px; padding-left: 6px; padding-right: 6px; }
.mt { margin-right: 6px; }
.body { flex: 1; flex-direction: column; padding: 6px 8px 8px 8px; }
.title { }
.subrow { flex-direction: row; align-items: center; margin-top: 2px; }
.awname { flex: 1; }
.dm { margin-left: 6px; }
.mt2 { margin-left: 6px; }
</style>
