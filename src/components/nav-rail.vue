<template>
  <!-- 侧栏 (PiliNara 的 NavigationRail 分支; 用户要求: 用侧栏, 不用底栏)
       出处 lib/pages/main/view.dart:285-303
         groupAlignment: 0.5   -> 导航项垂直居中
         labelType: .selected  -> 只有选中项显示文字
         backgroundColor: transparent -> 笔屏无模糊层, 这里改 surfaceContainerLow (否则与内容糊在一起)
         leading: userAndSearchVertical() -> 头像 + 搜索, 竖排在最上方 -->
  <div class="rail" :style="{ backgroundColor: U.c.surfaceContainerLow, width: S.navRail + 'px' }">
    <div class="lead">
      <div class="av" :style="{ width: '44px', height: '44px', borderRadius: U.rad.chip + 'px', backgroundColor: U.c.surfaceContainerHighest }" @click="onAvatar">
        <image v-if="face !== ''" class="avimg" :src="face" :style="{ width: '44px', height: '44px', borderRadius: U.rad.chip + 'px' }"></image>
        <image v-else class="avic" :src="MIc.mine" :style="{ width: '24px', height: '24px' }"></image>
      </div>
      <div class="sbtn" :style="{ width: '44px', height: '44px', borderRadius: U.rad.chip + 'px', backgroundColor: U.c.surfaceContainerHighest }" @click="onSearch">
        <image class="sic" :src="MIc.search" :style="{ width: '22px', height: '22px' }"></image>
      </div>
    </div>

    <div class="group">
      <div v-for="it in items" :key="it.id" class="dest" @click="pick(it)">
        <div v-if="it.id === current" class="ind" :style="{ backgroundColor: U.c.primaryContainer, borderRadius: U.rad.chip + 'px' }"></div>
        <image class="dic" :src="ic(it)" :style="{ width: '26px', height: '26px' }"></image>
        <text v-if="it.id === current" class="dlab" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurface }">{{ it.label }}</text>
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
    onAvatar() { this.$emit('avatar') },
    onSearch() { this.$emit('search') }
  }
}
</script>

<style scoped>
.rail { height: 266px; flex-direction: column; align-items: center; }
.lead { flex-direction: column; align-items: center; margin-top: 8px; }
.av { justify-content: center; align-items: center; margin-bottom: 8px; overflow: hidden; }
.sbtn { justify-content: center; align-items: center; }
.group { flex: 1; flex-direction: column; align-items: center; justify-content: center; }
/* 命中区必须显式尺寸 (本机只挂 padding 的 div 命中区为 0) */
.dest { width: 64px; height: 58px; justify-content: center; align-items: center; margin-top: 2px; margin-bottom: 2px; }
.ind { position: absolute; left: 0px; top: 0px; width: 64px; height: 58px; }
.dlab { margin-top: 1px; }
.avimg { width: 44px; height: 44px; border-radius: 22px; }
.avic { width: 24px; height: 24px; }
.sic { width: 22px; height: 22px; }
.dic { width: 26px; height: 26px; }
</style>
