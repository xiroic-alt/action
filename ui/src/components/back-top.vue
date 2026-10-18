<template>
  <div v-if="visible" class="back-top" :style="boxStyle" @click="activate">
    <text class="back-top-label" :style="T.t.onAccent">回到顶部</text>
  </div>
</template>
<script>
export default {
  name: 'back-top',
  props: {
    visible: { type: Boolean, default: false },
    T: { type: Object, required: true },
    // ★ lift: 向上抬多少像素. 带底部发评栏(发送按钮)的页面必须抬起来 ——
    //   回顶按钮原本固定 right:12 bottom:12, 高 44px, 正好压在 44px 高的底栏上,
    //   把「发送」盖住 (用户报的"回到顶部的按钮会挡住发送按钮").
    lift: { type: Number, default: 0 }
  },
  computed: {
    // 只绑一次 :style (同一元素写两个 :style 会被框架丢掉一个, 踩过)
    boxStyle() {
      var base = this.T.accentR || {}
      var out = {}
      for (var k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k] }
      out.bottom = (12 + (Number(this.lift) || 0)) + 'px'
      return out
    }
  },
  methods: { activate() { this.$emit('activate') } }
}
</script>
<style scoped>
.back-top { position: absolute; right: 12px; bottom: 12px; width: 116px; height: 44px; justify-content: center; align-items: center; z-index: 90; }
.back-top-label { font-size: 17px; }
</style>
