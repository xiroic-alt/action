<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="bac" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="bat" :style="T.t.body">返回</text>
      </div>
      <text class="ttl" :style="T.t.title">消息中心</text>
      <text v-if="summary !== ''" class="sum" :style="T.t.accentSm">{{ summary }}</text>
    </div>

    <div v-if="!logged" class="empty" :style="T.t.empty">
      <text class="et" :style="T.t.titleVar">未登录, 消息中心不可用</text>
      <div class="cta" :style="T.accentR" @click="goLogin"><text :style="T.t.onAccent">去登录</text></div>
    </div>

    <div v-else class="listwrap">
      <div class="heads">
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.reply }}</text><text :style="T.t.label">回复</text></div>
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.at }}</text><text :style="T.t.label">@我</text></div>
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.like }}</text><text :style="T.t.label">赞</text></div>
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.sys }}</text><text :style="T.t.label">系统</text></div>
      </div>

      <div class="tabs">
        <div v-for="t in tabs" :key="t.k" class="tab"
             :style="tab === t.k ? T.accentR : T.actionR" @click="setTab(t.k)">
          <text :style="tab === t.k ? T.t.onAccent : T.t.body">{{ t.n }}</text>
        </div>
      </div>

      <text v-if="loading && items.length === 0" class="st" :style="T.t.titleVar">加载中…</text>
      <text v-else-if="status !== '' && items.length === 0" class="st" :style="T.t.err" @click="retry">{{ status }}</text>

      <scroller v-else class="list" scroll-direction="vertical" :show-scrollbar="true"
                :loadmoreoffset="100" @loadmore="loadMore" @scroll="onReturnScroll($event, 'msgTop')">
        <div ref="msgTop" class="list-anchor"></div>

        <!-- 私信: 会话列表 -->
        <template v-if="tab === 'im'">
          <div v-for="c in sessions" :key="'s' + c.talkerId" class="row" :style="T.cardR" @click="openChat(c)">
            <image v-if="c.face !== ''" class="face" :src="c.face" resize="cover"></image>
            <div v-else class="face-ph" :style="T.accentR"><text :style="T.t.onAccent">{{ c.name !== '' ? c.name.charAt(0) : '私' }}</text></div>
            <div class="rmain">
              <text class="rwho" :style="T.t.accentSm">{{ c.name }}{{ c.unread > 0 ? (' (' + c.unread + ')') : '' }}</text>
              <text class="rcont" :style="T.t.caption">{{ c.content }}</text>
              <text class="rtime" :style="T.t.tiny">{{ c.timeText }}</text>
            </div>
          </div>
          <text v-if="sessions.length === 0 && !loading" class="empty2" :style="T.t.empty">还没有私信会话</text>
        </template>

        <!-- 四类通知: 游标分页 -->
        <template v-else>
          <div v-for="it in items" :key="it.id" class="row" :style="T.cardR" @click="open(it)">
            <div class="rmain">
              <text class="rwho" :style="T.t.accentSm">{{ it.uname }}</text>
              <text class="rtitle" :style="T.t.labelOn">{{ it.title }}</text>
              <text class="rcont" :style="T.t.caption">{{ it.content }}</text>
              <text class="rtime" :style="T.t.tiny">{{ timeText(it.time) }}</text>
            </div>
          </div>
          <text v-if="items.length === 0 && !loading && status === ''" class="empty2" :style="T.t.empty">这一类还没有消息</text>
        </template>

        <text v-if="hasMore" class="more" :style="T.t.accentSub" @click="loadMore">{{ loading ? '加载中…' : '上滑加载更多…' }}</text>
        <text v-if="status !== '' && items.length > 0" class="more" :style="T.t.err" @click="retry">{{ status }}</text>
      </scroller>
    </div>
    <BackTop :visible="topShown" :T="T" @activate="goTop" />
  </div>
</template>

