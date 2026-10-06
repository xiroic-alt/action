<template>
  <div class="page">
    <!-- 视频面: 框架内置 <video> (VideoElmApi) 把 waylandsink 做成宿主主 surface 的
         subsurface, 并 place_below(wl_surface 主面) —— 视频恒在 UI 之下, 层级不需要
         再靠创建顺序或窗口属性去抢. 协议级实证见 HANDOVER §27. -->
    <video ref="vv" class="vsurf" :style="vrectStyle" :src="src"
           @state="onEvtState" @info="onEvtInfo" @position="onEvtPosition"
           @complete="onEvtComplete" @error="onEvtError"
           @bufferPercent="onEvtBuffer" @setRateFailed="onEvtRateFailed"
           @resumed="onEvtResumed" @audioDeviceTypeChanged="onEvtAudioType"></video>

    <!-- 挖洞: greenui HoleView 用 CLEAR 混合模式把这块矩形清成透明
         (libfalcon.so: JQuick::HoleView::draw 反汇编实证), UI 之下透出视频 -->
    <hole class="hole" :style="vrectStyle"></hole>

    <div class="stage" @click="toggleBar" @touchstart="markUserTouch">
      <!-- 顶部悬浮栏 -->
      <div v-if="barVisible" class="topbar">
        <div class="nav-back" @click="goBack">
          <image class="nav-ic" :src="MI.back"></image>
          <text class="nav-t">返回</text>
        </div>
        <richtext class="nav-title"><template v-for="(seg, si) in titleSegs"><span v-if="seg.t === 0" :key="'ts' + si">{{ seg.v }}</span><image v-else :key="'te' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image></template></richtext>
        <text v-if="rateText !== ''" class="nav-tag">{{ rateText }}</text>
      </div>

      <!-- 中央状态 -->
      <div v-if="statusText !== ''" class="center">
        <text class="status">{{ statusText }}</text>
      </div>

      <!-- 底部悬浮控制条 -->
      <div v-if="barVisible" class="ctrl">
        <div class="cbtn cbtn-mini" @click="seekBack">
          <image class="cbtn-ic" :src="MI.back10"></image>
        </div>
        <div class="cbtn cbtn-main" @click="togglePlay">
          <image class="cbtn-ic" :src="playing ? MI.pause : MI.play"></image>
        </div>
        <div class="cbtn cbtn-mini cbtn-mini-last" @click="seekForward">
          <image class="cbtn-ic" :src="MI.fwd10"></image>
        </div>
        <!-- 进度条: 原生 <seekbar> (JQuick::WXExternalSlider, 与 hole / video 同批注册的框架组件).
             拖动、坐标->数值、手柄全部在原生 widget 里做, 我们只接两个事件:
               changing  拖动过程中 (受 changingInterval 节流)
               change    松手确认
             负载形态 (libfalcon 反汇编实证):
               fireEvent("change", { change: { lvalue:int, value:int, detail:{lvalue,value} } })
             值域取 min=0 / max=时长(秒) / step=1, 于是 detail.value 直接就是秒.
             手柄位置由 :value 绑定驱动: 平时跟播放位置, 拖动期间跟拖动目标 (不被 position 抢). -->
        <div class="seek">
          <seekbar ref="sbar" class="sbar"
                   min="0" :max="seekMax" step="1" :value="seekBarValue"
                   backgroundColor="rgba(255,255,255,0.18)" activeColor="#fb7299"
                   handleColor="#ffffff" trackSize="6" handleSize="14" borderRadius="3"
                   @changing="onSeekChanging" @change="onSeekChange"></seekbar>
        </div>
        <text class="time">{{ curText }} / {{ durText }}</text>
      </div>
    </div>
  </div>
</template>

