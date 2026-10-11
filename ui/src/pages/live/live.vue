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

    <div class="listwrap">
      <div class="searchbar">
        <div class="sinput" :style="T.insetR" @click="openKeyboard">
          <text class="stext" :style="T.t.body">{{ keyword || '搜索直播间' }}</text>
        </div>
        <div class="sbtn" :style="T.accentPill" @click="doSearch"><text :style="T.t.onAccent">搜索</text></div>
      </div>
      <text v-if="loading" class="st2" :style="T.t.titleVar">加载中…</text>
      <scroller v-else class="list" scroll-direction="vertical" :show-scrollbar="true" @scroll="onReturnScroll($event, 'liveTop')">
        <div ref="liveTop" class="list-anchor"></div>
        <text class="sec" :style="T.t.label">热门分区</text>
        <div class="chips">
          <div v-for="a in hotAreas" :key="'a' + a" class="chip" :style="T.insetR" @click="quickSearch(a)">
            <text :style="T.t.label">{{ a }}</text>
          </div>
        </div>
        <text class="sec" :style="T.t.label">{{ rooms.length > 0 ? '搜索结果 (' + rooms.length + ')' : '点上面的分区或搜索' }}</text>
        <div v-for="r in rooms" :key="r.roomid" class="row" :style="T.cardR" @click="openRoom(r)">
          <image class="rcov" :src="r.cover" resize="cover" :style="{ width: '128px', height: '80px' }"></image>
          <div class="rmain">
            <text class="rtitle" :style="T.t.title">{{ r.title }}</text>
            <text class="rup" :style="T.t.accentSub">{{ r.up }} · {{ r.area }}</text>
            <text class="ron" :style="T.t.label">{{ onlineFmt(r.online) }} 人气</text>
          </div>
        </div>
        <text v-if="searched && rooms.length === 0 && !loading" class="dm-empty" :style="T.t.empty">没有找到正在直播的房间</text>
      </scroller>
    </div>
    <BackTop :visible="topShown" :T="T" @activate="goTop" />
  </div>
</template>

<script>
// 直播列表页 —— 只负责「搜索 + 选房」. 播放本身一律交给 pages/player 的直播分支,
// 独立直播间信息交给 pages/room: 之前这里是自播 (内嵌 video 元素 + 挖洞), 与播放页
// 各自维护一套管线/重连, 行为必然漂移 —— 现在三页职责单一.
//   - 搜索走 WBI 签名的 wbi/search/type?search_type=live (见 services/bili.js);
//   - 点房间 -> navTo('room'), 由 room 页「用播放器观看」再进播放页.
import { searchLive } from '../../services/bili.js'
import { onlineText } from '../../services/live.js'
import { tokens } from '../../services/theme.js'
import { createIME } from '../../services/ime.js'
import { afterPaint } from '../../base-page.js'
import { scrollTopMixin } from '../../services/scroll-top.js'
import BackTop from '../../components/back-top.vue'
import { logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

export default {
  name: 'live',
  components: { BackTop },
  mixins: [scrollTopMixin],
  data() {
    return {
      T: tokens(),
      keyword: '',
      rooms: [],
      searched: false,
      hotAreas: ['英雄联盟', '王者荣耀', '原神', '明日方舟', 'CS2', 'DOTA2'],
      loading: false,
      status: '',
      gen: 0
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D }
  },
  mounted() { this.ime = createIME() },
  methods: {
    onShow() { this.T = tokens() },
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
      const self = this
      const g = ++this.gen
      this.loading = true
      afterPaint(function () {
        searchLive(kw, 1).then(function (list) {
          if (g !== self.gen) return
          self.rooms = list
          self.searched = true
          self.loading = false
          self.topTarget = 'liveTop'
          self.goTop()
          self.tip(list.length ? ('找到 ' + list.length + ' 个直播间') : '没有正在直播的房间')
        }).catch(function (e) {
          if (g !== self.gen) return
          self.loading = false
          self.searched = true
          self.rooms = []
          self.tip((e && e.message ? e.message : String(e)).substring(0, 60))
        })
      })
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
.listwrap { width: 100%; flex: 1; flex-direction: column; }
.searchbar { width: 100%; height: 46px; flex-direction: row; align-items: center; }
.sinput { flex: 1; height: 38px; margin-left: 16px; justify-content: center; }
.stext { margin-left: 16px; }
.sbtn { width: 96px; height: 38px; margin-left: 10px; margin-right: 16px; justify-content: center; align-items: center; }
.st2 { width: 100%; text-align: center; margin-top: 20px; }
.list { width: 100%; flex: 1; }
.sec { margin-left: 20px; margin-top: 8px; margin-bottom: 4px; }
.chips { flex-direction: row; margin-left: 20px; flex-wrap: wrap; }
/* ★ 可点元素必须有显式尺寸: 本机只挂 padding 的 div 命中区是 0 */
.chip { height: 32px; padding-left: 12px; padding-right: 12px; margin-right: 8px; margin-bottom: 6px;
        flex-direction: row; align-items: center; }
.row { width: 100%; flex-direction: row; margin-left: 20px; margin-right: 20px; margin-top: 8px; padding-left: 8px; padding-top: 8px; padding-bottom: 8px; }
.rcov { border-radius: 8px; margin-right: 12px; }
.rmain { flex: 1; flex-direction: column; }
.rup { margin-top: 4px; }
.ron { margin-top: 6px; }
.dm-empty { width: 100%; text-align: center; margin-top: 20px; }
.list-anchor { width: 1px; height: 1px; }
</style>