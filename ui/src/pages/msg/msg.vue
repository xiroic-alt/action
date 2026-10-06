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
      <div class="cta" :style="T.accentR" @click="goLogin"><text class="ctat" :style="T.t.onAccentTitle">去登录</text></div>
    </div>

    <div v-else class="listwrap">
      <div class="stat" :style="T.cardR">
        <div class="scell"><text class="snum" :style="T.t.title">{{ unread.reply }}</text><text class="slab" :style="T.t.label">回复</text></div>
        <div class="scell"><text class="snum" :style="T.t.title">{{ unread.at }}</text><text class="slab" :style="T.t.label">@我</text></div>
        <div class="scell"><text class="snum" :style="T.t.title">{{ unread.like }}</text><text class="slab" :style="T.t.label">赞</text></div>
        <div class="scell"><text class="snum" :style="T.t.title">{{ unread.sys }}</text><text class="slab" :style="T.t.label">系统</text></div>
      </div>
      <text v-if="loading" class="st" :style="T.t.titleVar">加载中…</text>
      <text v-else-if="status !== ''" class="st" :style="T.t.err">{{ status }}</text>
      <scroller v-else class="list" scroll-direction="vertical" :show-scrollbar="true"
                :loadmoreoffset="100" @loadmore="loadMore">
        <div v-for="it in items" :key="it.id" class="row" :style="T.cardR" @click="open(it)">
          <div class="rmain">
            <text class="rwho" :style="T.t.accentSm">{{ it.uname }}</text>
            <text class="rtitle" :style="T.t.labelOn">{{ it.title }}</text>
            <text class="rcont" :style="T.t.caption">{{ it.content }}</text>
            <text class="rtime" :style="T.t.tiny">{{ fmtTime(it.time) }}</text>
          </div>
        </div>
        <text v-if="items.length === 0" class="empty2" :style="T.t.empty">还没有新的回复</text>
        <text v-if="hasMore" class="more" :style="T.t.accentSub" @click="loadMore">上滑加载更多…</text>
      </scroller>
    </div>
  </div>
</template>

<script>
// 消息中心 —— PenBili 里没有这个模块 (研究结论: 仓库内零代码), 这里按其研究给出的
// 官方接口面自行实现. 读取类接口**不需要 csrf**, 只需要 SESSDATA (登录态).
//   GET /x/msgfeed/unread        未读计数 (回复/@我/赞/系统/UP)
//   GET /x/msgfeed/reply         回复我的 (游标 id + reply_time)
// 无登录态一律 code=-101, 所以未登录时只给登录入口, 不做无意义的重试.
import { getMsgUnread, getMsgReplies } from '../../services/bili.js'
import { tokens } from '../../services/theme.js'
import { hasCookie } from '../../services/auth.js'
import { afterPaint } from '../../base-page.js'
import { logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

export default {
  name: 'msg',
  data() {
    return {
      T: tokens(),
      logged: false,
      unread: { reply: 0, at: 0, like: 0, sys: 0, total: 0 },
      items: [],
      cursor: null,
      hasMore: false,
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
    onUnload() { this.gen++ },

    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('settings') } catch (e2) {} } },
    goLogin() { try { $falcon.navTo('login', {}) } catch (e) {} },

    fmtTime(sec) {
      if (!sec) return ''
      const d = new Date(Number(sec) * 1000)
      function p(n) { return n < 10 ? '0' + n : '' + n }
      return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    },

    load(reset) {
      const self = this
      const g = ++this.gen
      this.loading = reset === true
      if (reset) { this.items = []; this.cursor = null }
      this.status = ''
      afterPaint(function () {
        getMsgUnread().then(function (u) {
          if (g !== self.gen) return
          self.unread = u
        }).catch(function (e) {
          if (g !== self.gen) return
          self.status = (e && e.message ? e.message : String(e)).substring(0, 60)
        }).then(function () {
          if (g !== self.gen) return
          const cur = reset === true ? null : self.cursor
          return getMsgReplies(cur ? cur.id : '', cur ? cur.time : '')
        }).then(function (r) {
          if (!r || g !== self.gen) return
          const seen = {}
          for (let i = 0; i < self.items.length; i++) seen[self.items[i].id] = 1
          for (let i = 0; i < r.items.length; i++) {
            if (!seen[r.items[i].id]) self.items.push(r.items[i])
          }
          self.cursor = r.cursor
          self.hasMore = !!(r.cursor && !r.cursor.is_end)
          self.loading = false
        }).catch(function (e) {
          if (g !== self.gen) return
          self.loading = false
          if (self.status === '') self.status = (e && e.message ? e.message : String(e)).substring(0, 60)
          logError('消息', '加载失败: ' + (e && e.message ? e.message : e))
        })
      })
    },
    loadMore() {
      if (!this.hasMore || this.loading) return
      this.load(false)
    },
    open(it) {
      // 回复所在稿件: business_id=1 是视频评论, 有 uri 就能跳; 这里保守处理 ——
      // 只有能解析出 bvid 才跳详情页, 否则只提示.
      const m = /BV[0-9A-Za-z]{10}/.exec(String(it.uri || ''))
      if (!m) { return }
      try { $falcon.navTo('page', { bvid: m[0], title: it.title }) } catch (e) {}
    }
  }
}
</script>

<style scoped>
.page { width: 960px; height: 266px; flex-direction: column; }
.topbar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { flex-direction: row; align-items: center; height: 40px; width: 132px; margin-left: 12px; justify-content: center; }
.bac { margin-right: 4px; }
.ttl { margin-left: 12px; flex: 1; }
.sum { margin-right: 16px; }
.empty { width: 100%; flex: 1; flex-direction: column; align-items: center; justify-content: center; }
.et { }
.cta { margin-top: 16px; padding-left: 32px; padding-right: 32px; height: 44px; justify-content: center; align-items: center; }
.ctat { }
.listwrap { width: 100%; flex: 1; flex-direction: column; }
.stat { width: 100%; flex-direction: row; margin-top: 8px; margin-bottom: 4px; padding-top: 8px; padding-bottom: 8px; }
.scell { flex: 1; flex-direction: column; align-items: center; }
.slab { margin-top: 2px; }
.st { width: 100%; text-align: center; margin-top: 20px; }
.list { width: 100%; flex: 1; }
.row { width: 100%; margin-top: 8px; padding-left: 16px; padding-right: 16px; padding-top: 8px; padding-bottom: 8px; }
.rmain { flex-direction: column; }
.rwho { }
.rtitle { margin-top: 4px; }
.rcont { margin-top: 4px; lines: 2; text-overflow: ellipsis; overflow: hidden; }
.rtime { margin-top: 6px; }
.empty2 { width: 100%; text-align: center; margin-top: 28px; }
.more { width: 100%; text-align: center; margin-top: 10px; margin-bottom: 16px; }
</style>
