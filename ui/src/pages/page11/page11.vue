<!-- 详情页副本 page11 (生成产物, 不要手改)
     由 tools/gen-detail-ring.mjs 按 services/detail-ring.js 的 RING 生成.
     固件对同名页 navTo 只替换不入栈, 所以"详情套详情"必须换页面名 —— 见 detail-ring.js 说明. -->
<template>
  <DetailPage ref="d" :next-page="nextOf('page11')" />
</template>

<script>
import DetailPage from '../page/page.vue'
import { nextOf } from '../../services/detail-ring.js'

export default {
  name: 'page11',
  components: { DetailPage: DetailPage },
  methods: {
    nextOf: nextOf,
    // BasePage 只向页面根组件转发 onShow/onHide/onUnload, 这里继续转给详情组件
    forward: function (hook) {
      var d = this.$refs && this.$refs.d
      if (d && typeof d[hook] === 'function') {
        try { d[hook]() } catch (e) { console.log('[page11] forward ' + hook + ' error: ' + (e && e.message ? e.message : e)) }
      }
    },
    onShow: function () { this.forward('onShow') },
    onHide: function () { this.forward('onHide') },
    onUnload: function () { this.forward('onUnload') }
  }
}
</script>
