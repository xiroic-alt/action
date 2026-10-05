<template>
  <!-- 播放页 v3：UI 从第一帧就叠在播放器合成画面之上。
       层级由 native 侧保证 —— gstplayerd 在 window 建好后把 waylandsink 的
       layer 设为 bottom(2)，视频面钉在 Weston 层序最底，<hole> 挖洞透出画面。
       页面侧不再有任何「踢一脚」逻辑（合成输入不进 Weston，那条路已实测无解）。 -->
  <div class="page">
    <hole class="hole"></hole>

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
        <!-- 进度条: 自绘 + 拖动状态机 (对齐原厂 ProgressBar.vue: touchstart/move/end +
             draging/isSeeking/dstPosition + 松手才 seek). 拖动期间进度条与时间跟手,
             且不被轮询读数覆盖 —— 进度条回闪的根治做法. -->
        <div class="seek" @touchstart="seekStart" @touchmove="seekMove" @touchend="seekEnd">
          <div class="track">
            <div class="fill" :style="fillStyle"></div>
            <div class="thumb" :style="thumbStyle"></div>
          </div>
        </div>
        <text class="time">{{ curText }} / {{ durText }}</text>
      </div>
    </div>
  </div>
</template>

<script>
// 播放页 v3
// - 视频由 gstplayerd 原生进程播放 (waylandsink 进 Weston 合成);
//   native 侧在 window 建好后把 layer 设为 bottom, 视频面恒在 UI 之下,
//   本页全屏 <hole> 透出视频, 控制条悬浮在视频之上 —— 第一帧即正确.
// - 视频几何: 设备侧按分辨率等比拟合屏幕 UI 带 (信箱式), 页面零几何.
// - 生命周期: 首次 onShow 读 options -> 取流地址 -> open/start, 订阅原生状态
//             onNewOptions 同页重开 -> 换源重播
//             onHide 暂停 + 停轮询 / onUnload 单一 stop 路径
import * as player from '../../services/player.js'
import * as screenon from '../../services/screenon.js'
import { getVideoDetail, getPlayUrl, parseMessage } from '../../services/bili.js'
import { afterPaint } from '../../base-page.js'
import { log } from '../../services/log.js'

var SEG_COUNT = 24       // 进度条点击分段数
var POLL_MS = 500        // 进度轮询周期
var BAR_HIDE_MS = 5000   // 播放中控制条自动隐藏延时
var SEEK_STEP_MS = 10000 // 快退/快进步长

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

