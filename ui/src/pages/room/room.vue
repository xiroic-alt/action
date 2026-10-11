<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="back-ic" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="back-t" :style="T.t.body">返回</text>
      </div>
      <text class="ttl" :style="T.t.title">{{ info.title !== '' ? info.title : '直播间' }}</text>
      <div class="live-tag" :style="info.live ? T.accentR : T.actionR">
        <text :style="info.live ? T.t.onAccent : T.t.label">{{ loaded ? info.liveText : '加载中' }}</text>
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
        <text class="metaline" :style="T.t.caption">{{ noticeText }}</text>
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
        <text :style="T.t.onAccent">{{ playText }}</text>
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
// 职责边界 (为什么这样切):
//   - 取流/管线/重连一律在 pages/player 的直播分支做, 本页不碰 <video>/<hole> ——
//     列表页原来内嵌自播, 与播放页各维护一套管线, 行为必然漂移 (已删).
//   - 信息接口 xlive/web-room/v1/index/getInfoByRoom, 归一化与兜底见 services/live.js;
//   - 弹幕走 bili.js 的 getLiveDanmaku (降级方案, 见那里的实测说明): 每 8s 轮询最近 10 条,
//     交给 services/live.js 的去重器过滤; 未开播时没有轮询意义, 直接停掉.
import { getRoomInfo, getLiveDanmaku, createDanmakuFilter, onlineText } from '../../services/live.js'
import { tokens } from '../../services/theme.js'
import { afterPaint } from '../../base-page.js'
import { log, logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

const DM_INTERVAL_MS = 8000   // 弹幕轮询周期 (接口每轮只给最近 10 条)
const DM_KEEP = 8             // 页面上最多留几条

export default {
  name: 'room',
  data() {
    return {
      T: tokens(),
      roomid: 0,
      info: {
        roomid: 0, shortId: 0, title: '', cover: '', up: '', face: '',
        area: '', parentArea: '', online: 0, watched: 0,
        liveStatus: -1, liveText: '加载中', live: false, notice: ''
      },
      danmus: [],
      status: '',
      gen: 0,
      loaded: false,
      dmTimer: null
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D },
    areaText() {
      if (!this.loaded) return '分区加载中…'
      const a = this.info.area
      const p = this.info.parentArea
      if (a === '' && p === '') return '分区未知'
      return '分区 ' + (p !== '' ? p + ' · ' : '') + a
    },
    onlineText2() {
      if (!this.loaded) return '人气加载中…'
      return '人气 ' + onlineText(this.info.online) + ' · 看过 ' + onlineText(this.info.watched)
    },
    noticeText() {
      if (!this.loaded) return '公告加载中…'
      return this.info.notice !== '' ? ('公告 ' + this.info.notice) : '公告 无'
    },
    streamHint() {
      if (!this.loaded) return '加载中…'
      if (this.info.liveStatus === 1) return '暂时没有弹幕'
      if (this.info.liveStatus === 0) return '主播未开播 —— 没有实时弹幕, 点「刷新」重试'
      if (this.info.liveStatus === 2) return '轮播中, 没有实时弹幕'
      return '状态未知, 点「刷新」重试'
    },
    playText() { return this.loaded && this.info.live ? '用播放器播放' : '试播' }
  },
  methods: {
    // 生命周期必须写在 methods 里 (0.9.61 事故: 挂到组件根级永不触发)
    onShow() {
      this.T = tokens()
      if (this.$page && !this._newOptionsBound) {
        this._newOptionsBound = true
        const self = this
        // 同页 navTo 的 onNewOptions 只发到 Page 实例, 需显式挂钩到组件 (与 player 同一做法)
        this.$page.onNewOptions = function (o) { self.begin(o) }
      }
      if (!this._started) { this._started = true; this.begin((this.$page && this.$page.options) || {}) }
    },
    onHide() { this.stopDanmaku() },
    onUnload() { this.stopDanmaku(); this.gen++ },

    tip(m) {
      const self = this
      this.status = m
      if (this.statusTimer) clearTimeout(this.statusTimer)
      this.statusTimer = setTimeout(function () { self.status = '' }, 4000)
    },

    begin(options) {
      const o = options || {}
      const rid = parseInt(o.roomid || '0', 10)
      this.stopDanmaku()
      this.danmus = []
      if (!rid) { this.status = '缺少直播间号'; this.loaded = true; return }
      if (rid === this.roomid && this.loaded) return
      this.roomid = rid
      this.loaded = false
      this.status = ''
      this.load()
    },
    reload() {
      if (!this.roomid) { this.status = '缺少直播间号'; return }
      this.stopDanmaku()
      this.danmus = []
      this.loaded = false
      this.status = ''
      this.load()
    },

    // 房间信息: 失败给可重试提示 + 状态行, 不留空白
    load() {
      const self = this
      const g = ++this.gen
      if (!this.roomid) return
      afterPaint(function () {
        getRoomInfo(self.roomid).then(function (info) {
          if (g !== self.gen) return
          self.info = info
          self.loaded = true
          self.status = ''
          try { log('直播间', '进入 ' + info.roomid + ' ' + info.liveText) } catch (e) {}
          if (info.live) self.startDanmaku()
        }).catch(function (e) {
          if (g !== self.gen) return
          self.loaded = true
          self.status = (self.status === '' ? '房间信息获取失败, 可点刷新重试' : self.status)
          logError('直播间', '信息失败: ' + (e && e.message ? e.message : e))
          // 取不到房间信息也照轮询弹幕: gethistory 不依赖房间信息, 网络问题恢复后能自愈
          self.startDanmaku()
        })
      })
    },

    // ---------- 弹幕: 8s 轮询 + 去重 ----------
    startDanmaku() {
      this.stopDanmaku()
      const self = this
      const pick = createDanmakuFilter(400)
      let first = true
      function tick() {
        if (!self.roomid) return
        getLiveDanmaku(self.roomid).then(function (list) {
          if (!self.roomid || self.dmTimer === null) return
          const add = pick(list)
          if (first) { first = false; return }   // 首轮只建索引, 不刷屏
          if (!add.length) return
          const next = self.danmus.concat(add)
          self.danmus = next.length > DM_KEEP ? next.slice(next.length - DM_KEEP) : next
        }).catch(function (e) {
          logError('直播间', '弹幕失败: ' + (e && e.message ? e.message : e))
        })
      }
      tick()
      this.dmTimer = setInterval(tick, DM_INTERVAL_MS)
    },
    stopDanmaku() {
      if (this.dmTimer) { clearInterval(this.dmTimer); this.dmTimer = null }
      if (this.statusTimer) { clearTimeout(this.statusTimer); this.statusTimer = null }
    },

    // 交给统一播放器: mode=live 让播放页走直播分支 (无进度条/无续播/有限重连)
    play() {
      if (!this.roomid) { this.status = '缺少直播间号'; return }
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
.cover-wrap { width: 420px; height: 112px; justify-content: center; align-items: center; overflow: hidden; }
.cover { width: 420px; height: 112px; }
.up-row { width: 420px; height: 36px; flex-direction: row; align-items: center; margin-top: 6px; }
.up-face { width: 34px; height: 34px; border-radius: 17px; margin-right: 10px; }
.up-face-ph { width: 34px; height: 34px; border-radius: 17px; margin-right: 10px; justify-content: center; align-items: center; }
.up-face-t { font-size: 20px; }
.up-name { margin-left: 8px; }
/* 公告/分区/人气三行都要能截断, 否则长公告会把动作栏顶出屏 (266px 屏) */
.metaline { margin-top: 4px; lines: 1; text-overflow: ellipsis; overflow: hidden; }
.right { flex: 1; flex-direction: column; margin-left: 12px; margin-right: 16px; margin-top: 8px; }
.sec { margin-bottom: 4px; }
.dms { width: 100%; flex: 1; }
.dm { padding-left: 10px; padding-right: 10px; padding-top: 4px; padding-bottom: 4px; margin-bottom: 4px; }
.dm-t { }
.dm-empty { margin-top: 20px; text-align: center; }
.actions { width: 960px; height: 48px; flex-direction: row; align-items: center; }
.act { width: 180px; height: 40px; margin-left: 16px; margin-right: 8px; justify-content: center; align-items: center; }
.status { margin-left: 16px; flex: 1; lines: 1; text-overflow: ellipsis; overflow: hidden; }
</style>
