<template>
  <div class="page" :style="{ backgroundColor: '#000000' }">
    <!-- 视频面: 框架内置 <video>. 设备侧把 waylandsink 做成宿主主 surface 的 subsurface
         并 place_below —— 视频恒在 UI 之下, 所以 UI 元素天然压在画面上 (设备契约, 见 docs/device-contract.md)
         单位: position 事件 / info.duration 都是秒; play(sec)/seekto(sec) 也吃秒 -->
    <video ref="vv" class="vsurf" :style="vrectStyle" :src="src"
           @state="onState" @info="onInfo" @position="onPosition"
           @complete="onComplete" @error="onError" @bufferPercent="onBuffer"></video>
    <!-- 挖洞: 把视频矩形在 UI 面清成透明, 视频从下面透出 -->
    <hole class="hole" :style="vrectStyle"></hole>

    <!-- 弹幕层: 严格裁在视频矩形内 (笔屏 960x266 里画面只占中间一条) -->
    <div class="dm-layer" :style="vrectStyle">
      <text v-for="d in dmFrame" :key="d.k" class="dm"
            :style="{ left: d.x + 'px', top: d.y + 'px', color: d.color, fontSize: d.size + 'px', opacity: d.op }">{{ d.text }}</text>
    </div>

    <!-- 字幕层: 主字幕 + 副字幕 (PiliNara 双语字幕) -->
    <div v-if="subMain !== '' || subSecond !== ''" class="sub-layer" :style="subLayerStyle">
      <text v-if="subMain !== ''" class="sub" :style="subMainStyle">{{ subMain }}</text>
      <text v-if="subSecond !== ''" class="sub sub2" :style="subSecondStyle">{{ subSecond }}</text>
    </div>

    <!-- 触摸层: 点击切换控制条 (命中区铺满全屏, 有显式尺寸) -->
    <div class="stage" @click="toggleBar"></div>

    <!-- 顶部: 返回 + 标题 + 画质标签 (PiliNara 播放页: 返回在左, 标题紧随, 画质在右) -->
    <div v-if="barVisible" class="topbar">
      <div class="back" @click="goBack">
        <image class="bic" :src="MI.back" :style="{ width: '24px', height: '24px' }"></image>
        <text class="bt" :style="{ fontSize: U.f.body + 'px', color: '#ffffff' }">返回</text>
      </div>
      <text class="title" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: '#ffffff' }">{{ titleText }}</text>
      <text v-if="isLive" class="qt" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">直播</text>
      <text v-else-if="qualityText !== ''" class="qt" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">{{ qualityText }}</text>
    </div>

    <!-- 画质选择菜单 (PiliNara 播放设置抽屉的笔上等价: 竖排档位, 选中高亮) -->
    <div v-if="qualityMenu" class="qmenu">
      <div v-for="q in qualityList" :key="q.qn" class="qitem" :style="qitemStyle(q)"
           @click="chooseQuality(q.qn)">
        <text class="qit" :style="qitemTextStyle(q)">{{ q.label }}</text>
        <text v-if="q.qn === DEVICE_MAX_QN" class="qdev" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">设备上限</text>
      </div>
    </div>

    <!-- 音频提示 (切换结果/自动选择结果) -->
    <div v-if="audioMsg !== ''" class="atip">
      <text class="at" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: '#ffffff' }">{{ audioMsg }}</text>
    </div>

    <!-- 中央状态 -->
    <div v-if="statusText !== ''" class="center">
      <text class="st" :style="{ fontSize: U.f.body + 'px', color: '#ffffff' }">{{ statusText }}</text>
    </div>

    <!-- 底部控制条: 播放/暂停 + 快退/快进 + 进度条 + 时间 + 倍速 -->
    <div v-if="barVisible" class="ctrl">
      <div v-if="!isLive" class="cbtn" @click="seekBy(-10)">
        <image class="cic" :src="MI.back10" :style="{ width: '26px', height: '26px' }"></image>
      </div>
      <div class="cbtn cbtn-main" @click="togglePlay">
        <image class="cic" :src="playing ? MI.pause : MI.play" :style="{ width: '34px', height: '34px' }"></image>
      </div>
      <div v-if="!isLive" class="cbtn" @click="seekBy(10)">
        <image class="cic" :src="MI.fwd10" :style="{ width: '26px', height: '26px' }"></image>
      </div>
      <div v-if="!isLive" class="seek">
        <seekbar class="sbar"
                 min="0" :max="seekMax" step="1" :value="seekValue"
                 backgroundColor="rgba(255,255,255,0.20)" activeColor="#fb7299"
                 handleColor="#ffffff" trackSize="6" handleSize="14" borderRadius="3"
                 @changing="onSeekChanging" @change="onSeekChange"></seekbar>
      </div>
      <text v-if="isLive" class="time" :style="{ fontSize: U.f.caption + 'px', color: '#ffffff' }">已播 {{ liveElapsedText }}</text>
      <text v-else class="time" :style="{ fontSize: U.f.caption + 'px', color: '#ffffff' }">{{ curText }} / {{ durText }}</text>
      <div class="cbtn rate" @click="toggleAudioOut">
        <text class="ratet" :style="{ fontSize: U.f.caption + 'px', color: audioMode === 'bluetooth' ? U.c.primary : '#ffffff' }">{{ btLabel || '音频' }}</text>
      </div>
      <div v-if="!isLive" class="cbtn rate" @click="toggleQualityMenu">
        <text class="ratet" :style="{ fontSize: U.f.caption + 'px', color: '#ffffff' }">{{ qualityText || '画质' }}</text>
      </div>
      <div v-if="!isLive" class="cbtn rate" @click="cycleRate">
        <text class="ratet" :style="{ fontSize: U.f.caption + 'px', color: '#ffffff' }">{{ rate }}x</text>
      </div>
    </div>
  </div>