export default {
  name: 'player',
  data: function () {
    return {
      bvid: '',
      pageNo: 1,
      directUrl: '',       // 调试直链, 由 options.url 传入
      inited: false,
      opened: false,
      playing: false,
      started: false,      // 是否出过画面: 区分「未开播」与「暂停后重发 ready/buffering」
      titleText: '',
      rateText: '',        // 右上角画质/分辨率标签 (V 行分辨率)
      statusText: '加载中…',
      barVisible: true,
      lastUserTouchAt: 0,  // 最近一次用户真实触摸 (保活注入避让用)
      curMs: 0,
      durMs: 0,
      // seek 锁定窗: 期间丢弃「旧位置」的轮询读数, 进度条不再闪回去
      seekHoldMs: null,
      seekHoldUntil: 0,
      // 进度条拖动 (对齐原厂 ProgressBar.vue 的 draging / isSeeking / dstPosition)
      seekDragging: false,
      seekDstPct: -1,        // 拖动中的目标比例 0..1 (-1 = 未拖动)
      seekDstMs: 0,          // 拖动中的目标毫秒 (松手才 seek)
      seekMoved: false,      // 本次触摸是否位移过 (决定算不算「点击」)
      generation: 0,       // 异步世代: 换源/离开后过期回调不写界面
      pollTimer: null,
      hideTimer: null,
      keepTimer: null      // 防息屏注入定时器 (播放中每 6s 一次)
    }
  },
  computed: {
    MI() { return MI },
    // 标题分段: emoji -> 图片 (设备字体没有 emoji 字形, 直接 text 会整片空白)
    titleSegs() {
      const t = String(this.titleText || '')
      try { return parseMessage(t, null, null) } catch (e) { return [{ t: 0, v: t }] }
    },
    fillPct: function () {
      if (this.seekDragging && this.seekDstPct >= 0) return this.seekDstPct * 100
      if (!this.durMs) return 0
      var pct = (this.curMs / this.durMs) * 100
      if (pct < 0) return 0
      if (pct > 100) return 100
      return pct
    },
    fillStyle: function () { return { width: this.fillPct + '%' } },
    thumbStyle: function () { return { left: this.fillPct + '%' } },
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
      if (this.opened) {
        try { player.close() } catch (e) {}
        this.opened = false
      }
      this.playing = false
      this.curMs = 0
      this.durMs = 0
      this.applyOptions(options || {})
      this.loadAndPlay()
    },

    onHide: function () {
      this.stopPolling()
      this.stopKeepAwake()
      screenon.screenOnStop()
      this.cancelHideBar()
      if (this.opened && this.playing) {
        try { player.pause() } catch (e) {}
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
      try { player.offState(this.onNativeState) } catch (e) {}
      if (this.opened) {
        try { player.close() } catch (e) {}
        this.opened = false
      }
      this.playing = false
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
      if (!player.isSupported()) {
        this.statusText = '当前固件不支持视频播放 (缺少 gstplayer 模块)'
        return
      }
      player.onState(this.onNativeState)
      this.inited = true

      // 先让首帧画出「加载中…」再取流地址: bilinet.httpGet 同步阻塞 JS 线程,
      // 不延迟的话网络差时加载态画不出来, 表现为上一页面冻结 (卡死)
      var self = this
      afterPaint(function () { self.fetchAndOpen(gen) })
    },

    // 网络取流 (首帧绘制后执行): 取详情/播放地址 -> 打开流
    fetchAndOpen: function (gen) {
      if (gen !== this.generation || !this.$page) return
      var self = this
      if (this.directUrl !== '') {
        this.statusText = '缓冲中…'
        this.openStream(this.directUrl, gen)
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
        self.openStream(play.url, gen)
      }).catch(function (err) {
        if (gen !== self.generation) return
        self.statusText = err && err.message ? err.message : String(err)
        self.playing = false
        self.showBar()
      })
    },

    openStream: function (url, gen) {
      if (gen !== this.generation) return
      this.started = false   // 换源/重开: 过渡态重新允许显示「加载中」
      try {
        this.statusText = '缓冲中…'
        player.open(url)
      } catch (e) {
        this.statusText = '打开失败: ' + (e && e.message ? e.message : String(e))
        this.showBar()
        return
      }
      // open 可能同步派发错误状态 (此时 onNativeState 已置错误提示);
      // playing/控制条自动隐藏一律由原生 play 状态驱动, 不在此乐观置位.
      if (this.statusText.indexOf('播放错误') === 0) return
      this.opened = true
      player.start()
      this.startPolling()
    },

    // ---------------- 原生状态回调 ----------------
    onNativeState: function (state) {
      if (!this.$page) return
      var s = String(state || '').toLowerCase()
      console.log('[player] stateChanged: ' + s)
      if (s.indexOf('error') === 0) {
        this.statusText = '播放错误: ' + state
        this.playing = false
        this.stopPolling()
        this.stopKeepAwake()
        this.showBar()
        return
      }
      if (s.indexOf('eos') >= 0 || s.indexOf('ended') >= 0) {
        this.statusText = '播放结束'
        this.playing = false
        this.stopPolling()
        this.stopKeepAwake()
        this.showBar()
        return
      }
      // V <w> <h>: 分辨率行 (右上角标签)
      if (s.charAt(0) === 'v' && s.indexOf('video') !== 0) {
        var parts = String(state).split(' ')
        if (parts.length >= 3) {
          var h = parseInt(parts[2], 10)
          if (h >= 1440) this.rateText = '4K'
          else if (h >= 1000) this.rateText = '1080P'
          else if (h >= 700) this.rateText = '720P'
          else if (h >= 400) this.rateText = '480P'
          else if (h > 0) this.rateText = '360P'
        }
        return
      }
      // 注意: 'pause' 包含子串 'play', 必须先判 pause 再判 play
      if (s.indexOf('pause') >= 0) {
        this.playing = false
        this.stopPolling()   // 暂停后 getPosition 可能返回 0, 轮询会把进度打回 0:00
        this.stopKeepAwake() // 暂停时不注入输入事件, 不干扰用户点按
        this.showBar()
        return
      }
      if (s.indexOf('play') >= 0) {
        this.playing = true
        this.started = true  // 已出过画面: 之后不再显示「加载中」过渡态
        if (this.statusText !== '') this.statusText = ''
        this.startPolling()
        this.startKeepAwake()
        this.scheduleHideBar()
        return
      }
      // ready/buffering 过渡态只在「从未播过」时显示;
      // 暂停后 native 常重发 ready/buffering, 用 started 区分.
      if (s === 'ready' || s === 'buffering' || s === 'loading') {
        if (!this.started) this.statusText = '加载中…'
      }
    },

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
      var p = player.screenOnAsync()
      if (p && typeof p.then === 'function') {
        p.then(function () { self._keepBusy = false }, function () { self._keepBusy = false })
      } else {
        player.screenOn()          // 旧 .so: 退回同步 (有风险但至少能用)
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
      if (typeof player.keepAwakeEnabled === 'function' && !player.keepAwakeEnabled()) {
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

    // ---------------- 进度轮询 ----------------
    startPolling: function () {
      if (this.pollTimer != null || !this.opened) return
      var self = this
      this.pollTimer = setTicker(this, POLL_MS, function () {
        if (!self.opened) return
        var dur = player.getDuration()
        if (dur > 0) self.durMs = dur
        var pos = player.getPosition()
        // seek 后 native 还会吐 1~2 次旧位置, 直接采用会让进度条闪回去再闪过来
        if (self.seekHoldMs !== null && self.seekHoldMs !== undefined) {
          if (Date.now() > self.seekHoldUntil || Math.abs(pos - self.seekHoldMs) <= 800) {
            self.seekHoldMs = null          // 已追上目标(或锁定窗超时) -> 交回轮询
            try { log('播放器', 'seek 锁定解除, 丢弃 ' + (self.seekDropN || 0) + ' 次旧位置读数') } catch (e1) {}
            self.seekDropN = 0
          } else {
            self.seekDropN = (self.seekDropN || 0) + 1
            return                          // 锁定窗内: 丢弃旧读数, 保持显示的目标位置
          }
        }
        self.curMs = pos
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
          player.pause()
          this.playing = false
          this.stopPolling()   // 立即停轮询, 保住当前进度
        } else {
          player.resume()
          this.playing = true
          if (this.statusText === '播放结束') this.statusText = ''
          this.startPolling()
          this.scheduleHideBar()
        }
      } catch (e) {
        this.statusText = '控制失败: ' + (e && e.message ? e.message : String(e))
      }
    },

    seekBack: function () { this.seekBy(-SEEK_STEP_MS) },
    seekForward: function () { this.seekBy(SEEK_STEP_MS) },
    seekBy: function (deltaMs) {
      if (!this.opened) return
      this.showBar()
      this.applySeek(player.getPosition() + deltaMs)
    },

    // ---------------- 进度条拖动 (学原厂 ProgressBar.vue) ----------------
    // 触摸坐标即逻辑显示坐标 (0..960 / 0..266), 与 page.vue 的 txy 同一约定.
    // .seek 用固定 left(256)/width(520) 绝对定位, 所以比例能直接算.
    seekPt: function (e) {
      try {
        var t = (e && e.changedTouches && e.changedTouches[0]) || (e && e.touches && e.touches[0]) || e
        if (t && typeof t.pageX === 'number') return { x: t.pageX, ok: true }
      } catch (err) {}
      return { x: 0, ok: false }
    },
    seekStart: function (e) {
      if (!this.opened) return
      var p = this.seekPt(e)
      if (!p.ok) return
      this.seekMoved = false
      this._seekX0 = p.x
      this.showBar()
      this.seekToX(p.x)
    },
    seekMove: function (e) {
      if (!this.opened) return
      var p = this.seekPt(e)
      if (!p.ok) return
      if (!this.seekMoved && Math.abs(p.x - this._seekX0) > 6) this.seekMoved = true
      if (!this.seekMoved) return
      this.seekToX(p.x)
    },
    seekEnd: function (e) {
      if (!this.opened) return
      var p = this.seekPt(e)
      if (p.ok) this.seekToX(p.x)
      var dst = this.seekDstMs
      this.seekDragging = false
      this.seekDstPct = -1
      this.seekMoved = false
      if (dst > 0) this.applySeek(dst)
      // 松手后短暂忽略 stage 的点击 (见 toggleBar)
      this._suppressTapUntil = Date.now() + 300
    },
    // x -> 目标位置; min/max 夹在轨道内
    seekToX: function (x) {
      var dur = this.durMs || player.getDuration()
      if (dur <= 0) return
      var pct = (x - 256) / 520
      if (pct < 0) pct = 0
      if (pct > 1) pct = 1
      this.seekDstPct = pct
      this.seekDstMs = Math.round(pct * dur)
      this.seekDragging = true
    },

    applySeek: function (targetMs) {
      var dur = this.durMs || player.getDuration()
      var t = targetMs
      if (dur > 0 && t > dur - 500) t = dur - 500
      if (t < 0) t = 0
      try {
        player.seek(t)
        this.curMs = t
        // 锁定窗 1.6s: 期间只认「已追上目标(±800ms)」的读数 (进度条回闪修复)
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
/* 全带挖透: 视频由 native 等比拟合 UI 带 (信箱居中, 不裁切), UI 之下透出 */
.hole {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 960px;
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
/* 进度条绝对定位(左 256 / 宽 520): 拖动时坐标可直接算比例, 见 seekToX */
.seek {
  position: absolute;
  left: 256px;
  top: 0px;
  width: 520px;
  height: 44px;
}
.track {
  position: absolute;
  left: 0px;
  top: 19px;
  width: 520px;
  height: 6px;
  border-radius: 3px;
  background-color: rgba(255, 255, 255, 0.18);
}
.fill {
  position: absolute;
  left: 0px;
  top: 0px;
  height: 6px;
  border-radius: 3px;
  background-color: #fb7299;
}
.thumb {
  position: absolute;
  top: -4px;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  border-radius: 7px;
  background-color: #ffffff;
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
