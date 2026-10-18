<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 侧栏 (PiliNara NavigationRail 分支; 用户要求用侧栏, 不用底栏) -->
    <NavRail :key="themeKey" current="mine" :face="face" @select="onNav" @reselect="onReselect"
             @avatar="onAvatar" @search="onSearch"></NavRail>

    <div class="main">
      <!-- 顶部: 头像 + 昵称 + 等级 + 大会员 (对应 PiliNara mine/view.dart _buildUserInfo;
           未登录显示「点击登录」, 点击进登录页) -->
      <div class="hdr" :style="{ backgroundColor: U.c.surfaceContainerLow }">
        <div class="back" :style="{ width: '44px', height: '44px' }" @click="goBack">
          <image class="bic" :src="MIc.back" :style="{ width: '24px', height: '24px' }"></image>
        </div>
        <div class="av" :style="avBox" @click="onLoginTap">
          <image v-if="isLogin && face !== ''" class="avimg" :src="face" :style="avBox"></image>
          <image v-else class="avic" :src="MIc.mine" :style="{ width: '26px', height: '26px' }"></image>
        </div>
        <div class="info" :style="{ flex: 1, height: '44px', justifyContent: 'center' }" @click="onLoginTap">
          <text class="name" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface, fontWeight: 'bold' }">{{ nameText }}</text>
          <div class="subrow" :style="{ flexDirection: 'row', alignItems: 'center', marginTop: '2px' }">
            <div v-if="level > 0" class="lv" :style="{ backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.chip + 'px', paddingLeft: '6px', paddingRight: '6px', height: '18px', justifyContent: 'center' }">
              <text class="lvt" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">LV{{ level }}</text>
            </div>
            <div v-if="isLogin && coin > 0" class="coinrow" :style="{ flexDirection: 'row', alignItems: 'center', marginLeft: '8px' }">
              <image class="coinic" :src="MIc.coin" :style="{ width: '14px', height: '14px' }"></image>
              <text class="coint" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }"> {{ coin }}</text>
            </div>
          </div>
        </div>
        <div class="hright" :style="{ flexDirection: 'row', alignItems: 'center', paddingRight: '12px' }">
          <div v-if="vip !== ''" class="vip" :style="{ backgroundColor: U.c.primaryContainer, borderRadius: U.rad.chip + 'px', paddingLeft: '8px', paddingRight: '8px', height: '24px', justifyContent: 'center', marginRight: '8px' }">
            <text class="vipt" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onPrimaryContainer }">{{ vip }}</text>
          </div>
          <div class="setbtn" :style="{ width: '64px', height: '44px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.btn + 'px' }" @click="goSettings">
            <text class="sett" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">设置</text>
          </div>
        </div>
      </div>

      <!-- 分栏 tab (对应 PiliNara fav_item / history_item / later_item 三个卡片入口) -->
      <div class="tabs" :style="{ flexDirection: 'row', alignItems: 'center', height: '46px', paddingLeft: '12px' }">
        <template v-if="!(tab === 'fav' && favLevel === 'items')">
          <div v-for="t in tabs" :key="t.id" class="tab" :style="tabStyle(t)" @click="pickTab(t)">
            <image class="tabic" :src="t.ic" :style="{ width: '18px', height: '18px' }"></image>
            <text class="tabt" :style="tabText(t)">{{ t.label }}</text>
          </div>
        </template>
        <template v-else>
          <div class="tab" :style="tabStyle(null)" @click="backToFolders">
            <image class="tabic" :src="MIc.back" :style="{ width: '18px', height: '18px' }"></image>
            <text class="tabt" :style="tabText(null)">收藏夹</text>
          </div>
          <text class="foldert" :lines="1" :style="{ flex: 1, fontSize: U.f.subtitle + 'px', color: U.c.onSurface, marginLeft: '10px' }">{{ folderTitle }}</text>
          <div class="tab" :style="tabStyle(null)" @click="refreshCurrent">
            <image class="tabic" :src="MIc.refresh" :style="{ width: '18px', height: '18px' }"></image>
            <text class="tabt" :style="tabText(null)">刷新</text>
          </div>
        </template>
      </div>

      <!-- 列表区 (封面 16:10 + 标题 2 行 + 作者/时长; 一行一条, 视觉对齐 video-card) -->
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
        <div v-else class="list" :style="{ paddingLeft: '12px', paddingTop: '2px' }">
          <div v-for="(it, idx) in items" :key="rowKey(it, idx)" class="row"
               :style="{ width: '100%', height: ROW_H + 'px', flexDirection: 'row', alignItems: 'center', marginBottom: '6px', paddingRight: '12px' }"
               @click="openItem(it)">
            <div class="cover" :style="coverBox">
              <image v-if="it.pic !== ''" class="cimg" :src="it.pic" :style="coverBox" resize="cover"></image>
              <div v-if="it.durationText !== ''" class="dur"
                   :style="{ position: 'absolute', right: '4px', bottom: '4px', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: '6px', paddingLeft: '5px', paddingRight: '5px', height: '18px', justifyContent: 'center' }">
                <text class="durt" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">{{ it.durationText }}</text>
              </div>
            </div>
            <div class="rinfo" :style="{ flex: 1, flexDirection: 'column', justifyContent: 'center', marginLeft: '10px', height: ROW_H + 'px' }">
              <text class="rtitle" :lines="2" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurface, lineHeight: '17px' }">{{ it.title }}</text>
              <text class="rsub" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant, marginTop: '3px' }">{{ it.sub }}</text>
            </div>
          </div>
          <div v-if="items.length > 0" class="foot" :style="{ width: '100%', justifyContent: 'center', alignItems: 'center', paddingTop: '2px', paddingBottom: '10px' }">
            <div class="more" :style="{ paddingLeft: '22px', paddingRight: '22px', height: '44px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.btn + 'px' }" @click="loadMore">
              <text class="moret" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ moreText }}</text>
            </div>
          </div>
        </div>
      </scroller>
    </div>

    <!-- 轻提示 (无 toast API, 用页面内小条, transform 过渡即可) -->
    <div v-if="tip !== ''" class="tip" :style="{ position: 'absolute', left: (S.width - 440) / 2 + 'px', bottom: '8px', width: '440px', height: '40px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.inverseSurface, borderRadius: U.rad.chip + 'px' }">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