</template>

<script>
// 播放页 —— 全新实现. 只沿用设备契约 (video 元素 / hole / seekbar), 结构与样式按 PiliNara 播放页重写.
//
// 关键契约 (来自设备实测, 见 docs/device-contract.md):
//   position / info.duration 单位是**秒**; play(sec) / seekto(sec) 也吃秒
//   video 方法: play pause resume stop seekto setSrc setRate getRate
//   状态串 'pause' 里包含 'play' -> 判断顺序必须先 pause 后 play
//   暂停后 getPosition() 返回 0 -> 暂停时必须停轮询, 否则进度条被打回 0
import { ui } from '../../design/ui.js'
import { getCfg, setCfg } from '../../core/config.js'
import { log, logDebug } from '../../core/log.js'
import { videoDetail, playUrl, danmakuXml, subtitleBody, sponsorSegments, liveRoomPlayUrl } from '../../services/api.js'
import { shouldSkip } from '../../services/sponsorblock.js'
import * as audio from '../../services/audio.js'
import { getProgress, setProgress } from '../../core/store.js'
import { parseDanmakuXml, mergeDanmaku, filterDanmaku, buildTracks, visibleAt, colorHex } from '../../services/danmaku.js'
import { pickCue, parseSubtitleJson } from '../../services/subtitle.js'
import { durationMs } from '../../services/format.js'
import { qualityLabel, deviceQualities, DEVICE_MAX_QN } from '../../services/api.js'
import * as screenon from '../../services/screenon.js'

const TICK = 300
const BAR_HIDE_MS = 5000
const RATES = [0.75, 1, 1.25, 1.5, 2]

const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  play: require('../../assets/mi/play_46_w.png'),
  pause: require('../../assets/mi/pause_46_w.png'),
  back10: require('../../assets/mi/replay10_28_w.png'),
  fwd10: require('../../assets/mi/forward10_28_w.png')
}

function fitRect(vw, vh) {
  const W = 960, H = 266
  const w = Number(vw) || 0, h = Number(vh) || 0
  if (!(w > 0) || !(h > 0)) return { x: 243, y: 0, w: 474, h: H }
  const s = Math.min(W / w, H / h)
  const dw = Math.round(w * s), dh = Math.round(h * s)
  return { x: Math.round((W - dw) / 2), y: Math.round((H - dh) / 2), w: dw, h: dh }
}

