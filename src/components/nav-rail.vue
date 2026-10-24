<template>
  <!-- 侧栏 (PiliNara 的 NavigationRail 分支; 用户要求: 用侧栏, 不用底栏)
       出处 lib/pages/main/view.dart:285-303
         groupAlignment: 0.5   -> 导航项垂直居中
         labelType: .selected  -> 只有选中项显示文字
         backgroundColor: transparent -> 笔屏无模糊层, 这里改 surfaceContainerLow (否则与内容糊在一起)
         leading: userAndSearchVertical() -> 头像 + 搜索, 竖排在最上方 -->
  <div class="rail" :style="{ backgroundColor: U.c.surfaceContainerLow, width: S.navRail + 'px' }">
    <div class="lead">
      <div class="av" :style="{ width: '40px', height: '40px', borderRadius: U.rad.chip + 'px', backgroundColor: U.c.surfaceContainerHighest }" @click="onAvatar">
        <image v-if="face !== ''" class="avimg" :src="face" :style="{ width: '40px', height: '40px', borderRadius: U.rad.chip + 'px' }"></image>
        <image v-else class="avic" :src="MIc.mine" :style="{ width: '26px', height: '26px' }"></image>
      </div>
      <div class="sbtn" :style="{ width: '40px', height: '40px', borderRadius: U.rad.chip + 'px', backgroundColor: U.c.surfaceContainerHighest }" @click="onSearch">
        <image class="sic" :src="MIc.search" :style="{ width: '22px', height: '22px' }"></image>
      </div>
    </div>

    <div class="group">
      <!-- 选中态: 圆角矩形作为 .dest 的绝对定位子元素.
           ★ .dest 必须有 position: relative, 否则绝对定位会相对外层容器,
             圆角矩形被裁掉一半 (真机截图就是这个现象). -->
      <div v-for="it in items" :key="it.id" class="dest" :style="destStyle(it)" @click="pick(it)">
        <div v-if="it.id === current" class="ind" :style="indStyle()"></div>
        <image class="dic" :src="ic(it)" :style="{ width: '24px', height: '24px' }"></image>
        <text v-if="it.id === current" class="dlab" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onPrimaryContainer }">{{ it.label }}</text>
      </div>
    </div>
  </div>
</template>

<script>
import { ui } from '../design/ui.js'
import { SCREEN } from '../design/tokens.js'

const MI = {
  home: require('../assets/mi/nav_home_26_w.png'),
  homeOn: require('../assets/mi/nav_home_26_p.png'),
  dyn: require('../assets/mi/nav_dyn_26_w.png'),
  dynOn: require('../assets/mi/nav_dyn_26_p.png'),
  mine: require('../assets/mi/nav_mine_26_w.png'),
  mineOn: require('../assets/mi/nav_mine_26_p.png'),
  search: require('../assets/mi/search_24_w.png')
}
const MI_D = {
  home: require('../assets/mi/nav_home_26_d.png'),
  homeOn: require('../assets/mi/nav_home_26_p.png'),
  dyn: require('../assets/mi/nav_dyn_26_d.png'),
  dynOn: require('../assets/mi/nav_dyn_26_p.png'),
  mine: require('../assets/mi/nav_mine_26_d.png'),
  mineOn: require('../assets/mi/nav_mine_26_p.png'),
  search: require('../assets/mi/search_24_d.png')
}

export default {
  name: 'nav-rail',
  props: {
    current: { type: String, default: 'home' },
    face: { type: String, default: '' }
  },
  data() {
    return {
      U: ui(),
      S: SCREEN,
      // 只 3 项 —— 与 nav_bar_config.dart 的 NavigationBarType 一致
      items: [
        { id: 'home', label: '首页' },
        { id: 'dyn', label: '动态' },
        { id: 'mine', label: '我的' }
      ]
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D }
  },
  methods: {
    ic(it) {
      const m = this.MIc
      const on = it.id === this.current
      if (it.id === 'home') return on ? m.homeOn : m.home
      if (it.id === 'dyn') return on ? m.dynOn : m.dyn
      return on ? m.mineOn : m.mine
    },
    pick(it) {
      if (it.id === this.current) { this.$emit('reselect', it.id); return }
      this.$emit('select', it.id)
    },
    destStyle(it) {
      // 未选中保持透明 (Material NavigationRail 原貌: 只有选中项有 indicator)
      return { backgroundColor: 'transparent', borderRadius: this.U.rad.chip + 'px' }
    },
    indStyle() {
      return {
        backgroundColor: this.U.c.primaryContainer,
        borderRadius: this.U.rad.chip + 'px'
      }
    },
    onAvatar() { this.$emit('avatar') },
    onSearch() { this.$emit('search') }
  }
}
</script>

<style scoped>
.rail { height: 266px; flex-direction: column; align-items: center; }
.lead { flex-direction: column; align-items: center; margin-top: 6px; }
/* 头像/搜索按钮: 用比侧栏底色亮一档的容器, 否则在深色下几乎看不见 */
.av { justify-content: center; align-items: center; margin-bottom: 6px; overflow: hidden; }
.sbtn { justify-content: center; align-items: center; }
.group { flex: 1; flex-direction: column; align-items: center; justify-content: center; }
/* 命中区必须显式尺寸 (本机只挂 padding 的 div 命中区为 0);
   position: relative 是选中态圆角矩形的定位上下文, 缺了就会被裁切 */
.dest { position: relative; width: 64px; height: 52px; flex-direction: column;
        justify-content: center; align-items: center; margin-top: 1px; margin-bottom: 1px; }
.ind { position: absolute; left: 0px; top: 0px; width: 64px; height: 52px; }
.dlab { margin-top: 1px; }
.avimg { width: 40px; height: 40px; border-radius: 20px; }
.avic { width: 24px; height: 24px; }
.sic { width: 20px; height: 20px; }
.dic { width: 24px; height: 24px; }
</style>