<script>
// 播放页 v4 —— 迁到框架内置 <video> 元素 (VideoElmApi)
//
// 为什么换: 旧实现走自建 gstplayerd 进程 + 自建顶层窗口, 那是 miniapp 窗口的
// 兄弟 xdg_toplevel, 层级只能靠 Weston 创建顺序抢, 所以"播放器压住 UI".
// 框架内置元素走 gst_video_overlay_set_window_handle(jquick_get_wayland_main_surface()),
// gst_wl 会建宿主主 surface 的 subsurface 并 place_below —— 视频天然在 UI 之下。
//
// 单位契约 (反编译官方播放器 index.js.bin 实证):
//   position 事件 / info.duration  -> 秒
//   play(sec) / seekto(sec)        -> 秒
// 元素方法: play pause resume stop seekto setSrc setRate getRate
//           setAudioDeviceType setVideoSurface
import * as screenon from '../../services/screenon.js'
import { getVideoDetail, getPlayUrl, parseMessage } from '../../services/bili.js'
import { afterPaint } from '../../base-page.js'
import { log } from '../../services/log.js'

var TICK_MS = 500        // 进度刷新周期 (position 事件 ~1s 一次, 中间用本地时钟插值)
var BAR_HIDE_MS = 5000   // 播放中控制条自动隐藏延时
var SEEK_STEP_SEC = 10   // 快退/快进步长 (秒)

function pad2(n) { return n < 10 ? '0' + n : '' + n }

function fmtMs(ms) {
  var total = Math.floor(ms / 1000)
  var h = Math.floor(total / 3600)
  var m = Math.floor((total % 3600) / 60)
  var s = total % 60
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s)
  return m + ':' + pad2(s)
}

function setTimer(vm, ms, fn) {
  var p = vm.$page
  if (p && p.setTimeout) return p.setTimeout(fn, ms)
  return setTimeout(fn, ms)
}
function setTicker(vm, ms, fn) {
  var p = vm.$page
  if (p && p.setInterval) return p.setInterval(fn, ms)
  return setInterval(fn, ms)
}
function clearTimer(vm, token) {
  if (token == null) return
  var p = vm.$page
  if (p && p.clearTimeout) p.clearTimeout(token); else clearTimeout(token)
}
function clearTicker(vm, token) {
  if (token == null) return
  var p = vm.$page
  if (p && p.clearInterval) p.clearInterval(token); else clearInterval(token)
}

// 图标: material-icons-svg 的光栅化产物 (生成器 tools/make-icons.mjs)
const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  play: require('../../assets/mi/play_28_w.png'),
  pause: require('../../assets/mi/pause_28_w.png'),
  back10: require('../../assets/mi/replay10_28_w.png'),
  fwd10: require('../../assets/mi/forward10_28_w.png')
}

// UI 带几何 (logical 显示坐标)
var BAND_W = 960
var BAND_H = 266

// 设备侧行为: 把视频按分辨率等比拟合进元素矩形, 居中 (信箱式, 不裁切)。
// 已实证: 元素 960x222 + 854x480 源 -> subsurface 落在 (283,107) 394x222。
// 这里反着算: 先按源宽高比算出一个贴合矩形, 让元素矩形 = 画面矩形,
// 于是 <hole> 与画面严丝合缝, 不会露出洞外的空档。
function fitRect(vw, vh) {
  var w = Number(vw) || 0
  var h = Number(vh) || 0
  if (!(w > 0) || !(h > 0)) return { x: 243, y: 0, w: 474, h: BAND_H }  // 缺省 16:9
  var s = Math.min(BAND_W / w, BAND_H / h)
  var dw = Math.round(w * s)
  var dh = Math.round(h * s)
  return { x: Math.round((BAND_W - dw) / 2), y: Math.round((BAND_H - dh) / 2), w: dw, h: dh }
}