export default {
  name: 'play',
  data() {
    return {
      U: ui(),
      MI: MI,
      bvid: '',
      mode: '',            // '' = 点播, 'live' = 直播
      roomid: 0,
      liveSrcTry: 0,       // 直播候选线路 (起播失败时轮换)
      liveStartedAt: 0,
      liveElapsed: 0,
      liveReconnect: 0,
      titleText: '',
      src: '',
      vrect: { x: 243, y: 0, w: 474, h: 266 },
      statusText: '加载中…',
      playing: false,
      opened: false,
      started: false,
      barVisible: true,
      curMs: 0,
      durMs: 0,
      posMs: 0,
      posAt: 0,
      dragging: false,
      dragMs: 0,
      rate: 1,
      qualityText: '',
      qualityMenu: false,
      qualityList: [],
      curQn: 0,
      // 弹幕
      dmOn: true, dmItems: [], dmFrame: [], dmRaw: [], dmScanFrom: 0, dmLastT: -1,
      dmAreaW: 474, dmAreaH: 266, dmCid: 0,
      // 字幕
      subCues: null, subCues2: null, subMain: '', subSecond: '',
      // SponsorBlock
      sbSegs: [], sbLastSkipAt: 0,
      // 音频输出
      btDevices: [], btLabel: '', audioMode: 'speaker', audioMsg: '',
      // 内部
      genSeq: 0, _poll: null, _hide: null, _resumeRead: false, _applied: false
    }
  },
  computed: {
    isLive() { return this.mode === 'live' },
    liveElapsedText() { return durationMs(this.liveElapsed * 1000) },
    vrectStyle() {
      const r = this.vrect
      return { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }
    },
    seekMax() { const s = Math.round(this.durMs / 1000); return s > 0 ? s : 1 },
    seekValue() {
      const sec = this.dragging ? Math.round(this.dragMs / 1000) : Math.round(this.curMs / 1000)
      if (!(sec >= 0)) return 0
      return sec > this.seekMax ? this.seekMax : sec
    },
    curText() { return durationMs(this.dragging ? this.dragMs : this.curMs) },
    durText() { return durationMs(this.durMs) },
    subLayerStyle() {
      const r = this.vrect
      const off = Number(getCfg('subOffsetY')) || 10
      const h = this.subSecond !== '' ? 52 : 28
      return { left: r.x + 'px', top: (r.y + r.h - off - h) + 'px', width: r.w + 'px', height: h + 'px' }
    },
    subMainStyle() {
      return {
        fontSize: (Number(getCfg('subFont')) || 22) + 'px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,' + ((Number(getCfg('subBgOpacity')) || 35) / 100) + ')'
      }
    },
    subSecondStyle() {
      return {
        fontSize: (Number(getCfg('subSubFont')) || 18) + 'px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,' + ((Number(getCfg('subBgOpacity')) || 35) / 100) + ')'
      }
    }
  },
  mounted() {
    const o = (this.$page && this.$page.options) || {}
    this.bvid = String(o.bvid || '')
    this.roomid = parseInt(o.roomid || '0', 10) || 0
    this.mode = (o.mode === 'live' || this.roomid > 0) ? 'live' : ''
    this.titleText = String(o.title || '')
    this.rate = Number(getCfg('defaultRate')) || 1
    this.dmOn = getCfg('dmEnable') !== false
    this.load()
  },
  methods: {
    onShow() { this.U = ui() },
    onPageUnload() {
      this.genSeq++
      this.stopPoll()
      this.cancelHide()
      if (this._hide) { clearTimeout(this._hide); this._hide = null }
      screenon.screenOnStop()
      this.elem('stop')
      this.opened = false
    },

    // 元素方法安全调用 (元素没挂上/固件不支持时静默)
    elem(name) {
      const v = this.$refs.vv
      if (!v) return undefined
      const fn = v[name]
      if (typeof fn !== 'function') return undefined
      try { return fn.apply(v, Array.prototype.slice.call(arguments, 1)) } catch (e) {
        logDebug('播放', '元素方法 ' + name + ' 失败: ' + (e && e.message ? e.message : e))
        return undefined
      }
    },

    async load() {
      const gen = ++this.genSeq
      // 直播: 不走详情/弹幕 XML/字幕, 直接取流; 无进度条与续播语义
      if (this.isLive) {
        if (!this.roomid) { this.statusText = '缺少直播间号'; return }
        await this.loadLive(gen)
        return
      }
      if (!this.bvid) { this.statusText = '缺少视频参数'; return }
      try {
        const d = await videoDetail(this.bvid)
        if (gen !== this.genSeq) return
        if (!this.titleText) this.titleText = d.title
        const cid = d.cid
        if (!cid) throw new Error('未取到 cid')
        // 取流口: web 口能给出更高的可选档位 (H5 口通常只到 480P), 所以默认走 web;
        // 清晰度用设置里的 defaultQuality, 但不得超过设备解码上限.
        const wantQn = Math.min(Number(getCfg('defaultQuality')) || DEVICE_MAX_QN, DEVICE_MAX_QN)
        let p
        try {
          p = await playUrl(this.bvid, cid, { source: 'web', qn: wantQn })
        } catch (e) {
          // web 口没有 mp4 时退回 H5 口 (少量稿件只有 H5 有)
          log('播放', 'web 口取流失败, 退回 H5 口')
          p = await playUrl(this.bvid, cid, { source: 'html5', qn: wantQn })
        }
        if (gen !== this.genSeq) return
        this.applyQualities(p)
        if (p.duration > 0) this.durMs = p.duration
        // 断点续播
        if (getCfg('resumePlay') !== false && !this._resumeRead) {
          this._resumeRead = true
          this._resumeAt = getProgress(this.bvid)
        }
        await this.prepareAudio()
        if (gen !== this.genSeq) return
        this.playStream(p.url, gen)
        // 弹幕 / 字幕 / 赞助片段 (都不阻塞起播)
        this.loadDanmaku(cid)
        this.loadSubtitles(d, gen)
        this.loadSponsor(gen)
      } catch (e) {
        if (gen !== this.genSeq) return
        this.statusText = (e && e.message ? e.message : String(e)).substring(0, 60)
        this.playing = false
        log('播放', '加载失败: ' + this.statusText)
      }
    },

    // ---------------- 直播 ----------------
    // 直播与点播的差别全部收敛在这里: 无进度条/无倍速/无续播/无弹幕 XML, 断流有限重连.
    async loadLive(gen) {
      this.statusText = '连接直播中…'
      try {
        const p = await liveRoomPlayUrl(this.roomid, this.liveSrcTry)
        if (gen !== this.genSeq) return
        this.titleText = this.titleText || ('直播间 ' + this.roomid)
        this.liveStartedAt = Date.now()
        this.playStream(p.url, gen)
      } catch (e) {
        if (gen !== this.genSeq) return
        this.statusText = (e && e.message ? e.message : String(e)).substring(0, 50)
        log('播放', '直播取流失败: ' + this.statusText)
      }
    },
    liveReconnectNow(reason) {
      if (!this.isLive) return
      if (this.liveReconnect >= 3) { this.statusText = '直播已断开, 请返回重进'; return }
      if (Date.now() - (this._lastReconnectAt || 0) < 3000) return
      this._lastReconnectAt = Date.now()
      this.liveReconnect++
      this.liveSrcTry++            // 换一条线路再试
      log('播放', '直播重连 #' + this.liveReconnect + ' (' + reason + ')')
      this.stopPoll()
      this.playing = false
      this.statusText = '重连中 (第 ' + this.liveReconnect + ' 次)…'
      const gen = ++this.genSeq
      const self = this
      setTimeout(function () { if (gen === self.genSeq) self.loadLive(gen) }, 1500)
    },

    // ---------------- 音频仲裁与路由 ----------------
    // 系统**没有音频焦点 API** (libfalcon / jsapi 都没有 requestAudioFocus 之类),
    // 但有两样可用: ① $falcon.stopVideoPlayer() 全局停止播放器 (系统自己用 _videoplayer_mutex 做互斥)
    //              ② 播放器元素的 setAudioDeviceType (实时改 ALSA sink, 不用重起播)
    // 所以"抢占"= 起播前先全局停一次; "实时切换"= 播放中直接调 setAudioDeviceType.
    async prepareAudio() {
      // 1) 抢占: 停掉其它应用/页面正在播的内容
      if (getCfg('audioPreempt') !== false) {
        try {
          if (typeof $falcon !== 'undefined' && $falcon && typeof $falcon.stopVideoPlayer === 'function') {
            $falcon.stopVideoPlayer()
            log('音频', '已请求全局停止其它播放 (抢占)')
          }
        } catch (e) { log('音频', '抢占失败: ' + e) }
      }
      // 2) 解析输出设备
      const want = String(getCfg('audioRoute') || 'auto')
      const list = await audio.btDevices()
      this.btDevices = list
      if (want === 'bluetooth') {
        if (!list.length) { this.audioMode = 'speaker'; this.audioMsg = '没有已连接蓝牙, 用扬声器' }
        else { this.audioMode = 'bluetooth'; this.audioMsg = '蓝牙 ' + list[0].name }
      } else if (want === 'auto') {
        if (list.length) { this.audioMode = 'bluetooth'; this.audioMsg = '自动·蓝牙 ' + list[0].name }
        else { this.audioMode = 'speaker'; this.audioMsg = '' }
      } else {
        this.audioMode = 'speaker'; this.audioMsg = ''
      }
      this.btLabel = this.audioMode === 'bluetooth' ? '蓝牙' : '扬声器'
      log('音频', '输出=' + this.audioMode + ' ' + this.audioMsg + ' 已连接蓝牙=' + list.length)
      return this.audioMode
    },
    /** 把当前音频路由真正下发给播放器元素 (起播后调用) */
    applyAudioNow() {
      const mac = this.audioMode === 'bluetooth' && this.btDevices.length ? this.btDevices[0].mac : ''
      const r = audio.applyAudioRoute(this.video, this.audioMode, mac)
      if (!r.ok) {
        this.audioMsg = r.msg
        // 蓝牙失败就退回扬声器, 不让用户面对无声
        if (this.audioMode === 'bluetooth') {
          this.audioMode = 'speaker'
          this.btLabel = '扬声器'
          audio.applyAudioRoute(this.video, 'speaker', '')
        }
      }
      return r
    },
    /** 播放中点一下切换 扬声器 <-> 蓝牙 (实时, 不重起播) */
    async toggleAudioOut() {
      if (this.audioMode === 'bluetooth') {
        this.audioMode = 'speaker'
      } else {
        const list = this.btDevices.length ? this.btDevices : await audio.btDevices()
        this.btDevices = list
        if (!list.length) { this.showTipLocal('没有已连接的蓝牙设备'); return }
        this.audioMode = 'bluetooth'
      }
      this.btLabel = this.audioMode === 'bluetooth' ? '蓝牙' : '扬声器'
      const r = this.applyAudioNow()
      this.showTipLocal(r.ok ? ('已切到' + this.btLabel) : r.msg)
      log('音频', '实时切换 -> ' + this.audioMode + ' ' + r.msg)
    },
    showTipLocal(t) {
      this.audioMsg = t
      const self = this
      if (this._audioTipT) { try { clearTimeout(this._audioTipT) } catch (e) {} }
      this._audioTipT = setTimeout(function () { if (self.audioMsg === t) self.audioMsg = '' }, 1800)
    },

    playStream(url, gen) {
      if (gen !== this.genSeq) return
      this.statusText = '缓冲中…'
      this.src = url
      this.started = false
      this._applied = false
      const self = this
      // src 绑定后元素要等下一次属性 diff 才建管线, 稍后再 play(0)
      setTimeout(function () {
        if (gen !== self.genSeq) return
        self.elem('play', 0)
        self.opened = true
        self.startPoll()
        screenon.screenOnStart()
        log('播放', '起播 ' + self.bvid)
      }, 300)
    },

    // ---------------- 元素事件 ----------------
    onState(e) {
      const s = Number(e && (e.state != null ? e.state : e.value))
      if (!isFinite(s)) return
      // ★ 状态串语义: 'pause' 包含 'play', 所以先判暂停再判播放
      if (s === 1) {                       // 暂停
        this.playing = false
        this.stopPoll()
        // 直播里"停住"就是断流: 有限重连, 不要留黑屏
        if (this.isLive && this.wantPlay) { this.liveReconnectNow('state=1'); return }
        this.showBar()
        return
      }
      if (s === 4) {                       // 播放中
        this.playing = true
        this.started = true
        this.statusText = ''
        this.startPoll()
        if (!this._applied) {
          this._applied = true
          // 起播成功后再下发音频路由: 元素此时才真的持有 ALSA sink
          this.applyAudioNow()
          if (this.rate !== 1) this.elem('setRate', this.rate)
          const at = (this._resumeAt || 0) > 0 ? this._resumeAt : (Number(getCfg('skipIntroSec')) || 0)
          if (at > 0) { this.elem('seekto', at); this.curMs = at * 1000; this.posMs = at * 1000; this.posAt = Date.now() }
        }
      }
    },
    onInfo(e) {
      const d = Number(e && e.duration)
      if (d > 0) this.durMs = d * 1000
      const h = Number(e && e.video_height)
      if (h >= 1440) this.qualityText = '4K'
      else if (h >= 1000) this.qualityText = '1080P'
      else if (h >= 700) this.qualityText = '720P'
      else if (h >= 400) this.qualityText = '480P'
      else if (h > 0) this.qualityText = '360P'
      const r = fitRect(e && e.video_width, e && e.video_height)
      if (r.w !== this.vrect.w || r.h !== this.vrect.h) {
        this.vrect = r
        this.dmAreaW = r.w
        this.dmAreaH = r.h
        this.rebuildDanmaku()
      }
    },
    onPosition(e) {
      const sec = Number(e && e.position)
      if (!(sec >= 0)) return
      this.posMs = Math.round(sec * 1000)
      this.posAt = Date.now()
      this.curMs = this.posMs
      if (getCfg('resumePlay') !== false && this.started) {
        setProgress(this.bvid, Math.round(sec), Math.round(this.durMs / 1000))
      }
    },
    onBuffer() {},
    onComplete() {
      if (this.isLive) { this.liveReconnectNow('complete'); return }
      this.statusText = '播放结束'
      this.playing = false
      this.stopPoll()
      screenon.screenOnStop()
      this.showBar()
    },
    onError(e) {
      this.statusText = '播放出错'
      this.playing = false
      this.stopPoll()
      log('播放', '元素报错: ' + (e ? JSON.stringify(e).substring(0, 120) : ''))
    },

    // ---------------- 进度轮询 (position ~1s 一次, 中间用本地时钟插值) ----------------
    startPoll() {
      if (this._poll != null) return
      const self = this
      this._poll = setInterval(function () {
        if (!self.opened || !self.playing || self.dragging) return
        // 直播: 只累计"已播时长", 位置取不到也不需要
        if (self.isLive) {
          self.liveElapsed = self.liveStartedAt ? Math.floor((Date.now() - self.liveStartedAt) / 1000) : 0
          return
        }
        let ms = self.posMs + (Date.now() - self.posAt)
        if (self.durMs > 0 && ms > self.durMs) ms = self.durMs
        self.curMs = ms
        self.dmTick()
        self.subtitleTick()
        self.sponsorTick()
      }, TICK)
    },
    stopPoll() {
      if (this._poll != null) { clearInterval(this._poll); this._poll = null }
    },

    // ---------------- 控制 ----------------
    togglePlay() {
      if (this.playing) { this.elem('pause'); this.playing = false; this.stopPoll() }
      else { this.elem('resume'); this.playing = true; this.startPoll() }
      this.scheduleHide()
    },
    seekBy(delta) {
      const t = Math.max(0, Math.round(this.curMs / 1000) + delta)
      this.elem('seekto', t)
      this.curMs = t * 1000
      this.posMs = t * 1000
      this.posAt = Date.now()
      this.showBar()
    },
    onSeekChanging(e) {
      const v = e && e.detail && e.detail.value
      if (v == null) return
      this.dragging = true
      this.dragMs = Number(v) * 1000
      this.showBar()
    },
    onSeekChange(e) {
      const v = e && e.detail && e.detail.value
      this.dragging = false
      if (v == null) return
      const t = Number(v)
      this.elem('seekto', t)
      this.curMs = t * 1000
      this.posMs = t * 1000
      this.posAt = Date.now()
      this.dmScanFrom = 0
      this.dmFrame = []
      this.dmLastT = -1
    },
    // ---------------- 清晰度 ----------------
    // 规则: 档位来自接口的 accept_quality (该稿件真实可选), 再按设备解码上限过滤;
    // 选择后重新取流并保留当前播放位置 (换清晰度不该从头播).
    toggleQualityMenu() {
      this.qualityMenu = !this.qualityMenu
      this.showBar()
    },
    qitemStyle(q) {
      const on = q.qn === this.curQn
      return {
        backgroundColor: on ? this.U.c.primaryContainer : this.U.c.surfaceContainerHigh,
        borderRadius: this.U.rad.chip + 'px'
      }
    },
    qitemTextStyle(q) {
      const on = q.qn === this.curQn
      return {
        fontSize: this.U.f.caption + 'px',
        color: on ? this.U.c.onPrimaryContainer : this.U.c.onSurface
      }
    },
    async chooseQuality(qn) {
      this.qualityMenu = false
      if (!qn || qn === this.curQn) return
      const keep = Math.round(this.curMs / 1000)
      this.curQn = Number(qn)
      setCfg('defaultQuality', Number(qn))
      log('播放', '切换清晰度 -> ' + qualityLabel(qn))
      await this.reloadAt(keep)
    },
    // 重新取流并回到指定秒
    async reloadAt(sec) {
      const gen = ++this.genSeq
      this.statusText = '切换中…'
      this.stopPoll()
      try {
        const d = await videoDetail(this.bvid)
        if (gen !== this.genSeq) return
        const p = await playUrl(this.bvid, d.cid, { source: 'web', qn: this.curQn })
        if (gen !== this.genSeq) return
        this.applyQualities(p)
        this._resumeAt = sec     // 复用续播通道: 起播后 seek 到原位
        this._resumeRead = true
        this._applied = false
        this.playStream(p.url, gen)
      } catch (e) {
        if (gen !== this.genSeq) return
        this.statusText = (e && e.message ? e.message : String(e)).substring(0, 50)
      }
    },
    applyQualities(p) {
      const list = []
      const pairs = (p && p.qualities) || []
      for (let i = 0; i < pairs.length; i++) list.push({ qn: pairs[i].qn, label: pairs[i].label })
      if (!list.length) list.push({ qn: p.quality || 0, label: qualityLabel(p.quality) })
      this.qualityList = list
      this.curQn = Number(p.quality) || (list[0] && list[0].qn) || 0
      this.qualityText = qualityLabel(this.curQn)
    },

    cycleRate() {
      const i = RATES.indexOf(this.rate)
      this.rate = RATES[(i + 1) % RATES.length]
      this.elem('setRate', this.rate)
      log('播放', '倍速 ' + this.rate + 'x')
    },
    toggleBar() {
      if (this.barVisible) this.hideBar(); else this.showBar()
    },
    showBar() {
      this.barVisible = true
      this.scheduleHide()
    },
    hideBar() { this.barVisible = false; this.cancelHide() },
    scheduleHide() {
      this.cancelHide()
      if (!this.playing) return
      const self = this
      this._hide = setTimeout(function () { if (self.playing) self.barVisible = false }, BAR_HIDE_MS)
    },
    cancelHide() { if (this._hide) { clearTimeout(this._hide); this._hide = null } },
    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('index') } catch (e2) {} } },

    // ---------------- 弹幕 ----------------
    async loadDanmaku(cid) {
      const id = Number(cid) || 0
      if (!id || id === this.dmCid) return
      this.dmCid = id
      if (!this.dmOn) return
      const gen = this.genSeq
      try {
        const xml = await danmakuXml(id)
        if (gen !== this.genSeq || !xml) return
        this.buildDanmaku(xml)
      } catch (e) { logDebug('播放', '弹幕加载失败: ' + (e && e.message ? e.message : e)) }
    },
    buildDanmaku(xml) {
      const list = parseDanmakuXml(xml)
      const merged = getCfg('dmMerge') !== false
        ? mergeDanmaku(list, {
          windowSec: 6,
          threshold: Number(getCfg('dmMergeThreshold')) || 3,
          growth: (Number(getCfg('dmMergeGrowth')) || 12) / 100,
          maxScale: 2.2,
          keepMode: true
        })
        : list
      const rawWords = String(getCfg('dmBlockWords') || '')
      const rawRe = String(getCfg('dmBlockRegex') || '')
      const split = function (s) { return String(s || '').split(/[\n|]+/).map(function (x) { return x.trim() }).filter(Boolean) }
      const kept = filterDanmaku(merged, { keywords: split(rawWords), regexes: split(rawRe), modes: [], minLength: 0 })
      this.dmRaw = kept
      this.rebuildDanmaku()
      log('播放', '弹幕 ' + list.length + ' -> ' + kept.length + ' 条')
    },
    rebuildDanmaku() {
      if (!this.dmRaw.length) { this.dmItems = []; this.dmFrame = []; return }
      const font = Number(getCfg('dmFont')) || 24
      const speedSec = Math.max(2, Number(getCfg('dmSpeedSec')) || 9)
      const lanes = Number(getCfg('dmLanes')) || 6
      const t = buildTracks(this.dmRaw, {
        areaW: this.dmAreaW,
        areaH: this.dmAreaH,
        fontSize: font,
        speedPx: Math.max(10, Math.round(this.dmAreaW / speedSec)),
        laneH: Math.round(font * 1.5),
        maxLanes: lanes
      })
      const proj = []
      for (let i = 0; i < (t.items || []).length; i++) {
        const it = t.items[i]
        proj.push({
          t: Number(it.t) || 0,
          text: String(it.text == null ? '' : it.text),
          color: colorHex(it.color),
          lane: Number(it.lane) || 0,
          laneH: Math.round(font * 1.5),
          w: Number(it.w) || 0,
          dur: Number(it.dur) > 0 ? Number(it.dur) : speedSec,
          mode: Number(it.mode) || 1
        })
      }
      this.dmItems = proj
      this.dmScanFrom = 0
      this.dmFrame = []
      this.dmLastT = -1
    },
    dmTick() {
      if (!this.dmOn || !this.dmItems.length) { if (this.dmFrame.length) this.dmFrame = []; return }
      const t = this.curMs / 1000
      if (this.dmLastT >= 0 && t < this.dmLastT) { this.dmScanFrom = 0; this.dmFrame = [] }
      this.dmLastT = t
      const items = this.dmItems
      let from = this.dmScanFrom
      while (from < items.length && items[from].t + items[from].dur < t) from++
      this.dmScanFrom = from
      const W = this.dmAreaW
      const op = (Number(getCfg('dmOpacity')) || 90) / 100
      const font = Number(getCfg('dmFont')) || 24
      const frame = []
      for (let i = from; i < items.length; i++) {
        const it = items[i]
        if (it.t > t + 0.4) break
        if (t >= it.t + it.dur) continue
        const prog = Math.max(0, (t - it.t) / it.dur)
        let x, y
        const top = it.lane * it.laneH
        if (it.mode === 4) { x = Math.round((W - it.w) / 2); y = this.dmAreaH - 30 - top }
        else if (it.mode === 5) { x = Math.round((W - it.w) / 2); y = top }
        else { x = Math.round(W - prog * (W + it.w)); y = top }
        frame.push({ k: i, text: it.text, color: it.color, size: font, op: op, x: x, y: y })
      }
      this.dmFrame = frame
    },

    // ---------------- 字幕 ----------------
    async loadSubtitles(d, gen) {
      if (getCfg('subEnable') === false) return
      const subs = (d && d.subtitles) || []
      if (!subs.length) return
      const main = subs[0]
      let second = null
      for (let i = 1; i < subs.length; i++) if (subs[i].lan !== main.lan) { second = subs[i]; break }
      try {
        const raw = await subtitleBody(main.url)
        if (gen !== this.genSeq || !raw) return
        this.subCues = parseSubtitleJson(raw)
        log('播放', '字幕 ' + main.lan + ' ' + this.subCues.length + ' 条')
      } catch (e) {}
      if (second) {
        try {
          const raw2 = await subtitleBody(second.url)
          if (gen !== this.genSeq || !raw2) return
          this.subCues2 = parseSubtitleJson(raw2)
        } catch (e) {}
      }
    },
    subtitleTick() {
      if (!this.subCues && !this.subCues2) return
      const t = this.curMs / 1000
      let a = '', b = ''
      try {
        const c1 = this.subCues ? pickCue(this.subCues, t) : null
        if (c1 && c1.text) a = String(c1.text)
        const c2 = this.subCues2 ? pickCue(this.subCues2, t) : null
        if (c2 && c2.text) b = String(c2.text)
      } catch (e) {}
      if (a === b) b = ''
      if (a !== this.subMain) this.subMain = a
      if (b !== this.subSecond) this.subSecond = b
    },

    // ---------------- SponsorBlock ----------------
    // 取片段: 可选功能, 失败静默 (国内访问该服务常被重置, 不该影响播放)
    async loadSponsor(gen) {
      this.sbSegs = []
      if (getCfg('sbEnable') === false) return
      try {
        const list = await sponsorSegments(this.bvid)
        if (gen !== this.genSeq) return
        this.sbSegs = list || []
        if (this.sbSegs.length) log('播放', 'SponsorBlock 片段 ' + this.sbSegs.length + ' 个')
      } catch (e) { this.sbSegs = [] }
    },
    sponsorTick() {
      if (!this.sbSegs.length || this.dragging) return
      const cats = String(getCfg('sbCats') || '').split(',').map(function (x) { return x.trim() }).filter(Boolean)
      if (!cats.length) return
      const hit = shouldSkip(this.curMs / 1000, this.sbSegs, {
        categories: cats,
        minLenSec: Number(getCfg('sbMinLen')),
        maxSkipSec: Number(getCfg('sbMaxSkip')) || 90
      })
      if (!hit) return
      if (Date.now() - this.sbLastSkipAt < 1500) return
      this.sbLastSkipAt = Date.now()
      const to = Math.round(hit.to)
      this.elem('seekto', to)
      this.curMs = to * 1000
      this.posMs = to * 1000
      this.posAt = Date.now()
      this.dmScanFrom = 0
      this.dmLastT = -1
      log('播放', '跳过' + hit.label + ' ' + Math.round(hit.len) + 's -> ' + to + 's')
    }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #000000; }
