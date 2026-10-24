<template>
  <!-- 顶栏 —— PiliNara AppBarTheme 语义落到笔屏:
       elevation:0 / titleSpacing:0 / centerTitle:false / 标题 16px / 背景 surface
       出处 lib/utils/theme_utils.dart AppBarTheme -->
  <div class="bar" :style="{ backgroundColor: U.c.surface }">
    <div v-if="back" class="back" :style="{ width: '44px', height: '44px' }" @click="$emit('back')">
      <image class="bic" :src="MIc.back" :style="{ width: '24px', height: '24px' }"></image>
    </div>
    <div v-if="!back && leadingSlot" class="leading" :style="{ width: '44px', height: '44px' }" @click="$emit('leading')">
      <image class="lic" :src="MIc.leading" :style="{ width: '22px', height: '22px' }"></image>
    </div>
    <div class="ttlwrap">
      <text class="ttl" :lines="1" :style="{ fontSize: U.f.title + 'px', color: U.c.onSurface }">{{ title }}</text>
    </div>
    <div class="actions">
      <div v-for="(a, i) in actions" :key="i" class="act" :style="{ width: '44px', height: '44px' }" @click="$emit('action', a)">
        <image class="aic" :src="iconOf(a)" :style="{ width: '22px', height: '22px' }"></image>
      </div>
    </div>
  </div>
</template>

<script>
import { ui } from '../design/ui.js'
const MI = {
  back: require('../assets/mi/back_26_w.png'),
  search: require('../assets/mi/search_24_w.png'),
  more: require('../assets/mi/more_24_w.png'),
  refresh: require('../assets/mi/refresh_24_w.png'),
  close: require('../assets/mi/close_24_w.png')
}
const MI_D = {
  back: require('../assets/mi/back_26_d.png'),
  search: require('../assets/mi/search_24_d.png'),
  more: require('../assets/mi/more_24_d.png'),
  refresh: require('../assets/mi/refresh_24_d.png'),
  close: require('../assets/mi/close_24_d.png')
}
export default {
  name: 'app-bar',
  props: {
    title: { type: String, default: '' },
    back: { type: Boolean, default: false },
    leading: { type: String, default: '' },   // 非返回的左侧图标名 (search/refresh/...)
    actions: { type: Array, default: () => [] }
  },
  data() { return { U: ui() } },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    leadingSlot() { return this.leading !== '' }
  },
  methods: {
    iconOf(name) { return this.MIc[name] || this.MIc.more }
  }
}
</script>

<style scoped>
.bar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { justify-content: center; align-items: center; }
.leading { justify-content: center; align-items: center; }
.ttlwrap { flex: 1; flex-direction: row; align-items: center; padding-left: 4px; }
.ttl { }
.actions { flex-direction: row; align-items: center; }
.act { justify-content: center; align-items: center; }
/* 图标类必须显式给盒子: 框架里 class 未定义 = 0 尺寸 = 图标不显示 */
.bic { width: 24px; height: 24px; }
.lic { width: 22px; height: 22px; }
.aic { width: 22px; height: 22px; }
</style>
