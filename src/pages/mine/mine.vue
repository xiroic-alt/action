<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 侧栏 (PiliNara NavigationRail 分支; 用户要求用侧栏, 不用底栏) -->
    <NavRail :key="themeKey" current="mine" :face="face" @select="onNav" @reselect="onReselect"
             @avatar="onAvatar" @search="onSearch"></NavRail>

    <div class="main">
      <!-- 顶部: 头像 + 昵称 + 等级 + 大会员
           (对应 PiliNara lib/pages/mine/view.dart 的 _buildUserInfo; 未登录显示「点击登录」) -->
      <div class="hdr" :style="{ backgroundColor: U.c.surfaceContainerLow }">
        <div class="hit" :style="{ width: '44px', height: '44px', justifyContent: 'center', alignItems: 'center' }" @click="goBack">
          <image class="hic" :src="MIc.back" :style="{ width: '24px', height: '24px' }"></image>
        </div>
        <div class="av" :style="avBox" @click="onLoginTap">
          <image v-if="isLogin && face !== ''" class="avimg" :src="face" :style="avBox"></image>
          <image v-else class="avic" :src="MIc.mine" :style="{ width: '26px', height: '26px' }"></image>
        </div>
        <div class="info" :style="{ flex: 1, height: '44px', flexDirection: 'column', justifyContent: 'center' }" @click="onLoginTap">
          <RichText class="name" :text="nameText" :size="U.f.subtitle" :color="U.c.onSurface" :lines="1" weight="bold" :drop-emoji="false" />
          <div class="subrow" :style="{ flexDirection: 'row', alignItems: 'center', marginTop: '2px' }">
            <div v-if="level > 0" class="lv" :style="{ backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.chip + 'px', paddingLeft: '6px', paddingRight: '6px', height: '18px', justifyContent: 'center', alignItems: 'center' }">
              <text class="lvt" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">LV{{ level }}</text>
            </div>
            <div v-if="isLogin && coin > 0" class="coinrow" :style="{ flexDirection: 'row', alignItems: 'center', marginLeft: '8px' }">
              <image class="coinic" :src="MIc.coin" :style="{ width: '14px', height: '14px' }"></image>
              <text class="coint" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }"> {{ coin }}</text>
            </div>
          </div>
        </div>
        <div class="hright" :style="{ flexDirection: 'row', alignItems: 'center', paddingRight: '12px' }">
          <div v-if="vip !== ''" class="vip" :style="{ backgroundColor: U.c.primaryContainer, borderRadius: U.rad.chip + 'px', paddingLeft: '8px', paddingRight: '8px', height: '24px', justifyContent: 'center', alignItems: 'center', marginRight: '8px' }">
            <text class="vipt" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onPrimaryContainer }">{{ vip }}</text>
          </div>
          <div class="setbtn" :style="{ width: '64px', height: '44px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.btn + 'px' }" @click="goSettings">
            <text class="sett" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">设置</text>
          </div>
        </div>
      </div>

      <!-- 分栏入口 (对应 PiliNara 的 fav_item / history_item / later_item 三个卡片) -->
      <div v-if="!inFolderItems" class="tabbar" :style="{ flexDirection: 'row', alignItems: 'center', height: '46px', paddingLeft: '12px' }">
        <div v-for="t in tabs" :key="t.id" class="tab" :style="tabStyle(t)" @click="pickTab(t)">
          <image class="tabic" :src="t.ic" :style="{ width: '18px', height: '18px' }"></image>
          <text class="tabt" :style="tabText(t)">{{ t.label }}</text>
        </div>
      </div>
      <!-- 进入某个收藏夹后: 返回收藏夹 + 夹名 + 刷新 -->
      <div v-else class="tabbar" :style="{ flexDirection: 'row', alignItems: 'center', height: '46px', paddingLeft: '12px' }">
        <div class="tab" :style="tabStyle(null)" @click="backToFolders">
          <image class="tabic" :src="MIc.back" :style="{ width: '18px', height: '18px' }"></image>
          <text class="tabt" :style="tabText(null)">收藏夹</text>
        </div>
        <RichText class="foldert" :text="folderTitle" :size="U.f.subtitle" :color="U.c.onSurface" :lines="1" :style="{ flex: 1, marginLeft: '10px' }" :drop-emoji="false" />
        <div class="tab" :style="tabStyle(null)" @click="refreshCurrent">
          <image class="tabic" :src="MIc.refresh" :style="{ width: '18px', height: '18px' }"></image>
          <text class="tabt" :style="tabText(null)">刷新</text>
        </div>
      </div>

      <!-- 列表: 封面 16:10 + 标题 2 行 + 作者/时长 (与 video-card 同视觉, 一条一行) -->
      <scroller class="body" scroll-direction="vertical" :show-scrollbar="true">
        <div v-if="loading && items.length === 0" class="hint">
          <text class="hintt" :style="U.t.weak">加载中…</text>
        </div>
        <div v-else-if="!isLogin" class="hint">
          <text class="hintt" :style="U.t.weak">登录后同步收藏 / 历史 / 稍后再看</text>
          <div class="loginbtn" :style="{ width: '140px', height: '44px', marginTop: '10px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.primary, borderRadius: U.rad.btn + 'px' }" @click="goLogin">
            <text class="loginbtt" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">去登录</text>
          </div>
        </div>
        <div v-else-if="status !== '' && items.length === 0" class="hint">
          <text class="hintt" :style="U.t.weak">{{ status }}</text>
        </div>
        <div v-else class="list" :style="{ flexDirection: 'column', paddingLeft: '12px', paddingTop: '2px' }">
          <div v-for="(it, idx) in items" :key="rowKey(it, idx)" class="row"
               :style="{ width: '100%', height: ROW_H + 'px', flexDirection: 'row', alignItems: 'center', marginBottom: '6px', paddingRight: '12px' }"
               @click="openItem(it)">
            <div class="cover" :style="coverBox">
              <image v-if="it.pic !== ''" class="cimg" :src="it.pic" :style="coverBox" resize="contain"></image>
              <div v-if="it.durationText !== ''" class="dur"
                   :style="{ position: 'absolute', right: '4px', bottom: '4px', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: '6px', paddingLeft: '5px', paddingRight: '5px', height: '18px', justifyContent: 'center', alignItems: 'center' }">
                <text class="durt" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">{{ it.durationText }}</text>
              </div>
            </div>
            <div class="rinfo" :style="{ flex: 1, flexDirection: 'column', justifyContent: 'center', marginLeft: '10px', height: ROW_H + 'px' }">
              <RichText class="rtitle" :text="it.title" :size="U.f.body" :color="U.c.onSurface" :lines="2" :drop-emoji="false" />
              <RichText class="rsub" :text="it.sub" :size="U.f.caption" :color="U.c.onSurfaceVariant" :lines="1" :style="{ marginTop: '3px' }" :drop-emoji="false" />
            </div>
          </div>
          <div v-if="items.length > 0 && (canMore || loading)" class="foot" :style="{ width: '100%', justifyContent: 'center', alignItems: 'center', paddingTop: '2px', paddingBottom: '10px' }">
            <div class="more" :style="{ paddingLeft: '22px', paddingRight: '22px', height: '44px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.btn + 'px' }" @click="loadMore">
              <text class="moret" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ moreText }}</text>
            </div>
          </div>
        </div>
      </scroller>
    </div>

    <!-- 轻提示: 框架没有 toast, 用页面内小条 (只做 transform 过渡, 不用 opacity 动画) -->
    <div v-if="tip !== ''" class="tip"
         :style="{ position: 'absolute', left: '302px', bottom: '8px', width: '440px', height: '40px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.inverseSurface, borderRadius: U.rad.chip + 'px' }">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
