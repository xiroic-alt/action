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
      <!-- 未读总览 (顶部统计, 与列表分类独立) -->
      <div class="heads">
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.reply }}</text><text :style="T.t.label">回复</text></div>
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.at }}</text><text :style="T.t.label">@我</text></div>
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.like }}</text><text :style="T.t.label">赞</text></div>
        <div class="hcell" :style="T.cardR"><text class="hnum" :style="T.t.title">{{ unread.sys }}</text><text :style="T.t.label">系统</text></div>
      </div>

      <!-- 分类 chip: 每类各自一份列表与游标 -->
      <div class="tabs">
        <div v-for="t in tabs" :key="t.k" class="tab"
             :style="tab === t.k ? T.accentR : T.actionR" @click="setTab(t.k)">
          <text :style="tab === t.k ? T.t.onAccent : T.t.body">{{ t.n }}</text>
        </div>
      </div>

      <div v-if="loading && items.length === 0" class="stbox"><text :style="T.t.titleVar">加载中…</text></div>
      <div v-else-if="status !== '' && items.length === 0" class="stbox-hit" :style="T.errActionR" @click="retry">
        <text :style="T.t.err">{{ status }} · 点此重试</text>
      </div>

      <scroller v-else class="list" scroll-direction="vertical" :show-scrollbar="true"
                :loadmoreoffset="100" @loadmore="loadMore" @scroll="onReturnScroll($event, 'msgTop')">
        <div ref="msgTop" class="list-anchor"></div>

        <!-- 私信: 会话列表 (点进去是 chat 页) -->
        <template v-if="tab === 'im'">
          <div v-for="c in sessions" :key="'s' + c.talkerId" class="row" :style="T.cardR" @click="openChat(c)">
            <image v-if="c.face !== ''" class="face" :src="c.face" resize="cover"></image>
            <div v-else class="face-ph" :style="T.accentBg"><text :style="T.t.onAccent">{{ c.name !== '' ? c.name.charAt(0) : '私' }}</text></div>
            <div class="rmain">
              <text class="rwho" :style="T.t.accentSm">{{ c.name !== '' ? c.name : ('UID ' + c.talkerId) }}{{ c.unread > 0 ? (' (' + c.unread + ')') : '' }}</text>
              <text class="rcont" :style="T.t.caption">{{ c.content }}</text>
              <text class="rtime" :style="T.t.tiny">{{ c.timeText }}</text>
            </div>
          </div>
          <text v-if="sessions.length === 0 && !loading && status === ''" class="empty2" :style="T.t.empty">还没有私信会话</text>
        </template>

        <!-- 四类通知: 各自游标分页 -->
        <template v-else>
          <div v-for="it in items" :key="it.id" class="row" :style="T.cardR" @click="open(it)">
            <div class="rmain">
              <text class="rwho" :style="T.t.accentSm">{{ it.uname !== '' ? it.uname : '系统' }}</text>
              <text v-if="it.title !== ''" class="rtitle" :style="T.t.labelOn">{{ it.title }}</text>
              <text class="rcont" :style="T.t.caption">{{ it.content }}</text>
              <text class="rtime" :style="T.t.tiny">{{ it.timeText }}</text>
            </div>
          </div>
          <text v-if="items.length === 0 && !loading && status === ''" class="empty2" :style="T.t.empty">这一类还没有消息</text>
        </template>

        <div v-if="hasMore" class="more" @click="loadMore">
          <text :style="T.t.accentSub">{{ loading ? '加载中…' : '上滑加载更多…' }}</text>
        </div>
        <div v-if="status !== '' && items.length > 0" class="more" @click="retry">
          <text :style="T.t.err">{{ status }} · 点此重试</text>
        </div>
      </scroller>
    </div>
    <BackTop :visible="topShown" :T="T" @activate="goTop" />
  </div>
</template>