<script>
// 消息中心 —— 分类 (回复/@我/赞/系统) 各自游标分页 + 私信会话入口.
// 接口与「不自动重试」的发送约定见 services/messages.js 顶部注释.
import { getMsgUnread } from '../../services/bili.js'
import { getMsgList, getSessions, MSG_TABS, fmtTime } from '../../services/messages.js'
import { tokens } from '../../services/theme.js'
import { hasCookie } from '../../services/auth.js'
import { scrollTopMixin } from '../../services/scroll-top.js'
import BackTop from '../../components/back-top.vue'
import { afterPaint } from '../../base-page.js'
import { logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

export default {
  name: 'msg',
  components: { BackTop },
  mixins: [scrollTopMixin],
  data() {
    return {
      T: tokens(),
      logged: false,
      tabs: MSG_TABS,
      tab: 'reply',
      unread: { reply: 0, at: 0, like: 0, sys: 0, total: 0 },
      items: [],
      cursor: null,
      hasMore: false,
      sessions: [],
      loading: false,
      status: '',
      gen: 0
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D },
    summary() {
      if (!this.logged) return ''
      return this.unread.total > 0 ? (this.unread.total + ' 条未读') : '暂无未读'
    }
  },
  mounted() {
    try { this.logged = hasCookie() } catch (e) { this.logged = false }
    if (this.logged) this.load(true)
  },
  methods: {
    onShow() {
      this.T = tokens()
      const now = hasCookie()
      if (now !== this.logged) { this.logged = now; if (now) this.load(true) }
    },
    onReturnScroll(e, target) { this.trackTop(e, target) },
    onUnload() { this.gen++ },

    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('settings') } catch (e2) {} } },
    goLogin() { try { $falcon.navTo('login', {}) } catch (e) {} },
    timeText(sec) { return fmtTime(sec) },
    retry() { this.load(true) },

    setTab(k) {
      if (this.tab === k) return
      this.tab = k
      this.items = []
      this.sessions = []
      this.cursor = null
      this.hasMore = false
      this.status = ''
      this.topShown = false
      this.load(true)
    },

    load(reset) {
      const self = this
      const g = ++this.gen
      this.loading = true
      if (reset) { this.items = []; this.sessions = []; this.cursor = null; this.status = '' }
      afterPaint(function () {
        // 未读计数与列表并行拉, 计数失败不挡列表
        getMsgUnread().then(function (u) {
          if (g !== self.gen) return
          self.unread = u
        }).catch(function () {})
        const task = self.tab === 'im'
          ? getSessions().then(function (list) {
              if (g !== self.gen) return
              self.sessions = list
              self.hasMore = false
            })
          : getMsgList(self.tab, reset ? null : self.cursor).then(function (r) {
              if (g !== self.gen || !r) return
              const seen = {}
              for (let i = 0; i < self.items.length; i++) seen[self.items[i].id] = 1
              for (let i = 0; i < r.items.length; i++) {
                if (!seen[r.items[i].id]) { self.items.push(r.items[i]); seen[r.items[i].id] = 1 }
              }
              self.cursor = r.cursor
              self.hasMore = r.hasMore
            })
        task.catch(function (e) {
          if (g !== self.gen) return
          self.status = (e && e.message ? e.message : String(e)).substring(0, 60)
          logError('消息', '加载失败: ' + self.status)
        }).then(function () {
          if (g !== self.gen) return
          self.loading = false
        })
      })
    },
    loadMore() {
      if (!this.hasMore || this.loading || this.tab === 'im') return
      this.load(false)
    },

    openChat(c) {
      if (!c || !c.talkerId) return
      try { $falcon.navTo('chat', { talkerId: String(c.talkerId), name: c.name, face: c.face }) } catch (e) {}
    },
    open(it) {
      const m = /BV[0-9A-Za-z]{10}/.exec(String(it.uri || ''))
      if (!m) return
      try { $falcon.navTo('page', { bvid: m[0], title: it.title }) } catch (e) {}
    }
  }
}
</script>

<style scoped>
.page { width: 960px; height: 266px; position: absolute; left: 0px; top: 0px; flex-direction: column; }
.topbar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { flex-direction: row; align-items: center; height: 40px; width: 132px; margin-left: 12px; justify-content: center; }
.bac { margin-right: 4px; }
.ttl { margin-left: 12px; flex: 1; }
.sum { margin-right: 16px; }
.empty { width: 100%; flex: 1; flex-direction: column; align-items: center; justify-content: center; }
.cta { margin-top: 16px; width: 200px; height: 44px; justify-content: center; align-items: center; }
.listwrap { width: 100%; flex: 1; flex-direction: column; }
.heads { width: 100%; flex-direction: row; margin-top: 6px; }
.hcell { width: 150px; height: 46px; margin-left: 10px; flex-direction: row; justify-content: center; align-items: center; }
.hnum { margin-right: 6px; }
.tabs { width: 100%; height: 42px; flex-direction: row; align-items: center; padding-left: 16px; }
.tab { width: 104px; height: 32px; margin-right: 8px; justify-content: center; align-items: center; }
.st { width: 100%; text-align: center; margin-top: 20px; }
.list { width: 100%; flex: 1; }
.row { width: 100%; flex-direction: row; padding-left: 16px; padding-right: 16px; padding-top: 8px; padding-bottom: 8px; margin-top: 6px; }
.face { width: 48px; height: 48px; border-radius: 24px; margin-right: 12px; }
.face-ph { width: 48px; height: 48px; border-radius: 24px; margin-right: 12px; justify-content: center; align-items: center; }
.rmain { flex: 1; flex-direction: column; }
.rtitle { margin-top: 4px; }
.rcont { margin-top: 4px; lines: 2; text-overflow: ellipsis; overflow: hidden; }
.rtime { margin-top: 6px; }
.empty2 { width: 100%; text-align: center; margin-top: 28px; }
.more { width: 100%; text-align: center; margin-top: 10px; margin-bottom: 16px; }
.list-anchor { width: 1px; height: 1px; }
</style>