import RichText from '../../components/rich-text.vue'
// 「我的」页 —— 对齐 PiliNara lib/pages/mine/view.dart:
//   顶部用户信息 (头像 / 昵称 / 等级 / 大会员, 未登录显示「点击登录」)
//   + 三类卡片入口 (我的收藏 fav_item / 观看历史 history_item / 稍后再看 later_item),
//   点击在本页切换到对应分栏列表 (本页三个 tab). 数据全部走 services/api.js 的 Web 接口.
import NavRail from '../../components/nav-rail.vue'
import { ui } from '../../design/ui.js'
import { getCfg } from '../../core/config.js'
import { log } from '../../core/log.js'
import { nav, favFoldersAll, favResources, historyCursor, toViewList } from '../../services/api.js'

const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  refresh: require('../../assets/mi/refresh_24_w.png'),
  mine: require('../../assets/mi/nav_mine_26_w.png'),
  coin: require('../../assets/mi/coin_24_m.png')
}
const MI_D = {
  back: require('../../assets/mi/back_26_d.png'),
  refresh: require('../../assets/mi/refresh_24_d.png'),
  mine: require('../../assets/mi/nav_mine_26_d.png'),
  coin: require('../../assets/mi/coin_24_m.png')
}
const TABS = [
  { id: 'fav', label: '我的收藏', ic: require('../../assets/mi/favlist_24_m.png') },
  { id: 'hist', label: '观看历史', ic: require('../../assets/mi/hist_24_m.png') },
  { id: 'later', label: '稍后再看', ic: require('../../assets/mi/toview_24_m.png') }
]

