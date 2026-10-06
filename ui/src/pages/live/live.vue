<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="bac" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="bat" :style="T.t.body">返回</text>
      </div>
      <text class="ttl" :style="T.t.title">{{ playing ? ('直播 · ' + room.title) : '直播' }}</text>
      <text v-if="status !== ''" class="st" :style="T.t.accentSm">{{ status }}</text>
    </div>

    <!-- 播放态: 框架内置 <video> 把 waylandsink 做成宿主主 surface 的 subsurface,
         <hole> 在同一矩形挖洞 (与 pages/player 同一套做法, HANDOVER §27) -->
    <div v-if="playing" class="stage">
      <video ref="vv" class="vsurf" :style="vrectStyle" :src="src"
             @state="onState" @error="onError"></video>
      <hole class="hole" :style="vrectStyle"></hole>
      <div class="bar" :style="T.bar">
        <text class="barl" :style="T.t.labelOn">{{ room.up }} · {{ room.area }}</text>
        <text class="barr" :style="T.t.accentSm">{{ onlineText }}</text>
      </div>
      <div class="dms">
        <div v-for="(d, i) in danmus" :key="d.id + '_' + i" class="dm" :style="T.cardR">
          <text class="dmt" :style="T.t.caption"><text :style="T.t.accentSm">{{ d.nick }}</text> {{ d.text }}</text>
        </div>
      </div>
      <div class="pctl">
        <div class="pbtn" :style="T.accentR" @click="stopPlay"><text class="pbt" :style="T.t.onAccent">停止</text></div>
        <div class="pbtn" :style="T.actionR" @click="reloadRoom"><text class="pbt" :style="T.t.labelOn">重连</text></div>
      </div>
    </div>

    <!-- 列表态: 关键词搜索直播间 (WBI 签名口, 见 services/bili.js 的实测说明) -->
    <div v-else class="listwrap">
      <div class="searchbar">
        <div class="sinput" :style="T.insetR" @click="openKeyboard">
          <text class="stext" :style="T.t.body">{{ keyword || '搜索直播间' }}</text>
        </div>
        <div class="sbtn" :style="T.accentPill" @click="doSearch"><text class="sbt" :style="T.t.onAccent">搜索</text></div>
      </div>
      <text v-if="loading" class="st2" :style="T.t.titleVar">加载中…</text>
      <scroller v-else class="list" scroll-direction="vertical" :show-scrollbar="true">
        <text class="sec" :style="T.t.label">热门分区</text>
        <div class="chips">
          <div v-for="a in hotAreas" :key="'a' + a" class="chip" :style="T.insetR" @click="quickSearch(a)">
            <text class="chipt" :style="T.t.label">{{ a }}</text>
          </div>
        </div>
        <text class="sec" :style="T.t.label">{{ rooms.length > 0 ? '搜索结果 (' + rooms.length + ')' : '点上面的分区或搜索' }}</text>
        <div v-for="r in rooms" :key="r.roomid" class="row" :style="T.cardR" @click="openRoom(r)">
          <image class="rcov" :src="r.cover" resize="cover" :style="{ width: '128px', height: '80px' }"></image>
          <div class="rmain">
            <text class="rtitle" :style="T.t.title">{{ r.title }}</text>
            <text class="rup" :style="T.t.accentSm">{{ r.up }} · {{ r.area }}</text>
            <text class="ron" :style="T.t.label">{{ onlineFmt(r.online) }} 人气</text>
          </div>
        </div>
      </scroller>
    </div>
  </div>
</template>

