<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="back-ic" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="back-t" :style="T.t.body">返回</text>
      </div>
      <text class="ttl" :style="T.t.title">{{ info.title !== '' ? info.title : '直播间' }}</text>
      <div class="live-tag" :style="info.live ? T.accentR : T.actionR">
        <text :style="info.live ? T.t.onAccent : T.t.label">{{ info.liveText }}</text>
      </div>
    </div>

    <div class="body">
      <div class="left" :style="T.cardR">
        <div class="cover-wrap" :style="{ backgroundColor: T.c.surfaceContainerLow }">
          <image v-if="info.cover !== ''" class="cover" :src="info.cover" resize="cover"></image>
          <text v-else class="cover-ph" :style="T.t.empty">暂无封面</text>
        </div>
        <div class="up-row">
          <image v-if="info.face !== ''" class="up-face" :src="info.face" resize="cover"></image>
          <div v-else class="up-face-ph" :style="T.accentR">
            <text class="up-face-t" :style="T.t.onAccent">{{ info.up !== '' ? info.up.charAt(0) : '直' }}</text>
          </div>
          <text class="up-name" :style="T.t.accentSub">{{ info.up !== '' ? info.up : '未知主播' }}</text>
        </div>
        <text class="metaline" :style="T.t.caption">{{ areaText }}</text>
        <text class="metaline" :style="T.t.caption">{{ onlineText2 }}</text>
      </div>

      <div class="right">
        <text class="sec" :style="T.t.label">弹幕</text>
        <scroller class="dms" scroll-direction="vertical" :show-scrollbar="true">
          <div v-for="(d, i) in danmus" :key="d.id + '_' + i" class="dm" :style="T.cardR">
            <text class="dm-t" :style="T.t.caption"><text :style="T.t.accentSub">{{ d.nick }}</text> {{ d.text }}</text>
          </div>
          <text v-if="danmus.length === 0" class="dm-empty" :style="T.t.empty">{{ streamHint }}</text>
        </scroller>
      </div>
    </div>

    <div class="actions">
      <div class="act" :style="T.accentR" @click="play">
        <text :style="T.t.onAccent">{{ info.live ? '用播放器观看' : '试播' }}</text>
      </div>
      <div class="act" :style="T.actionR" @click="reload">
        <text :style="T.t.body">刷新</text>
      </div>
      <text v-if="status !== ''" class="status" :style="T.t.err">{{ status }}</text>
    </div>
  </div>
</template>

<script>
// 直播间详情页 (独立于列表页): 房间信息 + 弹幕预览 + 交给统一播放器播放.
// 取流/播放一律不在这里做 —— 播放页负责管线与重连, 这里只管信息与跳转.
import { getRoomInfo, onlineText } from '../../services/live.js'
import { tokens } from '../../services/theme.js'
import { afterPaint } from '../../base-page.js'
import { log, logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

export default {
  name: 'room',
  data() {
    return {
      T: tokens(),
      roomid: 0,
      info: { roomid: 0, title: '', cover: '', up: '', face: '', area: '', online: 0, watched: 0, live: false, liveText: '加载中' },
      status: '',
      gen: 0,
      loaded: false
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D },
    areaText() {
      const a = this.info.area
      const p = this.info.parentArea
      if (a === '' && p === '') return '分区未知'
      return '分区 ' + (p !== '' ? p + ' · ' : '') + a
    },
    onlineText2() {
      return '人气 ' + onlineText(this.info.online) + ' · 看过 ' + onlineText(this.info.watched)
    },
    streamHint() {
      if (!this.loaded) return '加载中…'
      return this.info.live ? '暂时没有弹幕' : '未开播, 没有实时弹幕'
    }
  },
  methods: {
    onShow() {
      this.T = tokens()
      if (this.$page && !this._newOptionsBound) {
        this._newOptionsBound = true
        const self = this
        this.$page.onNewOptions = function (o) { self.pending = o; self.begin(o) }
      }
      if (!this._started) { this._started = true; this.begin(this.$page ? this.$page.options : {}) }
    },
    onHide() { this.gen++ },
    onUnload() { this.gen++ },

    begin(options) {
      const o = options || {}
      const rid = parseInt(o.roomid || '0', 10)
      if (!rid) { this.status = '缺少直播间号'; return }
      if (rid === this.roomid && this.loaded) return
      this.roomid = rid
      this.loaded = false
      this.status = ''
      this.load()
    },
    reload() { this.loaded = false; this.status = ''; this.load() },

    load() {
      const self = this
      const g = ++this.gen
      if (!this.roomid) return
      afterPaint(function () {
        getRoomInfo(self.roomid).then(function (info) {
          if (g !== self.gen) return
          self.info = info
          self.loaded = true
          try { log('直播间', '进入 ' + info.roomid + ' ' + info.liveText) } catch (e) {}
        }).catch(function (e) {
          if (g !== self.gen) return
          self.loaded = true
          self.status = (e && e.message ? e.message : String(e)).substring(0, 60)
          logError('直播间', '信息失败: ' + self.status)
        })
      })
    },

    // 交给统一播放器: mode=live 让播放页走直播分支 (无进度条/无续播/有限重连)
    play() {
      if (!this.roomid) return
      try {
        $falcon.navTo('player', { mode: 'live', roomid: String(this.roomid), title: this.info.title })
      } catch (e) {
        this.status = '打开播放器失败'
        logError('直播间', 'navTo player 失败: ' + e)
      }
    },
    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('live', {}) } catch (e2) {} } }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
.topbar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { width: 132px; height: 40px; margin-left: 12px; flex-direction: row; justify-content: center; align-items: center; }
.back-ic { margin-right: 4px; }
.ttl { flex: 1; margin-left: 12px; lines: 1; text-overflow: ellipsis; overflow: hidden; }
.live-tag { width: 108px; height: 36px; margin-right: 16px; justify-content: center; align-items: center; }
.body { width: 960px; flex: 1; flex-direction: row; }
.left { width: 440px; margin-left: 16px; margin-top: 8px; padding: 10px; flex-direction: column; }
.cover-wrap { width: 420px; height: 118px; justify-content: center; align-items: center; }
.cover { width: 420px; height: 118px; }
.up-row { width: 420px; height: 40px; flex-direction: row; align-items: center; margin-top: 8px; }
.up-face { width: 36px; height: 36px; border-radius: 18px; margin-right: 10px; }
.up-face-ph { width: 36px; height: 36px; border-radius: 18px; margin-right: 10px; justify-content: center; align-items: center; }
.up-face-t { font-size: 20px; }
.up-name { margin-left: 8px; }
.metaline { margin-top: 4px; }
.right { flex: 1; flex-direction: column; margin-left: 12px; margin-right: 16px; margin-top: 8px; }
.sec { margin-bottom: 4px; }
.dms { width: 100%; flex: 1; }
.dm { padding-left: 10px; padding-right: 10px; padding-top: 4px; padding-bottom: 4px; margin-bottom: 4px; }
.dm-t { }
.dm-empty { margin-top: 20px; text-align: center; }
.actions { width: 960px; height: 48px; flex-direction: row; align-items: center; }
.act { width: 180px; height: 40px; margin-left: 16px; margin-right: 8px; justify-content: center; align-items: center; }
.status { margin-left: 16px; flex: 1; }
</style>