export default {
  name: 'player',
  data: function () {
    return {
      bvid: '',
      pageNo: 1,
      directUrl: '',       // 调试直链, 由 options.url 传入
      src: '',
      inited: false,
      opened: false,
      playing: false,
      started: false,      // 是否出过画面: 区分「未开播」与「暂停后重发 READY/PAUSED」
      titleText: '',
      rateText: '',        // 右上角画质标签 (V 行分辨率)
      vrect: { x: 243, y: 0, w: 474, h: BAND_H },
      statusText: '加载中…',
      barVisible: true,
      lastUserTouchAt: 0,  // 最近一次用户真实触摸 (保活注入避让用)
      curMs: 0,
      durMs: 0,
      // 本地时钟插值: position 事件 ~1s 一次, 中间用 elapsed 补齐, 进度条才不跳
      posMs: 0,
      posAt: 0,
      // seek 锁定窗: 期间丢弃「旧位置」的事件读数, 进度条不再闪回去
      seekHoldMs: null,
      seekHoldUntil: 0,
      // 进度条拖动 (对齐原厂 ProgressBar.vue 的 draging / isSeeking / dstPosition)
      seekDragging: false,
      seekDstPct: -1,        // 拖动中的目标比例 0..1 (-1 = 未拖动)
      seekDstMs: 0,          // 拖动中的目标毫秒 (松手才 seek)
      autoStarted: false,    // 首播时补过一次 resume() (PAUSED 预滚 -> PLAYING)
      wantPlay: false,       // 「有意播」意图: 非用户操作导致的 PAUSED 要自愈回 PLAYING
      lastResumeAt: 0,       // 自愈 resume 的节流时间戳
      generation: 0,         // 异步世代: 换源/离开后过期回调不写界面
      pollTimer: null,
      hideTimer: null,
      keepTimer: null        // 防息屏注入定时器 (播放中每 6s 一次)
    }
  },
  computed: {
    MI() { return MI },
    vrectStyle() {
      var r = this.vrect
      return { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }
    },
    // 标题分段: emoji -> 图片 (设备字体没有 emoji 字形, 直接 text 会整片空白)
    titleSegs() {
      const t = String(this.titleText || '')
      try { return parseMessage(t, null, null) } catch (e) { return [{ t: 0, v: t }] }
    },
    // 原生 seekbar 的值域 = 秒 (min=0 / max=时长 / step=1)
    seekMax: function () {
      var s = Math.round(this.durMs / 1000)
      return s > 0 ? s : 1
    },
    seekBarValue: function () {
      var sec
      if (this.seekDragging && this.seekDstMs > 0) sec = Math.round(this.seekDstMs / 1000)
      else sec = Math.round(this.curMs / 1000)
      if (!(sec >= 0)) sec = 0
      return sec > this.seekMax ? this.seekMax : sec
    },
    curText: function () {
      if (this.seekDragging && this.seekDstMs > 0) return fmtMs(this.seekDstMs)
      return fmtMs(this.curMs)
    },
    durText: function () { return fmtMs(this.durMs) }
  },
  methods: {
    // ---------------- 生命周期 ----------------
    onShow: function () {
      if (!this.inited) {
        // 同页 navTo 的 onNewOptions 只发到 Page 实例, 需显式挂钩到组件
        if (this.$page && !this._newOptionsBound) {
          this._newOptionsBound = true
          var self = this
          this.$page.onNewOptions = function (options) { self.onNewOptions(options) }
        }
        this.applyOptions((this.$page && this.$page.options) || {})
        this.loadAndPlay()
        return
      }
      if (this.opened && !this.playing) this.showBar()
      this.startPolling()
    },

    onNewOptions: function (options) {
      console.log('[player] onNewOptions bvid=' + (options && options.bvid))
      this.generation++
      this.stopPolling()
      this.cancelHideBar()
      this.stopStream()
      this.playing = false
      this.curMs = 0
      this.durMs = 0
      this.posMs = 0
      this.applyOptions(options || {})
      this.loadAndPlay()
    },

    onHide: function () {
      this.stopPolling()
      this.stopKeepAwake()
      screenon.screenOnStop()
      this.cancelHideBar()
      this.wantPlay = false
      if (this.opened && this.playing) {
        this.elem('pause')
        this.playing = false
      }
      this.showBar()
    },

    onUnload: function () {
      this.generation++
      this.stopPolling()
      this.stopKeepAwake()
      screenon.screenOnStop()
      this.cancelHideBar()
      this.stopStream()
      this.playing = false
    },

    // 元素方法安全调用: 元素没挂上/固件不支持时静默降级
    elem: function (name) {
      var v = this.$refs.vv
      if (!v) return undefined
      var fn = v[name]
      if (typeof fn !== 'function') return undefined
      try {
        return fn.apply(v, Array.prototype.slice.call(arguments, 1))
      } catch (e) {
        console.log('[player] elem ' + name + ' error: ' + (e && e.message ? e.message : e))
        return undefined
      }
    },

    stopStream: function () {
      this.wantPlay = false
      if (this.opened) {
        this.elem('stop')
        this.opened = false
      }
    },

    // ---------------- 打开与换源 ----------------
    applyOptions: function (options) {
      this.bvid = options.bvid || ''
      this.pageNo = parseInt(options.page || '1', 10) || 1
      this.titleText = options.title || ''
      this.directUrl = options.url || ''
    },

    loadAndPlay: function () {
      var gen = ++this.generation
      this.inited = true
      try { log('播放器', '进入播放页 bvid=' + this.bvid + ' direct=' + (this.directUrl ? '有' : '无') + ' gen=' + gen) } catch (e) {}
      // 先让首帧画出「加载中…」再取流地址: bilinet.httpGet 同步阻塞 JS 线程,
      // 不延迟的话网络差时加载态画不出来, 表现为上一页面冻结 (卡死)
      var self = this
      afterPaint(function () {
        try {
          var sb = self.$refs.sbar
          console.warn('[player] seekbar ref=' + (sb ? Object.prototype.toString.call(sb) : 'MISSING') +
            ' keys=' + (sb ? Object.keys(sb).join(',') : '-'))
        } catch (e) {}
        self.fetchAndOpen(gen)
      })
    },

    // 网络取流 (首帧绘制后执行): 取详情/播放地址 -> 起播
    fetchAndOpen: function (gen) {
      if (gen !== this.generation || !this.$page) return
      var self = this
      if (this.directUrl !== '') {
        this.statusText = '缓冲中…'
        this.playStream(this.directUrl, gen)
        return
      }
      if (!this.bvid) {
        this.statusText = '缺少视频参数 (bvid)'
        return
      }
      this.statusText = '加载中…'
      getVideoDetail(this.bvid).then(function (detail) {
        if (gen !== self.generation) return
        if (self.titleText === '' && detail.title) self.titleText = detail.title
        var page = detail.pages && detail.pages.length > 0
          ? detail.pages[Math.min(self.pageNo, detail.pages.length) - 1]
          : null
        var cid = page ? page.cid : 0
        if (!cid) throw new Error('未找到视频 cid')
        return getPlayUrl(self.bvid, cid)
      }).then(function (play) {
        if (gen !== self.generation || !play) return
        if (play.duration > 0) self.durMs = play.duration
        self.playStream(play.url, gen)
      }).catch(function (err) {
        if (gen !== self.generation) return
        self.statusText = err && err.message ? err.message : String(err)
        self.playing = false
        self.showBar()
      })
    },

    playStream: function (url, gen) {
      if (gen !== this.generation) return
      var self = this
      this.started = false
      this.autoStarted = false
      this.wantPlay = true
      this.posMs = 0
      this.posAt = Date.now()
      this.curMs = 0
      this.statusText = '缓冲中…'
      this.src = url
      // src 绑定到元素属性后, 元素要等下一次属性 diff 才建管线; 稍后再 play(0) 起播
      setTimer(this, 300, function () {
        if (gen !== self.generation || !self.$page) return
        var r = self.elem('play', 0)
        if (r === undefined && !self.$refs.vv) {
          self.statusText = '当前固件不支持内置 video 元素'
          self.showBar()
          return
        }
        console.log('[player] play(0) -> ' + r)
        self.opened = true
        self.startPolling()
      })
    },

    // ---------------- 元素事件 ----------------
    // GstState: 1 NULL / 2 READY / 3 PAUSED / 4 PLAYING
    onEvtState: function (e) {
      if (!this.$page) return
      var s = e && typeof e.state !== 'undefined' ? e.state : -1
      // console.warn: 本机只有这一级进设备日志 (projects 约定)
      console.warn('[player] state=' + s + ' wantPlay=' + this.wantPlay)
      if (s === 4) {
        this.playing = true
        this.started = true
        if (this.statusText !== '' && this.statusText.indexOf('播放错误') !== 0) this.statusText = ''
        this.posAt = Date.now()
        this.startPolling()
        this.startKeepAwake()
        this.scheduleHideBar()
        return
      }
      if (s === 3) {
        // 首播时管线只预滚到 PAUSED, 补一次 resume 进 PLAYING (真机实证)
        if (!this.started && !this.autoStarted) {
          this.autoStarted = true
          this.elem('resume')
          return
        }
        // 起播后被按回 PAUSED (真机实测: 播放中会莫名回落到 PAUSED 并停住).
        // 只要「有意播」就自愈, 1.5s 节流防风暴; 用户手动暂停时 wantPlay=false 不抢。
        if (this.wantPlay && Date.now() - this.lastResumeAt > 1500) {
          this.lastResumeAt = Date.now()
          console.warn('[player] PAUSED while wanting play -> resume()')
          this.elem('resume')
        }
        return
      }
      if (s <= 1) {
        this.playing = false
        this.stopPolling()
        this.showBar()
      }
    },

    onEvtInfo: function (e) {
      if (!e) return
      var d = Number(e.duration)
      if (d > 0) this.durMs = d * 1000
      var h = Number(e.video_height)
      if (h >= 1440) this.rateText = '4K'
      else if (h >= 1000) this.rateText = '1080P'
      else if (h >= 700) this.rateText = '720P'
      else if (h >= 400) this.rateText = '480P'
      else if (h > 0) this.rateText = '360P'
      var r = fitRect(e.video_width, e.video_height)
      if (r.w !== this.vrect.w || r.h !== this.vrect.h) {
        this.vrect = r
        console.log('[player] vrect ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h)
      }
    },

    onEvtPosition: function (e) {
      if (!e) return
      var sec = Number(e.position)
      if (!(sec >= 0)) return
      var ms = Math.round(sec * 1000)
      this.posMs = ms
      this.posAt = Date.now()
      // seek 后元素还会吐 1~2 次旧位置, 直接采用会让进度条闪回去再闪过来
      if (this.seekHoldMs !== null && this.seekHoldMs !== undefined) {
        if (Date.now() > this.seekHoldUntil || Math.abs(ms - this.seekHoldMs) <= 1500) {
          this.seekHoldMs = null
        } else {
          this.seekDropN = (this.seekDropN || 0) + 1
          return
        }
      }
      this.curMs = ms
    },

    onEvtComplete: function () {
      this.statusText = '播放结束'
      this.playing = false
      this.stopPolling()
      this.stopKeepAwake()
      this.showBar()
    },

    onEvtError: function (e) {
      var t = ''
      try { t = JSON.stringify(e) } catch (err) { t = String(e) }
      console.log('[player] error ' + t)
      this.statusText = '播放错误: ' + t
      this.playing = false
      this.stopPolling()
      this.stopKeepAwake()
      this.showBar()
    },

    onEvtBuffer: function (e) {
      var p = e && typeof e.bufferPercent !== 'undefined' ? e.bufferPercent : -1
      if (p >= 0 && p < 100 && !this.started) this.statusText = '缓冲中 ' + p + '%'
    },

    onEvtRateFailed: function (e) { console.log('[player] setRateFailed ' + JSON.stringify(e || {})) },
    onEvtResumed: function () {},
    onEvtAudioType: function () {},

    // ---------------- 防息屏 ----------------
    // 用户真实触摸 (拖进度条/点按钮) —— 保活注入要避让, 别打断操作
    markUserTouch: function () {
      this.lastUserTouchAt = Date.now()
    },

    // 保活: 调系统 hal-screen on (《ADB 控制手册》§10.4 实证, 深睡也能点亮).
    // 它内部会注入一次触摸激活面板 -> 会切换控制条, 所以点完立刻还原控制条状态.
    keepAwakeTap: function () {
      var self = this
      // 上一次保活还没回来就跳过这一轮 —— 绝不让请求堆叠
      if (this._keepBusy) return
      this._keepBusy = true
      var wasVisible = this.barVisible
      var p = screenon.screenOnAsync()
      if (p && typeof p.then === 'function') {
        p.then(function () { self._keepBusy = false }, function () { self._keepBusy = false })
      } else {
        screenon.screenOnSync()    // 旧 .so: 退回同步 (有风险但至少能用)
        this._keepBusy = false
      }
      // 兜底解锁: 8s 内没回调也要放行, 否则以后再也不保活
      setTimer(this, 8000, function () { self._keepBusy = false })
      setTimer(this, 120, function () {
        if (wasVisible) self.showBar(); else self.hideBar()
      })
    },

    startKeepAwake: function () {
      if (this.keepTimer != null) return
      // 设置页可关闭防息屏 (services/config.js)
      if (!screenon.keepAwakeEnabled()) {
        try { log('播放器', '防息屏: 设置里已关闭, 跳过保活') } catch (e) {}
        return
      }
      var self = this
      var jsapiOn = screenon.screenOnAvailable()
      if (jsapiOn) screenon.screenOnStart()
      try { log('播放器', '防息屏: JSAPI=' + (jsapiOn ? 'on' : 'off') + ' + 每 6s hal-screen on 保活') } catch (e) {}
      // 系统息屏阈值实测 ~10s, 6s 一次留出余量
      self.keepAwakeTap()
      this.keepTimer = setTicker(this, 6000, function () {
        if (!self.playing) return
        if (screenon.screenOnAvailable()) {
          try { screenon.screenOnTick() } catch (e) {}
        }
        if (Date.now() - (self.lastUserTouchAt || 0) < 2500) return
        self.keepAwakeTap()
      })
    },
    stopKeepAwake: function () {
      clearTicker(this, this.keepTimer)
      this.keepTimer = null
    },

    // ---------------- 进度刷新 ----------------
    // position 事件 ~1s 一次; 中间用本地时钟插值, 进度条/时间才连续
    startPolling: function () {
      if (this.pollTimer != null || !this.opened) return
      var self = this
      this.pollTimer = setTicker(this, TICK_MS, function () {
        if (!self.opened) return
        if (self.seekDragging) return
        if (self.seekHoldMs !== null && self.seekHoldMs !== undefined) return
        if (!self.playing) return
        var ms = self.posMs + (Date.now() - self.posAt)
        if (self.durMs > 0 && ms > self.durMs) ms = self.durMs
        self.curMs = ms
      })
    },
    stopPolling: function () {
      clearTicker(this, this.pollTimer)
      this.pollTimer = null
    },

    // ---------------- 控制条显隐 ----------------
    showBar: function () {
      this.barVisible = true
      this.cancelHideBar()
      if (this.playing) this.scheduleHideBar()
    },
    toggleBar: function () {
      // 刚拖过进度条: 300ms 内忽略「点一下切控制条」, 否则一松手控制条就自己藏了
      // (原厂用 isLastMoveX/isLastMoveY 做同一件事)
      if (Date.now() < (this._suppressTapUntil || 0)) return
      if (this.barVisible) this.hideBar(); else this.showBar()
    },
    hideBar: function () {
      this.cancelHideBar()
      this.barVisible = false
    },
    scheduleHideBar: function () {
      this.cancelHideBar()
      if (!this.playing) return
      var self = this
      this.hideTimer = setTimer(this, BAR_HIDE_MS, function () {
        self.hideTimer = null
        if (self.playing) self.hideBar()
      })
    },
    cancelHideBar: function () {
      clearTimer(this, this.hideTimer)
      this.hideTimer = null
    },

    // ---------------- 播放控制 ----------------
    togglePlay: function () {
      if (!this.opened) return
      this.showBar()
      try {
        if (this.playing) {
          this.wantPlay = false       // 用户主动暂停: 自愈逻辑不抢
          this.elem('pause')
          this.playing = false
          this.stopPolling()   // 立即停刷新, 保住当前进度
        } else {
          this.wantPlay = true
          this.lastResumeAt = Date.now()
          this.elem('resume')
          this.playing = true
          this.posAt = Date.now()
          if (this.statusText === '播放结束') this.statusText = ''
          this.startPolling()
          this.scheduleHideBar()
        }
      } catch (e) {
        this.statusText = '控制失败: ' + (e && e.message ? e.message : String(e))
      }
    },

    seekBack: function () { this.seekBy(-SEEK_STEP_SEC) },
    seekForward: function () { this.seekBy(SEEK_STEP_SEC) },
    seekBy: function (deltaSec) {
      if (!this.opened) return
      this.showBar()
      var cur = Math.round((this.posMs + (this.playing ? Date.now() - this.posAt : 0)) / 1000)
      this.applySeek((cur + deltaSec) * 1000)
    },

    // ---------------- 进度条拖动 (原生 <seekbar>) ----------------
    // 滑动量的解释权在原生 widget: 它把触摸位置按 min/max/step 换算成整数再抛给我们.
    // 负载取值做防御式兼容 (固件版本可能只给 value, 也可能给 detail 子对象或裸数字).
    evNum: function (e) {
      if (typeof e === 'number') return e
      if (!e || typeof e !== 'object') return NaN
      var nested = []
      var flat = []
      for (var k in e) {
        var v = e[k]
        if (v && typeof v === 'object') {
          if (typeof v.value === 'number') nested.push(v.value)
          if (typeof v.lvalue === 'number') nested.push(v.lvalue)
          if (v.detail) {
            if (typeof v.detail.value === 'number') nested.push(v.detail.value)
            if (typeof v.detail.lvalue === 'number') nested.push(v.detail.lvalue)
          }
        } else if (typeof v === 'number') {
          flat.push(v)
        }
      }
      var all = nested.concat(flat)
      for (var i = 0; i < all.length; i++) if (isFinite(all[i]) && all[i] >= 0) return all[i]
      return NaN
    },

    // 拖动中: 手柄跟手 + 时间预览; 不下发 seek, 也不回写位置
    rawLog: function (tag, e) {
      var now = Date.now()
      if (now - (this._rawAt || 0) < 1000) return
      this._rawAt = now
      var s = ''
      try { s = JSON.stringify(e) } catch (er) { s = String(e) }
      try { console.warn('[player] ' + tag + ' raw=' + s) } catch (er) {}
    },

    onSeekChanging: function (e) {
      this.rawLog('seek changing', e)
      if (!this.opened) return
      var sec = this.evNum(e)
      if (!(sec >= 0)) return
      this.seekDragging = true
      this.seekDstMs = sec * 1000
      this.showBar()
      try { console.warn('[player] seek changing sec=' + sec) } catch (er) {}
    },

    // 松手: 一次性下发 seekto (元素收秒)
    onSeekChange: function (e) {
      this.rawLog('seek change', e)
      if (!this.opened) return
      var sec = this.evNum(e)
      this.seekDragging = false
      this.seekDstPct = -1
      this.showBar()
      if (!(sec >= 0)) return
      this.seekDstMs = sec * 1000
      try { console.warn('[player] seek change sec=' + sec) } catch (er) {}
      this.applySeek(sec * 1000)
      // 松手后短暂忽略 stage 的点击 (见 toggleBar)
      this._suppressTapUntil = Date.now() + 300
    },

    // 元素 seekto() 收秒 (官方播放器实证: seekto(this.position + 40))
    applySeek: function (targetMs) {
      var dur = this.durMs
      var t = targetMs
      if (dur > 0 && t > dur - 500) t = dur - 500
      if (t < 0) t = 0
      try {
        this.elem('seekto', Math.round(t / 1000))
        this.curMs = t
        this.posMs = t
        this.posAt = Date.now()
        // 锁定窗 1.6s: 期间只认「已追上目标(±1.5s)」的读数 (进度条回闪修复)
        this.seekHoldMs = t
        this.seekHoldUntil = Date.now() + 1600
        this.seekDropN = 0
        try { log('播放器', 'seek -> ' + Math.round(t / 1000) + 's (锁定 1.6s)') } catch (e2) {}
        if (this.statusText === '播放结束') this.statusText = ''
      } catch (e) {
        console.log('[player] seek error: ' + (e && e.message ? e.message : e))
      }
    },

    goBack: function () {
      this.$page.finish()
    }
  }
}
</script>

<style scoped>
/* ===== 统一 token (与全站一致: 纯黑底 / 白字 / B 站粉唯一强调色) ===== */
.page {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 960px;
  height: 266px;
  background-color: #000000;
}
/* 视频面: 元素矩形 = 画面矩形 (vrect 由 info 事件的宽高比算出),
   设备侧把 waylandsink 的 subsurface 落在这个矩形上, 并 place_below 主 surface */
.vsurf {
  position: absolute;
  left: 243px;
  top: 0px;
  width: 474px;
  height: 266px;
}
/* 挖洞: 与画面矩形严丝合缝, 该区域在 UI 面被清成透明, 视频从下面透出 */
.hole {
  position: absolute;
  left: 243px;
  top: 0px;
  width: 474px;
  height: 266px;
}
.stage {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 960px;
  height: 266px;
}
/* 顶部栏 */
.topbar {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 960px;
  height: 44px;
  flex-direction: row;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.62);
}
.nav-back {
  flex-direction: row;
  width: 116px;
  height: 32px;
  margin-left: 14px;
  border-radius: 16px;
  background-color: rgba(255, 255, 255, 0.10);
  justify-content: center;
  align-items: center;
}
.nav-ic {
  width: 20px;
  height: 20px;
  margin-right: 4px;
}
.nav-t {
  font-size: 18px;
  color: #ffffff;
}
.nav-title {
  flex: 1;
  font-size: 22px;
  color: #ffffff;
  margin-left: 14px;
  /* Falcon 不支持 max-lines, 用 lines: 1 */
  lines: 1;
  text-overflow: ellipsis;
  overflow: hidden;
}
.nav-tag {
  font-size: 16px;
  color: #a8a8b0;
  margin-right: 16px;
}
/* 中央状态 */
.center {
  position: absolute;
  left: 0px;
  top: 111px;
  width: 960px;
  height: 44px;
  align-items: center;
  justify-content: center;
}
.status {
  font-size: 20px;
  color: #fb7299;
}
/* 底部控制条 */
.ctrl {
  position: absolute;
  left: 0px;
  top: 222px;
  width: 960px;
  height: 44px;
  padding-left: 14px;
  padding-right: 14px;
  background-color: rgba(0, 0, 0, 0.62);
  flex-direction: row;
  align-items: center;
}
/* 控制条按钮绝对定位: 与 .seek 的固定 left/width 配套, 拖动坐标才算得准 */
.cbtn {
  position: absolute;
  top: 5px;
  height: 34px;
  border-radius: 17px;
  background-color: rgba(255, 255, 255, 0.10);
  justify-content: center;
  align-items: center;
}
.cbtn-mini {
  left: 14px;
  width: 64px;
}
.cbtn-main {
  left: 88px;
  width: 80px;
  background-color: #fb7299;
}
.cbtn-mini-last {
  left: 178px;
}
.cbtn-ic {
  width: 26px;
  height: 26px;
}
/* 进度条: 绝对定位(左 256 / 宽 520), 原生 <seekbar> 铺满它 */
.seek {
  position: absolute;
  left: 256px;
  top: 0px;
  width: 520px;
  height: 44px;
}
.sbar {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 520px;
  height: 44px;
}
.time {
  position: absolute;
  left: 790px;
  top: 0px;
  width: 156px;
  height: 44px;
  font-size: 16px;
  color: #a8a8b0;
  text-align: right;
}
</style>