.vsurf { position: absolute; left: 243px; top: 0px; width: 474px; height: 266px; }
.hole { position: absolute; left: 243px; top: 0px; width: 474px; height: 266px; }
.dm-layer { position: absolute; left: 243px; top: 0px; width: 474px; height: 266px; overflow: hidden; }
.dm { position: absolute; font-weight: bold; }
.sub-layer { position: absolute; flex-direction: column; align-items: center; justify-content: flex-end; }
.sub { text-align: center; padding-left: 6px; padding-right: 6px; margin-bottom: 2px; }
.sub2 { margin-bottom: 6px; }
.stage { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; }
.topbar { position: absolute; left: 0px; top: 0px; width: 960px; height: 44px; flex-direction: row; align-items: center; background-color: rgba(0,0,0,0.45); }
.back { flex-direction: row; align-items: center; height: 40px; padding-left: 12px; padding-right: 12px; }
.bt { margin-left: 4px; }
.title { flex: 1; margin-left: 8px; }
.qt { margin-right: 12px; }
.center { position: absolute; left: 0px; top: 110px; width: 960px; height: 40px; justify-content: center; align-items: center; }
.st { }
.ctrl { position: absolute; left: 0px; top: 210px; width: 960px; height: 56px; flex-direction: row; align-items: center; background-color: rgba(0,0,0,0.45); }
.cbtn { width: 52px; height: 52px; justify-content: center; align-items: center; }
.cbtn-main { width: 60px; }
.seek { flex: 1; height: 30px; margin-left: 8px; margin-right: 8px; }
.sbar { width: 100%; height: 30px; }
.time { margin-right: 10px; }
.rate { width: 62px; }
/* 画质菜单: 钉在控制条正上方, 竖排; 每项命中区 32px 高 (够点) */
.qmenu { position: absolute; right: 12px; bottom: 62px; width: 168px; flex-direction: column;
         background-color: rgba(0,0,0,0.82); border-radius: 12px; padding: 6px; }
.qitem { height: 32px; flex-direction: row; align-items: center; justify-content: center; margin-bottom: 4px; }
.qit { }
.qdev { margin-left: 6px; }
/* 音频提示: 控制条上方居中 */
.atip { position: absolute; left: 340px; bottom: 62px; width: 280px; height: 30px; justify-content: center; align-items: center;
        background-color: rgba(0,0,0,0.78); border-radius: 10px; }
.at { }
.ratet { }
.bic { width: 22px; height: 22px; }
.cic { width: 26px; height: 26px; }
</style>