<script>
// 直播页 —— 参考 56dz/PenBili 的直播模块, 但接口按本机实测重选 (见 services/bili.js):
//   - 搜索走 WBI 签名的 wbi/search/type?search_type=live (不带签名会被风控挡成 HTML,
//     second/getList 直接 -352);
//   - 取流走 getRoomPlayInfo (匿名可用, 只需 UA), 优先 HLS/avc, 退回 FLV/avc;
//   - 弹幕只能做降级版: WebSocket 全量方案在 QuickJS 上不可行 (无 ws + zlib/brotli 解包),
//     用 /dM/gethistory 每 8s 拉最近 10 条去重滚动 —— 密集房间会丢弹幕, 这是已知上限.
import { bilinet } from 'bilinet'
import { searchLive, getLiveRoomPlayUrl, getLiveDanmaku } from '../../services/bili.js'
import { tokens } from '../../services/theme.js'
import { createIME } from '../../services/ime.js'
import { afterPaint } from '../../base-page.js'
import { log, logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

const DM_KEEP = 6

export default {
  name: 'live',
  data() {
    return {
      T: tokens(),
      keyword: '',
      rooms: [],
      hotAreas: ['英雄联盟', '王者荣耀', '原神', '明日方舟', 'CS2', 'DOTA2'],
      loading: false,
      status: '',
      gen: 0,
      // 播放态
      playing: false,
      room: { roomid: 0, title: '', up: '', area: '' },
      src: '',
      vrect: { x: 0, y: 0, w: 960, h: 222 },   // 相对 .stage (见样式注释)
      online: 0,
      danmus: [],
      dmTimer: null,
      reconnectAt: 0
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D },
    vrectStyle() {
      const r = this.vrect
      return { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }
    },
    onlineText() { return this.onlineFmt(this.online) + ' 人气' }
  },
  mounted() { this.ime = createIME() },
  methods: {
    onShow() { this.T = tokens() },
    onHide() { this.pause() },
    onUnload() {
      this.gen++
      this.stopDanmaku()
      this.playing = false
      if (this.ime) { this.ime.destroy(); this.ime = null }
    },

    goBack() {
      if (this.playing) { this.stopPlay(); return }
      try { this.$page.finish() } catch (e) { try { $falcon.navTo('settings') } catch (e2) {} }
    },
    tip(m) {
      const self = this
      this.status = m
      if (this.statusTimer) clearTimeout(this.statusTimer)
      this.statusTimer = setTimeout(function () { self.status = '' }, 3000)
    },
    onlineFmt(n) {
      const v = Number(n) || 0
      if (v >= 10000) return (v / 10000).toFixed(1) + '万'
      return String(v)
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
      const self = this
      const g = ++this.gen
      this.loading = true
      afterPaint(function () {
        searchLive(kw, 1).then(function (list) {
          if (g !== self.gen) return
          self.rooms = list
          self.loading = false
          self.tip(list.length ? ('找到 ' + list.length + ' 个直播间') : '没有正在直播的房间')
        }).catch(function (e) {
          if (g !== self.gen) return
          self.loading = false
          self.rooms = []
          self.tip((e && e.message ? e.message : String(e)).substring(0, 60))
        })
      })
    },

    // ---------- 播放 ----------
    openRoom(r) {
      const self = this
      const g = ++this.gen
      this.room = r
      this.danmus = []
      this.status = '连接中…'
      this.playing = true
      afterPaint(function () {
        getLiveRoomPlayUrl(r.roomid).then(function (p) {
          if (g !== self.gen) return
          self.src = p.url
          self.status = ''
          self.startDanmaku(r.roomid)
          setTimeout(function () { if (g === self.gen) self.elem('play', 0) }, 400)
        }).catch(function (e) {
          if (g !== self.gen) return
          logError('直播', '取流失败: ' + (e && e.message ? e.message : e))
          self.status = (e && e.message ? e.message : String(e)).substring(0, 40)
        })
      })
    },
    elem(name) {
      const v = this.$refs.vv
      if (!v || typeof v[name] !== 'function') return undefined
      try { return v[name].apply(v, Array.prototype.slice.call(arguments, 1)) } catch (e) { return undefined }
    },
    pause() { this.elem('pause') },
    stopPlay() {
      this.gen++
      this.stopDanmaku()
      this.elem('stop')
      this.playing = false
      this.src = ''
      this.status = ''
    },
    reloadRoom() {
      if (!this.room.roomid) return
      const r = this.room
      this.stopPlay()
      this.openRoom(r)
    },

    // ---------- 事件 ----------
    onState(e) {
      const s = e && typeof e.state !== 'undefined' ? e.state : -1
      // 只认 4 = PLAYING: 直播没有暂停语义, 停住就是断流, 直接重连 (10s 节流)
      if (s === 4) {
        this.status = ''
        if (this.infoGot !== true) this.elem('resume')
        return
      }
      if (s === 1 || s === 2) {
        const now = Date.now()
        if (this.playing && now - this.reconnectAt > 10000) {
          this.reconnectAt = now
          log('直播', '管线回落 state=' + s + ', 尝试重连')
          this.reloadRoom()
        }
      }
    },
    onError(e) {
      let t = ''
      try { t = JSON.stringify(e) } catch (err) { t = String(e) }
      logError('直播', '元素错误 ' + t)
      this.status = ('播放错误: ' + t).substring(0, 44)
    },

    // ---------- 弹幕 (降级: 8s 轮询最近 10 条) ----------
    startDanmaku(roomid) {
      this.stopDanmaku()
      const self = this
      const seen = {}
      let first = true
      function tick() {
        if (!self.playing) return
        getLiveDanmaku(roomid).then(function (list) {
          if (!self.playing) return
          const add = []
          for (let i = 0; i < list.length; i++) {
            const d = list[i]
            if (seen[d.id]) continue
            seen[d.id] = 1
            add.push(d)
          }
          if (first) { first = false; add.length = 0 }   // 首轮只建索引, 不刷屏
          if (add.length) {
            const next = self.danmus.concat(add)
            self.danmus = next.length > DM_KEEP ? next.slice(next.length - DM_KEEP) : next
          }
        }).catch(function () {})
      }
      tick()
      this.dmTimer = setInterval(tick, 8000)
    },
    stopDanmaku() {
      if (this.dmTimer) { clearInterval(this.dmTimer); this.dmTimer = null }
    }
  }
}
</script>

<style scoped>
/* position: absolute 与 player.vue 一致 —— <video>/<hole> 都按 absolute 定位,
   需要一个已定位的祖先当坐标系; 不写的话会落到框架根上, 洞和画面就对不齐. */
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
.chip { padding-left: 12px; padding-right: 12px; padding-top: 5px; padding-bottom: 5px; margin-right: 8px; margin-bottom: 6px; }
.row { width: 100%; flex-direction: row; margin-left: 20px; margin-right: 20px; margin-top: 8px; padding-left: 8px; padding-top: 8px; padding-bottom: 8px; }
.rcov { border-radius: 8px; margin-right: 12px; }
.rmain { flex: 1; flex-direction: column; }
.rup { margin-top: 4px; }
.ron { margin-top: 6px; }
/* 播放舞台: 让开 44px 应用顶栏, 洞/画面的坐标以它为原点 (vrect 用 0,0,960,222) */
.stage { position: absolute; left: 0; top: 44px; width: 960px; height: 222px; }
.vsurf { position: absolute; }
.hole { position: absolute; }
.bar { position: absolute; left: 0; top: 0; width: 960px; height: 34px; flex-direction: row; align-items: center; padding-left: 16px; padding-right: 16px; }
.barl { flex: 1; }
.dms { position: absolute; left: 12px; top: 40px; width: 520px; flex-direction: column; }
.dm { padding-left: 10px; padding-right: 10px; padding-top: 3px; padding-bottom: 3px; margin-bottom: 4px; }
.dmt { }
.pctl { position: absolute; left: 812px; top: 40px; flex-direction: column; }
.pbtn { padding-left: 18px; padding-right: 18px; padding-top: 6px; padding-bottom: 6px; margin-bottom: 8px; justify-content: center; align-items: center; }
.pbt { }
</style>