<script>
// 消息中心 —— 分类 chip (回复 / @我 / 赞 / 系统 / 私信会话), 前四类各自游标分页.
// 接口出处、"未真机验证"范围与「发送绝不自动重试」的约定见 services/messages.js 顶部注释.
// 每类**各持一份** items/cursor/hasMore (itemsBy/cursorBy/moreBy), 切分类不互相清空:
// 切回来仍在原来那一页, 继续上滑是续翻而不是重新拉首页.
import { getMsgUnread } from '../../services/bili.js'
import { getMsgList, getSessions, MSG_TABS } from '../../services/messages.js'
import { nextDetailName } from '../../services/detail-ring.js'
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
      // 键在 data() 里全部声明好: Vue 2 侦测不到"新增对象键", 先占位才能保证切换即时生效
      itemsBy: { reply: [], at: [], like: [], sys: [] },
      cursorBy: { reply: null, at: null, like: null, sys: null },
      moreBy: { reply: false, at: false, like: false, sys: false },
      loadedBy: { reply: false, at: false, like: false, sys: false },
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
    },
    // 当前分类的视图 (模板只认这三个, 不直接碰 itemsBy)
    items() { return this.itemsBy[this.tab] || [] },
    hasMore() { return this.moreBy[this.tab] === true }
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
    retry() { this.load(true) },

    setTab(k) {
      if (this.tab === k) return
      this.tab = k
      this.status = ''
      this.topShown = false
      // 已经加载过的分类直接显示, 不重新拉首页 (各分类的列表/游标都在自己那一格里)
      if (k === 'im' || !this.loadedBy[k]) this.load(true)
    },

    load(reset) {
      const self = this
      const kind = this.tab
      const g = ++this.gen
      this.loading = true
      if (reset) {
        this.status = ''
        if (kind === 'im') this.sessions = []
        else { this.itemsBy[kind] = []; this.cursorBy[kind] = null; this.moreBy[kind] = false }
      }
      afterPaint(function () {
        // 未读计数与列表并行拉; 计数失败不挡列表
        getMsgUnread().then(function (u) {
          if (g !== self.gen) return
          self.unread = u
        }).catch(function () {})

        const task = kind === 'im'
          ? getSessions().then(function (list) {
              if (g !== self.gen) return
              self.sessions = list
              self.loadedBy.im = true
            })
          : getMsgList(kind, reset ? null : self.cursorBy[kind]).then(function (r) {
              if (g !== self.gen || !r) return
              const have = self.itemsBy[kind] || []
              const seen = {}
              for (let i = 0; i < have.length; i++) seen[have[i].id] = 1
              const add = []
              for (let i = 0; i < r.items.length; i++) {
                if (!seen[r.items[i].id]) { add.push(r.items[i]); seen[r.items[i].id] = 1 }
              }
              self.itemsBy[kind] = have.concat(add)   // 只追加, 不重复
              self.cursorBy[kind] = r.cursor
              self.moreBy[kind] = !!r.hasMore
              self.loadedBy[kind] = true
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
      if (this.loading || this.tab === 'im') return
      if (!this.moreBy[this.tab]) return
      this.load(false)
    },

    openChat(c) {
      if (!c || !c.talkerId) return
      try { $falcon.navTo('chat', { talkerId: String(c.talkerId), name: c.name, face: c.face }) } catch (e) {}
    },
    open(it) {
      // 回复所在稿件: business_id=1 是视频评论, 有 uri 就能跳; 只有能解析出 bvid 才跳详情页
      const m = /BV[0-9A-Za-z]{10}/.exec(String(it.uri || ''))
      if (!m) return
      try { $falcon.navTo(nextDetailName(), { bvid: m[0], title: it.title }) } catch (e) {}
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
.tab { width: 116px; height: 32px; margin-right: 8px; justify-content: center; align-items: center; }
.stbox { width: 100%; height: 60px; flex-direction: row; justify-content: center; align-items: center; }
.stbox-hit { width: 100%; height: 44px; flex-direction: row; justify-content: center; align-items: center; margin-top: 12px; }
.list { width: 100%; flex: 1; }
.row { width: 100%; flex-direction: row; padding-left: 16px; padding-right: 16px; padding-top: 8px; padding-bottom: 8px; margin-top: 6px; }
.face { width: 48px; height: 48px; border-radius: 24px; margin-right: 12px; }
.face-ph { width: 48px; height: 48px; border-radius: 24px; margin-right: 12px; justify-content: center; align-items: center; }
.rmain { flex: 1; flex-direction: column; }
.rtitle { margin-top: 4px; }
.rcont { margin-top: 4px; lines: 2; text-overflow: ellipsis; overflow: hidden; }
.rtime { margin-top: 6px; }
.empty2 { width: 100%; text-align: center; margin-top: 28px; }
.more { width: 100%; height: 40px; flex-direction: row; justify-content: center; align-items: center; margin-top: 8px; margin-bottom: 12px; }
.list-anchor { width: 1px; height: 1px; }
</style>