// 「我的」页 —— 对齐 PiliNara lib/pages/mine/view.dart:
//   顶部用户信息 (头像/昵称/等级/大会员, 未登录显示「点击登录」) + 三类入口
//   (我的收藏 fav_item / 观看历史 history_item / 稍后再看 later_item),
//   点击在本页切换到对应分栏列表. 数据全部走 services/api.js 的 Web 接口.
import NavRail from '../../components/nav-rail.vue'
import { ui } from '../../design/ui.js'
import { SCREEN } from '../../design/tokens.js'
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
const COVER_H = 60   // 96 / 60 = 16:10, 与 video-card 同比例
const TIP_MS = 2000

export default {
  components: { NavRail },
  name: 'mine',
  data() {
    return {
      U: ui(),
      S: SCREEN,
      nav: 'mine',
      user: null,            // services/api.js nav() 结果
      face: '',
      tab: 'fav',
      favLevel: 'folders',   // 收藏分栏的两层: folders 收藏夹列表 / items 某个收藏夹内容
      folderId: 0,
      folderTitle: '',
      favPage: 0,
      hasMore: false,
      cursor: { max: 0, view_at: 0 },
      items: [],
      loading: false,
      status: '',
      tip: '',
      ROW_H: ROW_H,
      coverBox: { width: COVER_W + 'px', height: COVER_H + 'px', borderRadius: '8px', backgroundColor: '#00000022' },
      avBox: { width: '44px', height: '44px', borderRadius: '22px', backgroundColor: '#00000022', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
      _started: false,
      _tipTimer: null
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
    themeKey() {
      return getCfg('themeSeed') + '|' + getCfg('themeMode') + '|' + getCfg('pureBlack')
    },
    moreText() {
      if (this.loading) return '加载中…'
      if (!this.canMore) return '没有更多了'
      return '加载更多'
    },
    canMore() {
      if (this.tab === 'fav') return this.favLevel === 'items' && this.hasMore
      if (this.tab === 'hist') return this.cursor.max > 0 && this.items.length > 0
      return false
    }
  },
  methods: {
    // ---- 生命周期: 只有 onShow / onPageUnload 会被框架转发 (项目约定) ----
    mounted() {
      // 注意: Vue2 的 data 里以 _ 开头的键不会代理到实例 (isReserved), 世代守卫必须显式初始化
      if (typeof this._gen !== 'number') this._gen = 0
      if (!this._started) { this._started = true; this.refresh() }
    },
    onShow() {
      this.U = ui()
      if (typeof this._gen !== 'number') this._gen = 0
      if (!this._started) { this._started = true; this.refresh(); return }
      // 从登录页/设置页回来: 同步一次登录态, 状态变化时才重拉列表
      this.recheck()
    },
    onPageUnload() {
      this.bumpGen()
      if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null }
    },
    bumpGen() { if (typeof this._gen === 'number') this._gen++ },

    // ---- 数据 ----
    // 先拉登录态 (nav), 再拉当前分栏
    async refresh() {
      const gen = ++this._gen
      this.loading = true
      this.status = ''
      try {
        const me = await nav()
        if (gen !== this._gen) return
        this.user = me
        this.face = me.face || ''
        if (!me.isLogin) { this.items = []; return }
        await this.loadTab(gen)
      } catch (e) {
        if (gen !== this._gen) return
        this.status = (e && e.message ? e.message : String(e))
      } finally {
        if (gen === this._gen) this.loading = false
      }
    },
    // 只拉当前分栏 (登录态已有, 不再请求 nav)
    async loadCurrent() {
      const gen = ++this._gen
      this.loading = true
      this.status = ''
      if (!this.isLogin) { this.items = []; this.loading = false; return }
      try {
        await this.loadTab(gen)
      } catch (e) {
        if (gen !== this._gen) return
        this.status = (e && e.message ? e.message : String(e))
      } finally {
        if (gen === this._gen) this.loading = false
      }
    },
    // 从登录页回来时轻量同步登录态 (不改动列表, 登录状态变化才重拉)
    async recheck() {
      const gen = ++this._gen
      try {
        const me = await nav()
        if (gen !== this._gen) return
        const was = this.user ? this.user.isLogin : false
        this.user = me
        this.face = me.face || ''
        if (me.isLogin !== was) this.loadCurrent()
      } catch (e) {}
    },
    async loadTab(gen) {
      if (this.tab === 'fav') {
        if (this.favLevel === 'folders') {
          // 收藏夹列表 (favorites 的第一层)
          const r = await favFoldersAll()
          if (gen !== this._gen) return
          this.folders = r.list
          this.items = r.list.map(this.folderRow)
          this.status = r.list.length ? '' : '还没有收藏夹'
          return
        }
        // 某个收藏夹的内容 (favResources 分页)
        const page = this.items.length ? (this.favPage + 1) : 1
        const r = await favResources(this.folderId, page)
        if (gen !== this._gen) return
        this.favPage = page
        this.items = page === 1 ? this.decorate(r.list) : this.items.concat(this.decorate(r.list))
        this.hasMore = r.hasMore
        if (page === 1 && !r.list.length) this.status = '这个收藏夹是空的'
        return
      }
      if (this.tab === 'hist') {
        // 观看历史 (游标分页)
        if (this.items.length && !this.cursor.max) { this.status = '没有更多了'; return }
        if (!this.items.length) this.cursor = { max: 0, view_at: 0 }
        const r = await historyCursor(this.cursor.max, this.cursor.view_at)
        if (gen !== this._gen) return
        this.cursor = r.cursor
        this.items = this.items.concat(this.decorate(r.list))
        if (this.items.length && !r.list.length) this.status = '没有更多了'
        else if (!this.items.length) this.status = '暂无观看历史'
        return
      }
      // 稍后再看 (一次拉全)
      if (this.items.length) { this.status = '没有更多了'; return }
      const list = await toViewList()
      if (gen !== this._gen) return
      this.items = this.decorate(list)
      this.status = list.length ? '' : '稍后再看是空的'
    },

    // 列表装饰: 补上「作者 · 时长 · 进度」副标题与类型标记
    decorate(list) {
      const self = this
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
      if (t.id === this.tab) {
        // 已是当前页 -> 回顶/刷新 (PiliNara: toTopAndRefresh)
        this.items = []
        this.cursor = { max: 0, view_at: 0 }
        this.favLevel = 'folders'
        this.loadCurrent()
        return
      }
      this.tab = t.id
      this.items = []
      this.cursor = { max: 0, view_at: 0 }
      this.hasMore = false
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
        try { $falcon.navTo('play', { bvid: it.bvid, title: it.title }) } catch (e) {}
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
    onReselect(id) { if (id === 'mine') this.pickTab(this.tab) },
    onAvatar() { this.onLoginTap() },   // PiliNara: 点头像 = 登录 / 切换账号
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
        borderRadius: U_rad(this.U),
        backgroundColor: on ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest
      }
    },
    tabText(t) {
      const on = t ? t.id === this.tab : false
      return { fontSize: this.U.f.body + 'px', color: on ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant }
    },
    rowKey(it, idx) { return (it.bvid || it.aid || it.id) + '_' + idx },

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

// 圆角档位复用 ui() 的 radii (与行内样式一致, 单独抽出来避免重复计算)
function U_rad(U) { return U.rad.chip + 'px' }
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: row; }
.main { flex: 1; flex-direction: column; }
.hdr { height: 56px; flex-direction: row; align-items: center; padding-left: 8px; }
.back { justify-content: center; align-items: center; }
.av { margin-right: 10px; }
.info { }
.hint { width: 100%; height: 140px; justify-content: center; align-items: center; flex-direction: column; }
.hintt { }
.body { flex: 1; width: 100%; }
.list { flex-direction: column; padding-right: 0px; }
.row { }
.cover { position: relative; overflow: hidden; }
.rinfo { }
</style>
