<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="bac" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="bat" :style="T.t.body">返回</text>
      </div>
      <text class="ttl" :style="T.t.title">直播</text>
      <text v-if="status !== ''" class="st" :style="T.t.accentSm">{{ status }}</text>
    </div>

    <!-- 三个入口: 推荐 (匿名可用) / 关注 (需登录) / 搜索. 默认落在推荐 —— 打开就有内容 -->
    <div class="tabs">
      <div v-for="t in tabs" :key="t.k" class="tab"
           :style="tab === t.k ? T.accentR : T.actionR" @click="setTab(t.k)">
        <text :style="tab === t.k ? T.t.onAccent : T.t.body">{{ t.n }}</text>
      </div>
    </div>

    <div class="listwrap">
      <div v-if="tab === 'search'" class="searchbar">
        <div class="sinput" :style="T.insetR" @click="openKeyboard">
          <text class="stext" :style="T.t.body">{{ keyword || '搜索直播间' }}</text>
        </div>
        <div class="sbtn" :style="T.accentPill" @click="doSearch"><text :style="T.t.onAccent">搜索</text></div>
      </div>

      <text v-if="loading" class="st2" :style="T.t.titleVar">加载中…</text>
      <scroller v-else class="list" scroll-direction="vertical" :show-scrollbar="true"
                :loadmoreoffset="120" @loadmore="loadMore" @scroll="onReturnScroll($event, 'liveTop')">
        <div ref="liveTop" class="list-anchor"></div>

        <template v-if="tab === 'search'">
          <text class="sec" :style="T.t.label">热门分区</text>
          <div class="chips">
            <div v-for="a in hotAreas" :key="'a' + a" class="chip" :style="T.insetR" @click="quickSearch(a)">
              <text :style="T.t.label">{{ a }}</text>
            </div>
          </div>
          <text class="sec" :style="T.t.label">{{ rooms.length > 0 ? '搜索结果 (' + rooms.length + ')' : '点上面的分区或搜索' }}</text>
        </template>
        <text v-else class="sec" :style="T.t.label">{{ secTitle }}</text>

        <div v-for="r in rooms" :key="r.roomid" class="row" :style="T.cardR" @click="openRoom(r)">
          <image class="rcov" :src="r.cover" resize="cover" :style="{ width: '128px', height: '80px' }"></image>
          <div class="rmain">
            <text class="rtitle" :style="T.t.title">{{ r.title }}</text>
            <text class="rup" :style="T.t.accentSub">{{ r.area !== '' ? (r.up + ' · ' + r.area) : r.up }}</text>
            <text class="ron" :style="T.t.label">{{ onlineFmt(r.online) }} 人气</text>
          </div>
        </div>

        <text v-if="emptyText !== ''" class="dm-empty" :style="T.t.empty">{{ emptyText }}</text>
        <div v-if="hasMore && !loading" class="more" @click="loadMore">
          <text :style="T.t.accentSub">上滑加载更多…</text>
        </div>
      </scroller>
    </div>
    <BackTop :visible="topShown" :T="T" @activate="goTop" />
  </div>
</template>