const ROW_H = 68
const COVER_W = 96
const COVER_H = 60        // 96 / 60 = 16:10, 与 components/video-card.vue 同比例
const TIP_MS = 2000

export default {
  components: {NavRail, RichText },
  name: 'mine',
  data() {
    return {
      // ★ 世代守卫必须声明在 data 里: 否则 ++undefined = NaN, 而 NaN !== NaN 恒真,
      //   结果被判定为"过期"直接丢弃, 页面永远停在加载中 (项目历史踩过这个坑)
      genSeq: 0,
      U: ui(),
      nav: 'mine',
      user: null,               // services/api.js nav() 的结果
      face: '',
      tab: 'fav',
      favLevel: 'folders',      // 收藏分栏两层: folders 收藏夹列表 / items 某个收藏夹内容
      folderId: 0,
      folderTitle: '',
      favPage: 0,
      hasMore: false,
      cursor: { max: 0, view_at: 0 },
      items: [],
      loading: false,
      status: '',
      tip: '',
      ROW_H: ROW_H
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    isLogin() { return !!(this.user && this.user.isLogin) },
    nameText() { return this.isLogin ? (this.user.uname || '未知用户') : '点击登录' },
    level() { return this.isLogin ? (Number(this.user.level) || 0) : 0 },
    coin() { return this.isLogin ? (Number(this.user.coin) || 0) : 0 },
    vip() { return this.isLogin ? String(this.user.vip || '') : '' },
    tabs() { return TABS },
    inFolderItems() { return this.tab === 'fav' && this.favLevel === 'items' },
    // 主题变化时让子组件重建 (NavRail 自己持有 U, 不重建就不会换色)
    themeKey() { return getCfg('themeSeed') + '|' + getCfg('themeMode') + '|' + getCfg('pureBlack') },
    coverBox() {
      return {
        width: COVER_W + 'px',
        height: COVER_H + 'px',
        borderRadius: this.U.rad.card + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest
      }
    },
    avBox() {
      return {
        width: '44px',
        height: '44px',
        borderRadius: '22px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden'
      }
    },
    moreText() {
      if (this.loading) return '加载中…'
      return this.canMore ? '加载更多' : '没有更多了'
    },
    canMore() {
      if (this.tab === 'fav') return this.favLevel === 'items' && this.hasMore
      if (this.tab === 'hist') return this.items.length > 0 && this.cursor.max > 0
      return false
    }
  },
  methods: {
    // ---- 生命周期: 项目约定只有 onShow / onPageUnload 被转发 ----
    mounted() {
      // 私有键不进 data (Vue2 不代理以 _ 开头的键), 在 mounted 里显式初始化:
      // 世代计数必须真的是数字, 否则 ++this.genSeq 得到 NaN, 守卫会永远判"过期".
      this.genSeq = 0
      this._started = false
      this._tipTimer = null
      this._started = true
      this.refresh()
    },
    onShow() {
      this.U = ui()
      if (!this._started) { this._started = true; this.refresh(); return }
      // 从登录页 / 设置页回来: 轻量同步登录态, 只有状态变了才重拉列表
      this.recheck()
    },
    onPageUnload() {
      this.genSeq++
      if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null }
    },

    // ---- 数据 ----
    async refresh() {
      const gen = ++this.genSeq
      this.loading = true
      this.status = ''
      try {
        const me = await nav()
        if (gen !== this.genSeq) return
        this.user = me
        this.face = me.face || ''
        if (!me.isLogin) { this.items = []; return }
        await this.loadTab(gen)
      } catch (e) {
        if (gen !== this.genSeq) return
        this.status = (e && e.message ? e.message : String(e))
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },
    async loadCurrent() {
      const gen = ++this.genSeq
      this.loading = true
      this.status = ''
      if (!this.isLogin) { this.items = []; this.loading = false; return }
      try {
        await this.loadTab(gen)
      } catch (e) {
        if (gen !== this.genSeq) return
        this.status = (e && e.message ? e.message : String(e))
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },
    async recheck() {
      const gen = ++this.genSeq
      try {
        const me = await nav()
        if (gen !== this.genSeq) return
        const was = this.user ? this.user.isLogin : false
        this.user = me
        this.face = me.face || ''
        if (me.isLogin !== was) this.loadCurrent()
      } catch (e) {}
    },
    async loadTab(gen) {
      if (this.tab === 'fav') {
        if (this.favLevel === 'folders') {
          const r = await favFoldersAll()
          if (gen !== this.genSeq) return
          this.items = r.list.map(this.folderRow)
          this.status = r.list.length ? '' : '还没有收藏夹'
          return
        }
        const page = this.items.length ? (this.favPage + 1) : 1
        const r = await favResources(this.folderId, page)
        if (gen !== this.genSeq) return
        this.favPage = page
        const add = this.decorate(r.list)
        this.items = page === 1 ? add : this.items.concat(add)
        this.hasMore = r.hasMore
        if (page === 1 && !r.list.length) this.status = '这个收藏夹是空的'
        return
      }
      if (this.tab === 'hist') {
        if (this.items.length && !this.cursor.max) { this.status = '没有更多了'; return }
        if (!this.items.length) this.cursor = { max: 0, view_at: 0 }
        const r = await historyCursor(this.cursor.max, this.cursor.view_at)
        if (gen !== this.genSeq) return
        this.cursor = r.cursor
        this.items = this.items.concat(this.decorate(r.list))
        if (!this.items.length) this.status = '暂无观看历史'
        else if (!r.list.length) this.status = '没有更多了'
        return
      }
      // 稍后再看: 一次拉全, 没有分页
      if (this.items.length) { this.status = '没有更多了'; return }
      const list = await toViewList()
      if (gen !== this.genSeq) return
      this.items = this.decorate(list)
      this.status = list.length ? '' : '稍后再看是空的'
    },

    /** 列表项补上「作者 · 时长 · 进度」副标题 (与 PiliNara 卡片一致的信息密度) */
    decorate(list) {
      return (list || []).map(function (it) {
        const parts = []
        if (it.author) parts.push(it.author)
        if (it.durationText) parts.push(it.durationText)
        if (it.progressText) parts.push(it.progressText)
        it.sub = parts.join(' · ')
        it.type = 'video'
        return it
      })
    },
    folderRow(f) {
      return {
        type: 'folder',
        id: f.id,
        bvid: '',
        aid: f.id,
        title: f.title,
        pic: f.cover,
        durationText: '',
        sub: '共 ' + f.count + ' 个视频 · ' + (f.isPublic ? '公开' : '私密')
      }
    },

    // ---- 交互 ----
    pickTab(t) {
      const same = t.id === this.tab
      if (!same) this.tab = t.id
      // 点当前 tab = 回顶刷新 (PiliNara toTopAndRefresh 的行为)
      this.items = []
      this.cursor = { max: 0, view_at: 0 }
      this.hasMore = false
      this.favLevel = 'folders'
      this.favPage = 0
      this.loadCurrent()
    },
    enterFav(f) {
      if (!f || !f.id) return
      this.folderId = f.id
      this.folderTitle = f.title
      this.favLevel = 'items'
      this.items = []
      this.favPage = 0
      this.hasMore = false
      this.loadCurrent()
    },
    backToFolders() {
      this.favLevel = 'folders'
      this.items = []
      this.loadCurrent()
    },
    refreshCurrent() { this.loadCurrent() },
    async loadMore() {
      if (this.loading) return
      if (!this.canMore) { this.status = '没有更多了'; return }
      await this.loadCurrent()
    },
    openItem(it) {
      if (!it) return
      if (it.type === 'folder') { this.enterFav(it); return }
      if (it.openable && it.bvid) {
        log('我的', '打开 ' + it.bvid)
        try { $falcon.navTo('video', { bvid: it.bvid, title: it.title }) } catch (e) {}
        return
      }
      this.showTip('该记录不是普通视频稿件, 笔上暂不能播放')
    },

    // ---- 导航 ----
    goBack() {
      try { this.$page.finish() } catch (e) {
        try { $falcon.navTo('index', {}) } catch (e2) {}
      }
    },
    onNav(id) {
      if (id === 'home') { try { $falcon.navTo('index', {}) } catch (e) {} }
      else if (id === 'dyn') { this.showTip('动态页下一批接入') }
    },
    onReselect(id) { if (id === 'mine') this.pickTab({ id: this.tab }) },
    onAvatar() { this.onLoginTap() },        // PiliNara: 点头像 = 登录 / 切换账号
    onSearch() { try { $falcon.navTo('search', {}) } catch (e) {} },
    onLoginTap() { try { $falcon.navTo('login', {}) } catch (e) {} },
    goLogin() { this.onLoginTap() },
    goSettings() { try { $falcon.navTo('settings', {}) } catch (e) {} },

    // ---- 样式 ----
    tabStyle(t) {
      const on = t ? t.id === this.tab : false
      return {
        height: '44px',
        paddingLeft: '14px',
        paddingRight: '14px',
        marginRight: '8px',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: this.U.rad.chip + 'px',
        backgroundColor: on ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest
      }
    },
    tabText(t) {
      const on = t ? t.id === this.tab : false
      return {
        fontSize: this.U.f.body + 'px',
        color: on ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    },
    rowKey(it, idx) { return String(it.bvid || it.aid || it.id) + '_' + idx },

    // ---- 轻提示 ----
    showTip(msg) {
      this.tip = String(msg || '')
      if (this._tipTimer) clearTimeout(this._tipTimer)
      const self = this
      this._tipTimer = setTimeout(function () {
        self.tip = ''
        self._tipTimer = null
      }, TIP_MS)
    }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: row; }
.main { flex: 1; flex-direction: column; }
.hdr { height: 56px; flex-direction: row; align-items: center; padding-left: 8px; }
.av { margin-right: 10px; }
.info { }
.body { flex: 1; width: 100%; }
.hint { width: 100%; height: 140px; flex-direction: column; justify-content: center; align-items: center; }
.row { }
.cover { position: relative; overflow: hidden; }
.rinfo { }
.tip { }

/* ---- 补齐缺失的样式类 ----
   设备框架里 class 未定义 = 元素没有盒模型 = 0 尺寸 = 用户看不到
   (本页曾被这条坑到: 设置页/我的页只有空白). 内联 :style 只管具体取值,
   这里的类负责把"盒子"立起来. */
.hit { width: 44px; height: 44px; justify-content: center; align-items: center; }
.hic { width: 24px; height: 24px; }
.avimg { width: 44px; height: 44px; border-radius: 22px; }
.avic { width: 26px; height: 26px; }
.name { font-size: 16px; font-weight: bold; }
.subrow { flex-direction: row; align-items: center; }
.lv { height: 18px; flex-direction: row; justify-content: center; align-items: center; }
.lvt { font-size: 11px; }
.coinrow { flex-direction: row; align-items: center; }
.coinic { width: 14px; height: 14px; }
.coint { font-size: 11px; }
.hright { flex-direction: row; align-items: center; }
.vip { height: 24px; flex-direction: row; justify-content: center; align-items: center; }
.vipt { font-size: 11px; }
.setbtn { width: 64px; height: 44px; justify-content: center; align-items: center; }
.sett { font-size: 13px; }
.tabbar { flex-direction: row; align-items: center; height: 46px; }
.tab { flex-direction: row; align-items: center; height: 34px; padding-left: 10px; padding-right: 10px; }
.tabic { width: 18px; height: 18px; }
.tabt { font-size: 13px; margin-left: 4px; }
.foldert { font-size: 15px; }
.hintt { font-size: 14px; }
.loginbtn { width: 140px; height: 44px; justify-content: center; align-items: center; }
.loginbtt { font-size: 15px; }
.list { flex-direction: column; }
.cimg { height: 100%; }
.dur { flex-direction: row; justify-content: center; align-items: center; }
.durt { font-size: 11px; }
.rtitle { font-size: 15px; }
.rsub { font-size: 12px; }
.foot { flex-direction: row; justify-content: center; align-items: center; }
.more { flex-direction: row; justify-content: center; align-items: center; }
.moret { font-size: 13px; }
.tipt { font-size: 13px; }

</style>