<script>
// 直播发现页 —— 三个入口:
//   推荐  room/v1/room/get_user_recommend   匿名可用, 分页
//   关注  relation/v1/feed/feed_list        需登录, 只在开播时才进列表
//   搜索  wbi/search/type?search_type=live  (与旧版一致)
// 接口全部真机取证过 (2026-10-11): 被弃用的 xlive/.../second/getList 在本机恒 -352 风控.
// 播放一律交给 pages/player 的直播分支, 房间详情交给 pages/room —— 本页只负责"找到房间".
import { searchLive } from '../../services/bili.js'
import { onlineText, getRecommendRooms, getFollowedLives } from '../../services/live.js'
import { tokens } from '../../services/theme.js'
import { hasCookie } from '../../services/auth.js'
import { createIME } from '../../services/ime.js'
import { afterPaint } from '../../base-page.js'
import { scrollTopMixin } from '../../services/scroll-top.js'
import BackTop from '../../components/back-top.vue'
import { logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

const TABS = [
  { k: 'rec', n: '推荐' },
  { k: 'follow', n: '关注' },
  { k: 'search', n: '搜索' }
]

export default {
  name: 'live',
  components: { BackTop },
  mixins: [scrollTopMixin],
  data() {
    return {
      T: tokens(),
      tabs: TABS,
      tab: 'rec',
      keyword: '',
      rooms: [],
      searched: false,
      hotAreas: ['英雄联盟', '王者荣耀', '原神', '明日方舟', 'CS2', 'DOTA2'],
      loading: false,
      status: '',
      emptyText: '',
      page: 1,
      hasMore: false,
      logged: false,
      // 异步世代守卫 —— 必须声明在 data() 里, 否则 ++undefined = NaN 且 NaN !== NaN 恒真,
      // 结果会被整段丢弃并把 loading 永久卡住 (0.9.57 的教训)
      gen: 0,
      loaded: { rec: false, follow: false, search: false }
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D },
    secTitle() {
      if (this.tab === 'follow') return '关注的主播 (正在直播)'
      return this.rooms.length > 0 ? '为你推荐' : '正在加载推荐…'
    }
  },
  mounted() { this.logged = hasCookie(); this.ime = createIME() },
  methods: {
    onShow() {
      this.T = tokens()
      const now = hasCookie()
      if (now !== this.logged) this.logged = now
      // 首次进入就拉当前分类 (推荐是默认页, 打开即有内容)
      if (!this.loaded[this.tab]) this.load(true)
    },
    onReturnScroll(e, target) { this.trackTop(e, target) },
    onUnload() {
      this.gen++
      if (this.ime) { this.ime.destroy(); this.ime = null }
    },

    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('settings') } catch (e2) {} } },
    tip(m) {
      const self = this
      this.status = m
      if (this.statusTimer) clearTimeout(this.statusTimer)
      this.statusTimer = setTimeout(function () { self.status = '' }, 3000)
    },
    onlineFmt(n) { return onlineText(n) },

    setTab(k) {
      if (this.tab === k) return
      this.tab = k
      this.status = ''
      this.topShown = false
      if (!this.loaded[k]) this.load(true)
    },

    // 一个加载器管三类: reset=true 从第一页开始, 否则续翻
    load(reset) {
      const self = this
      const kind = this.tab
      const g = ++this.gen
      this.loading = true
      if (reset) {
        this.rooms = []
        this.page = 1
        this.hasMore = false
        this.emptyText = ''
        if (kind === 'search') this.searched = false
      }
      const nextPage = reset ? 1 : (this.page + 1)
      afterPaint(function () {
        let task = null
        if (kind === 'search') {
          const kw = String(self.keyword || '').trim()
          if (reset && kw === '') { self.loading = false; return }
          if (kw !== '') task = searchLive(kw, nextPage)
        } else if (kind === 'follow') {
          if (!self.logged) { self.loading = false; self.loaded.follow = true; self.emptyText = '登录后才能看到关注的主播'; return }
          task = getFollowedLives(nextPage)
        } else {
          task = getRecommendRooms(nextPage)
        }
        if (!task) { self.loading = false; return }
        task.then(function (list) {
          if (g !== self.gen) return
          const seen = {}
          for (let i = 0; i < self.rooms.length; i++) seen[self.rooms[i].roomid] = 1
          const add = []
          for (let i = 0; i < list.length; i++) {
            if (!list[i].roomid || seen[list[i].roomid]) continue
            seen[list[i].roomid] = 1
            add.push(list[i])
          }
          self.rooms = self.rooms.concat(add)
          self.page = nextPage
          self.hasMore = list.length >= 20
          self.loaded[kind] = true
          if (kind === 'search') self.searched = true
          if (self.rooms.length === 0) {
            self.emptyText = kind === 'follow'
              ? '关注的主播现在都没在直播'
              : (kind === 'search' ? '没有找到正在直播的房间' : '暂时没有推荐直播间')
          } else {
            self.emptyText = ''
          }
          if (reset) { self.topTarget = 'liveTop'; self.goTop() }
        }).catch(function (e) {
          if (g !== self.gen) return
          self.loaded[kind] = true
          const msg = (e && e.message ? e.message : String(e)).substring(0, 60)
          self.tip(msg)
          self.emptyText = msg
          logError('直播', '加载失败(' + kind + '): ' + msg)
        }).then(function () {
          if (g !== self.gen) return
          self.loading = false
        })
      })
    },
    loadMore() {
      if (this.loading || !this.hasMore) return
      if (this.tab === 'search' && String(this.keyword || '').trim() === '') return
      this.load(false)
    },

    async openKeyboard() {
      try {
        const text = await this.ime.open({ text: this.keyword, placeholder: '搜索直播间', maxlength: 32 })
        if (text === null) return
        this.keyword = text
        if (String(text).trim() === '') return
        this.doSearch()
      } catch (err) {
        logError('直播', '输入法失败: ' + err)
        this.tip('输入法打开失败')
      }
    },
    quickSearch(kw) { this.keyword = kw; this.doSearch() },
    doSearch() {
      const kw = String(this.keyword || '').trim()
      if (!kw) { this.tip('先输入关键词'); return }
      this.tab = 'search'
      this.load(true)
    },

    openRoom(r) {
      if (!r || !r.roomid) return
      try {
        $falcon.navTo('room', { roomid: String(r.roomid), title: r.title })
      } catch (e) {
        this.tip('打开直播间失败')
        logError('直播', 'navTo room 失败: ' + e)
      }
    }
  }
}
</script>

<style scoped>
.page { width: 960px; height: 266px; position: absolute; left: 0; top: 0; flex-direction: column; }
.topbar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { flex-direction: row; align-items: center; height: 40px; width: 132px; margin-left: 12px; justify-content: center; }
.bac { margin-right: 4px; }
.ttl { margin-left: 12px; flex: 1; }
.st { margin-right: 16px; }
/* 分类 chip: 与消息中心同一套形态 (显式尺寸, 本机只挂 padding 的 div 命中区为 0) */
.tabs { width: 960px; height: 42px; flex-direction: row; align-items: center; padding-left: 16px; }
.tab { width: 116px; height: 32px; margin-right: 8px; justify-content: center; align-items: center; }
.listwrap { width: 100%; flex: 1; flex-direction: column; }
.searchbar { width: 100%; height: 46px; flex-direction: row; align-items: center; }
.sinput { flex: 1; height: 38px; margin-left: 16px; justify-content: center; }
.stext { margin-left: 16px; }
.sbtn { width: 96px; height: 38px; margin-left: 10px; margin-right: 16px; justify-content: center; align-items: center; }
.st2 { width: 100%; text-align: center; margin-top: 20px; }
.list { width: 100%; flex: 1; }
.sec { margin-left: 20px; margin-top: 8px; margin-bottom: 4px; }
.chips { flex-direction: row; margin-left: 20px; flex-wrap: wrap; }
.chip { height: 32px; padding-left: 12px; padding-right: 12px; margin-right: 8px; margin-bottom: 6px;
        flex-direction: row; align-items: center; }
.row { width: 100%; flex-direction: row; margin-left: 20px; margin-right: 20px; margin-top: 8px; padding-left: 8px; padding-top: 8px; padding-bottom: 8px; }
.rcov { border-radius: 8px; margin-right: 12px; }
.rmain { flex: 1; flex-direction: column; }
.rup { margin-top: 4px; }
.ron { margin-top: 6px; }
.dm-empty { width: 100%; text-align: center; margin-top: 20px; }
.more { width: 100%; height: 40px; flex-direction: row; justify-content: center; align-items: center; margin-top: 8px; margin-bottom: 12px; }
.list-anchor { width: 1px; height: 1px; }
</style>
