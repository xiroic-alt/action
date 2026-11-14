<template>
  <div class="page" :style="{ backgroundColor: '#000000' }">
    <!-- 视频面: 框架内置 <video>. 设备侧把 waylandsink 做成宿主主 surface 的 subsurface
         并 place_below —— 视频恒在 UI 之下, 所以 UI 元素天然压在画面上 (设备契约, 见 docs/device-contract.md)
         单位: position 事件 / info.duration 都是秒; play(sec)/seekto(sec) 也吃秒 -->
    <video v-if="!cvMode" ref="vv" class="vsurf" :style="vrectStyle" :src="src"
           @state="onState" @info="onInfo" @position="onPosition"
           @complete="onComplete" @error="onError" @bufferPercent="onBuffer"></video>
    <!-- 挖洞: 把视频矩形在 UI 面清成透明, 视频从下面透出 -->
    <hole class="hole" :style="vrectStyle"></hole>

    <!-- 弹幕层: 严格裁在视频矩形内 (笔屏 960x266 里画面只占中间一条) -->
    <div class="dm-layer" :style="vrectStyle">
      <RichText v-for="d in dmFrame" :key="d.k" class="dm" :text="d.text" :size="d.size" :color="d.color"
            :lines="1" :style="{ left: d.x + 'px', top: d.y + 'px', opacity: d.op }" :drop-emoji="false" />
    </div>

    <!-- 字幕层: 主字幕 + 副字幕 (PiliNara 双语字幕) -->
    <div v-if="subMain !== '' || subSecond !== ''" class="sub-layer" :style="subLayerStyle">
      <RichText v-if="subMain !== ''" class="sub" :text="subMain" :size="subMainSize" color="#ffffff"
            :lines="0" :style="subBgStyle" :drop-emoji="false" />
      <RichText v-if="subSecond !== ''" class="sub sub2" :text="subSecond" :size="subSecondSize" color="#ffffff"
            :lines="0" :style="subBgStyle" :drop-emoji="false" />
    </div>

    <!-- 触摸层: 点击切换控制条 (命中区铺满全屏, 有显式尺寸) -->
    <div class="stage" @click="toggleBar"></div>

    <!-- 顶部: 返回 + 标题 + 画质标签 (PiliNara 播放页: 返回在左, 标题紧随, 画质在右) -->
    <div v-if="barVisible" class="topbar">
      <div class="back" @click="goBack">
        <image class="bic" :src="MI.back" :style="{ width: '24px', height: '24px' }"></image>
        <text class="bt" :style="{ fontSize: U.f.body + 'px', color: '#ffffff' }">返回</text>
      </div>
      <RichText class="title" :text="titleText" :size="U.f.subtitle" color="#ffffff" :lines="1" :drop-emoji="false" />
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
import RichText from '../../components/rich-text.vue'
// 播放页 —— 全新实现. 只沿用设备契约 (video 元素 / hole / seekbar), 结构与样式按 PiliNara 播放页重写.
//
// 关键契约 (来自设备实测, 见 docs/device-contract.md):
//   position / info.duration 单位是**秒**; play(sec) / seekto(sec) 也吃秒
//   video 方法: play pause resume stop seekto setSrc setRate getRate
//   状态串 'pause' 里包含 'play' -> 判断顺序必须先 pause 后 play
//   暂停后 getPosition() 返回 0 -> 暂停时必须停轮询, 否则进度条被打回 0
import { ui } from '../../design/ui.js'
import { getCfg, setCfg } from '../../core/config.js'
import { releaseAudioFocus, ensureAudioRoute } from '../../services/audio.js'
import { createCVPlayer, call as cvCall, cvAvailable } from '../../services/cvplayer.js'
import * as gst from '../../services/gstplayer.js'
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
  components: { RichText },
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
      btDevices: [], btLabel: '', audioMode: 'speaker', // cvplayer 后端 (官方 uridecodebin 单 bin 合并解码); 为 null 时退回 <video> 元素 cv: null, cvMode: false, gstMode: false, dim: null, gstPos: 0, gstAt: 0, gstTimer: null, cvFailed: false, _lastUrl: '', _cvGotState: false, _cvWd: null, routeState: null, btParamUsed: '', btParamRetried: false, audioMsg: '',
      // 内部
      genSeq: 0,
      h5Tried: false,
      paramKey: '', _poll: null, _hide: null, _resumeRead: false, _applied: false
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
    subMainSize() { return Number(getCfg('subFont')) || 22 },
    subSecondSize() { return Number(getCfg('subSubFont')) || 18 },
    subBgStyle() { return { backgroundColor: 'rgba(0,0,0,' + ((Number(getCfg('subBgOpacity')) || 35) / 100) + ')' } },
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
    // ★ 设备框架只转发 onShow, mounted 不保证触发 —— 参数必须两边都读
    this.initCVPlayer()
    this.readOptions()
  },
  onUnload() { this.cleanupGst() },
  onHide() { this.cleanupGst() },
  methods: {
    /**
     * 建 cvplayer 后端.
     * 为什么用它: 官方管线是**一个 uridecodebin 同时出音视频**(合并解码),
     * 而旧的 <video> 元素音频多过一层 decodebin, 两条链不共享缓冲 ->
     * 结构性音画错位. 拿到实例后 elem() 会自动走 cvCall 分发.
     * 事件参数形状要**转成和旧元素一致**, 这样 onState/onInfo/onPosition/onComplete
     * 四个处理函数一行都不用改.
     */
    initCVPlayer() {
      if (this.cv) return
      if (getCfg('useCVPlayer') !== true) { log('播放', 'cvplayer 后端未启用 (设置里可开), 用 <video>'); return }
      if (!cvAvailable()) { log('播放', 'cvplayer 不可用, 用 <video> 元素'); return }
      const self = this
      const p = createCVPlayer({
        onState: function (s) { self.onState({ state: s }) },
        onInfo: function (a, b, c) {
          // .so 里是 onInfo(int,int,int), 语义 duration / video_width / video_height
          // (逆向文档 §7.3 的注释如此, 真机按位置传)
          self.onInfo({ duration: a, video_width: b, video_height: c })
        },
        onPosition: function (pos) { self.onPosition({ position: pos }) },
        onComplete: function () { self.onComplete() },
        onResume: function () { log('播放', 'cvplayer onResume') }
      })
      if (!p) { log('播放', 'cvplayer 建实例失败, 退回 <video> 元素'); return }
      this.cv = p
      this.cvMode = true
      log('播放', '已启用 cvplayer 后端 (合并解码)')
      // 视频矩形给原生 (3 个 int: x, y, h —— 来自 .so 的 "setVideoSurface %d, %d, %d")
      this.syncCVSurface()
    },

    /**
     * cvplayer 起播看门狗.
     * 判据: 8 秒内必须收到过一次 onState (说明管线真的起来了);
     *       没收到就判定后端不可用, 切回 <video> 重放一次.
     * 为什么用 onState 而不是 onInfo/onPosition: onState 是管线状态机最早发的信号.
     */
    cvWatchdog(gen) {
      const self = this
      if (this._cvWd) { clearTimeout(this._cvWd); this._cvWd = null }
      this._cvGotState = false
      this._cvWd = setTimeout(function () {
        self._cvWd = null
        if (gen !== self.genSeq) return
        if (self._cvGotState) return                      // 正常, 不动
        log('播放', 'cvplayer 8 秒内无 onState, 判定不可用 -> 退回 <video> 重放')
        self.cvFailed = true
        // 拆掉 cvplayer, 回到元素后端
        try { cvCall(self.cv, 'stop') } catch (e) {}
        self.cv = null
        self.cvMode = false
        self._applied = false
        // 等 Vue 把 <video> 渲染出来再重放.
        // ★★ 必须先把 src 清空一帧再设回来 ——
        //   否则若 this.src 已经等于目标 url, Vue 的 diff 不认为有变化,
        //   元素的 :src 属性不更新, 元素根本不会去加载 (实测退回后仍卡"缓冲中…").
        self.src = ''
        setTimeout(function () {
          if (gen !== self.genSeq) return
          if (self._lastUrl) self.playStream(self._lastUrl, self.genSeq)
        }, 500)
      }, 8000)
    },

    /** 把当前视频矩形同步给 cvplayer */
    syncCVSurface() {
      if (!this.cv) return
      const r = this.vrect
      const rs = cvCall(this.cv, 'setVideoSurface', Math.round(r.x), Math.round(r.y), Math.round(r.h))
      log('cvplayer', 'setVideoSurface(' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.h) + ') -> ' + JSON.stringify(rs))
    },

    /**
     * ★★ 兜底清理: 杀掉所有 gst 播放进程.
     * 为什么必须有: 之前用 gst-play-1.0 起**独立进程**播放, 它创建的 wl_subsurface
     * **不受小程序页面管理** —— 页面退出后画面还压在屏幕上, 用户无法退出也无法操作.
     * 事故: 2026-11-14 PID 1898 孤儿进程持续持有 subsurface, killall 按名字也没杀到.
     * 所以页面隐藏/卸载时必须主动扫一遍, 不能只依赖 pid 文件.
     */
    cleanupGst() {
      try {
        if (this.gstTimer) { clearInterval(this.gstTimer); this.gstTimer = null }
        if (this.gstMode && gst && gst.stop) gst.stop()
      } catch (e) {}
      this.gstMode = false
      this.playing = false
    },

    onShow() {
      this.U = ui()
      // ★ 兜底: 真机上 mounted 不保证触发 (框架只稳定转发 onShow),
      //   少了这句就可能整页退回 <video> 而没人发现.
      this.initCVPlayer()
      // ★ 真机上 mounted 不一定被调用, 页面参数在这里读才不会出现"缺少视频参数"
      this.readOptions()
    },

    /**
     * 读取页面参数并起播.
     * 幂等: 同一组参数只起播一次; 参数变了 (从详情页切到另一个视频) 才重新加载.
     */
    readOptions() {
      const o = (this.$page && this.$page.options) || {}
      const bvid = String(o.bvid || '')
      const roomid = parseInt(o.roomid || '0', 10) || 0
      const mode = (o.mode === 'live' || roomid > 0) ? 'live' : ''
      const title = String(o.title || '')
      const key = bvid + '|' + roomid + '|' + mode
      if (this.paramKey === key) return          // 同一组参数, 不重复起播
      this.paramKey = key
      this.bvid = bvid
      this.roomid = roomid
      this.mode = mode
      this.titleText = title
      this.rate = Number(getCfg('defaultRate')) || 1
      this.dmOn = getCfg('dmEnable') !== false
      if (!bvid && !roomid) {
        // 参数确实为空: 给出明确提示, 不要停在"缺少视频参数"上让用户猜
        this.statusText = '缺少视频参数'
        log('播放', '缺少视频参数 (options=' + JSON.stringify(o) + ')')
        return
      }
      this.load()
    },
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
    /**
     * 播放后端统一出口.
     * ★ 所有播放控制都从这里走, 所以换后端只需要改这一个函数 —— 页面其余逻辑完全不动.
     *   cvplayer (官方, uridecodebin 单 bin 合并解码) 优先; 没有它才退回 <video> 元素.
     * 方法名映射 (cvplayer 与旧元素的差异只有两处):
     *   seekto    -> seek        (改名)
     *   setVolume -> 跳过        (cvplayer 没有音量接口)
     *   其余 play/pause/resume/stop/setRate/getRate/setAudioDeviceType 同名
     */
    elem(name) {
      const args = Array.prototype.slice.call(arguments, 1)
      if (this.cv) return this.cvCall(name, args)
      const v = this.$refs.vv
      if (!v) return undefined
      const fn = v[name]
      if (typeof fn !== 'function') return undefined
      try { return fn.apply(v, args) } catch (e) {
        logDebug('播放', '元素方法 ' + name + ' 失败: ' + (e && e.message ? e.message : e))
        return undefined
      }
    },

    /**
     * gst 后端的方法分发.
     * gst-play 是**独立进程**, 能表达的动作只有 起播/暂停/恢复/停止/跳转;
     * 音量/速率无对应 (gst-play 有 --volume 但改它要重启, 不值得), 直接忽略.
     */
    gstCall(name, args) {
      if (name === 'pause') { gst.pause(); this.gstStopClock(); return }
      if (name === 'resume') { gst.resume(); this.gstStartClock(); return }
      if (name === 'stop') { gst.stop(); this.gstStopClock(); return }
      if (name === 'seekto') { this.gstSeek(Number(args[0]) || 0); return }
      if (name === 'setRate' || name === 'getRate') return name === 'getRate' ? 1 : undefined
      if (name === 'setAudioDeviceType') { log('播放', 'gst: 音频设备由起播参数决定, 运行时忽略'); return }
      if (name === 'setVolume') return undefined
      if (name === 'play') { this.gstPlayAt(Number(args[0]) || 0); return }
      log('播放', 'gst 后端无此方法: ' + name)
    },
    /** 起播 (at=起播位置秒) */
    /**
     * 逻辑矩形 -> waylandsink 的物理坐标.
     * ★ 为什么需要: 真机现象是"视频只显示在上半个屏幕".
     *   物理面板 (DRM 输出) 是 **480x960 竖屏**, 而逻辑 UI 是 960x266 横屏,
     *   Weston 把逻辑画面旋转+平移后合成上去. waylandsink 的 render-rectangle
     *   是在**物理输出空间**里解释的, 直接传逻辑矩形 -> 473 宽几乎占满 480,
     *   266 高只占 960 的 28% -> 表现为"只有上半屏".
     * 变换来自已验证的触摸注入公式 (touchX = displayY + 107, touchY = 959 - displayX):
     *   物理 -> 逻辑: lx = 959 - py , ly = px - 107
     *   逻辑 -> 物理: px = ly + 107 , py = 959 - lx
     * 于是逻辑矩形 (x,y,w,h) 对应物理矩形:
     *   x' = y + 107 , y' = 959 - x - w , w' = h , h' = w
     * 代入 (244,0,473,266) -> (107,242,266,473), 在 480x960 内完全放得下.
     */
    /** @deprecated 已证伪: 见 gstPlayAt 里的说明. 保留备查. */
    toPhys(r) {
      return {
        x: Math.round(r.y) + 107,
        y: 959 - Math.round(r.x) - Math.round(r.w),
        w: Math.round(r.h),
        h: Math.round(r.w)
      }
    },
    gstPlayAt(at) {
      const lr = this.vrect
      // ★★ 回退: **不要**做物理坐标变换.
      //   2026-11-14 我按触摸公式推导了"逻辑->物理"变换并下发 (107,242,266,473),
      //   结果用户报"画面直接没了" —— 说明 waylandsink 的 render-rectangle
      //   就是按**逻辑空间 960x266** 解释的 (物理 y=242 在逻辑空间里已接近出屏,
      //   再加 473 高完全跑出可视区).
      //   教训: 触摸坐标空间 ≠ Wayland surface 坐标空间, 不能直接套用.
      const r = lr
      const bt = this.audioMode === 'bluetooth'
      const dev = bt && this.btDevices.length ? (this.btDevices[0].pcm || ('bluealsa:DEV=' + this.btDevices[0].mac + ',PROFILE=a2dp')) : ''
      this.gstPos = at
      this.gstAt = Date.now()
      gst.start({
        url: this._lastUrl,
        x: r.x, y: r.y, w: r.w, h: r.h,
        startSec: at, audioDevice: dev, btOn: bt, btMs: gst.currentBtMs()
      })
      this.gstStartClock()
      this.opened = true
      this.statusText = ''
      this.playing = true
      this.started = true
      log('播放', '起播(gst) ' + this.bvid + ' 逻辑=' + lr.x + ',' + lr.y + ',' + lr.w + ',' + lr.h + ' 物理=' + r.x + ',' + r.y + ',' + r.w + ',' + r.h)
    },
    /** 跳转: gst-play 用 -s 重启 */
    gstSeek(sec) {
      log('播放', 'gst 跳转到 ' + sec + 's')
      this.gstPlayAt(sec)
    },
    /** 位置推进 (JS 侧计时; 起播/seek/暂停时校准) */
    gstStartClock() {
      this.gstStopClock()
      const self = this
      this.gstAt = Date.now()
      this.gstTimer = setInterval(function () {
        if (!self.playing) return
        let ms = self.gstPos * 1000 + (Date.now() - self.gstAt)
        // ★ 必须 clamp 到总时长: 否则续播位置 + 累加时间会越过 durMs,
        //   真机截图实证过 "1:09 / 1:08" 这种越界显示.
        if (self.durMs > 0 && ms > self.durMs) ms = self.durMs
        self.posMs = ms
        self.curMs = ms
        // ★ 结束判据用**位置到顶**, 不用进程存活 ——
        //   gst-play 播完会停在最后一帧**不退出**, isAlive() 永远为真, 判不到结束.
        if (self.durMs > 0 && ms >= self.durMs) {
          self.playing = false
          self.statusText = '播放结束'
          self.stopPoll()
          self.gstStopClock()
          gst.stop()
          log('播放', 'gst 播放到结尾')
          return
        }
        // 进程真的没了 (被外部杀掉) 也要收尾
        gst.isAlive().then(function (alive) {
          if (!alive && self.playing) {
            self.playing = false
            self.statusText = '播放结束'
            self.stopPoll()
            self.gstStopClock()
            log('播放', 'gst 进程退出')
          }
        })
      }, 1000)
    },
    gstStopClock() { if (this.gstTimer) { clearInterval(this.gstTimer); this.gstTimer = null } },

    /** 把"元素方法名"翻译成 cvplayer 调用 */
    cvCall(name, args) {
      const p = this.cv
      if (!p) return undefined
      if (name === 'setVolume') return undefined          // cvplayer 无音量接口
      if (name === 'seekto') {
        const rr0 = cvCall(p, 'seek', args[0])
        log('cvplayer', 'seek(' + args[0] + ') -> ' + JSON.stringify(rr0))
        return rr0
      }
      const rr = cvCall.apply(null, [p, name].concat(args))
      log('cvplayer', name + '(' + args.join(',') + ') -> ' + JSON.stringify(rr))
      return rr;

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
        this.cid = cid
        // 记下画幅: gst 后端起播前就要算好视频矩形 (它收不到 onInfo)
        if (d.dimension && d.dimension.width > 0) {
          this.dim = d.dimension
          const rr = fitRect(d.dimension.width, d.dimension.height)
          this.vrect = rr
          this.dmAreaW = rr.w
          this.dmAreaH = rr.h
          log('播放', '画幅 ' + d.dimension.width + 'x' + d.dimension.height + ' -> rect ' + rr.x + ',' + rr.y + ',' + rr.w + ',' + rr.h)
        }
        if (!cid) throw new Error('未取到 cid')
        // 取流口: web 口能给出更高的可选档位 (H5 口通常只到 480P), 所以默认走 web;
        // 清晰度用设置里的 defaultQuality, 但不得超过设备解码上限.
        const wantQn = Math.min(Number(getCfg('defaultQuality')) || DEVICE_MAX_QN, DEVICE_MAX_QN)
        // ★ 取流顺序: H5 口优先.
        //   原因: web 口返回的 CDN 地址 (upos-sz-mirror*.bilivideo.com) 会校验 Referer,
        //   而原生播放器不带 Referer 头 -> 直接 "Forbidden" (真机日志实锤).
        //   H5 口 (platform=html5) 的 CDN 不校验 Referer, 原生播放器可以直接播.
        //   代价是档位通常只到 480P —— 但这台设备分辨率就 960x266, 480P 完全够用.
        let p = null
        try {
          p = await playUrl(this.bvid, cid, { source: 'html5', qn: wantQn })
        } catch (e) {
          log('播放', 'H5 口取流失败, 退回 web 口')
        }
        if (!p || !p.url) {
          p = await playUrl(this.bvid, cid, { source: 'web', qn: wantQn })
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
      // ★★ 音频路由必须在**起播之前**下发.
      //   为什么: setAudioDeviceType 会触发元素内部的 rebuildAudio_ (拆掉 ALSA sink
      //   重建). 播放中途重建 = 音频重新起算 = **音画不同步**.
      //   真机日志实证: 13:17:52 起播 -> 13:17:54 才切蓝牙 -> 立刻报
      //   "Could not open audio device" 且画面声音错位.
      //   提前下发 = 建管线时就带上正确的 sink, 不需要重建.
      //   失败只提示, 不中断起播.
      try { await this.applyAudioNow() } catch (e) { log('音频', '起播前下发路由失败: ' + e) }
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
    /** ★ 一次性: 把 <video> 元素的全量方法名打出来.
     *  目的: 确认自定义 libjsapi_gstplayer.so 到底提供了哪些能力 ——
     *  官方 cvplayer 有 setAudioDeviceType(蓝牙热切), 我们之前探到"没有",
     *  但可能只是方法名不同. 列全名再判断, 别再靠猜. */
    /** 播放开始时自动静音: 只在设置打开时压到 0; 关闭则完全不动音量 */
    applyAutoMute() {
      if (getCfg('autoMuteOnStart') !== true) {
        log('音频', '自动静音=关, 不改音量')
        return
      }
      // 元素层音量优先; 没有就退到系统层 hal-audio -s 0
      const r = this.elem('setVolume', 0)
      if (r !== undefined) {
        log('音频', '自动静音=开, 元素音量已置 0')
        this.mutedByAuto = true
        return
      }
      log('音频', '自动静音=开, 但元素无 setVolume; 尝试系统层')
      try {
        audio.applySystemRoute('mute', '')
      } catch (e) { log('音频', '系统层静音失败: ' + e) }
    },

    probeElem() {
      if (this._elemProbed) return
      this._elemProbed = true
      try {
        const v = this.$refs.vv
        if (!v) { log('元素方法探测', '❌ $refs.vv 为空'); return }
        const own = Object.keys(v)
        const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {})
        const fns = own.filter(function (k) { return typeof v[k] === 'function' })
        const nonFn = own.filter(function (k) { return typeof v[k] !== 'function' })
        log('元素方法探测', '自身键(' + own.length + '): ' + own.join(','))
        log('元素方法探测', '函数(' + fns.length + '): ' + fns.join(','))
        log('元素方法探测', '非函数: ' + nonFn.join(','))
        log('元素方法探测', '原型: ' + proto.join(','))
        const want = ['setAudioDeviceType', 'setVolume', 'getVolume', 'setMute', 'mute', 'setRate', 'setSpeed', 'play', 'pause', 'stop', 'seek', 'seekto', 'setDataSource', 'setVideoSurface']
        log('元素方法探测', '关键方法: ' + want.map(function (k) { return k + '=' + (typeof v[k]) }).join(' '))
      } catch (e) { log('元素方法探测', '异常: ' + (e && e.message ? e.message : e)) }
    },

    async prepareAudio() {
      this.probeElem()
      // 播放开始时自动静音 (设置项 autoMuteOnStart).
      // ★ 关掉时**什么都不做** —— 不静音, 正常出声 (用户明确要求).
      this.applyAutoMute()   // 首次进播放页时打一次
      // 0) ★ 音频通路自愈 —— 本机出厂是**整机静音**, 两道闸门都关着:
      //      Playback Path = OFF (card0, numid=45) / aw_dev_0_switch = Disable (card1)
      //    不打开的话 aplay 在跑、PCM state=RUNNING、Master 88%, 扬声器完全无声.
      //    幂等: 已经是 SPK/Enable 就不动 (绝不把用户手选的耳机抢回扬声器).
      try { this.routeState = await ensureAudioRoute() } catch (e) { log('音频', '通路自愈异常: ' + e) }
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
        if (!list.length) { this.audioMode = 'speaker'; this.showTipLocal('没有已连接蓝牙, 用扬声器') }
        else { this.audioMode = 'bluetooth'; this.showTipLocal('蓝牙 ' + list[0].name) }
      } else if (want === 'auto') {
        if (list.length) { this.audioMode = 'bluetooth'; this.showTipLocal('自动·蓝牙 ' + list[0].name) }
        else { this.audioMode = 'speaker'; this.audioMsg = '' }
      } else {
        this.audioMode = 'speaker'; this.audioMsg = ''
      }
      this.btLabel = this.audioMode === 'bluetooth' ? '蓝牙' : '扬声器'
      log('音频', '输出=' + this.audioMode + ' ' + this.audioMsg + ' 已连接蓝牙=' + list.length)
      return this.audioMode
    },
    /**
     * 把当前音频路由真正下发给播放器 (起播后调用).
     * applyAudioRoute 是 async 的 (元素 API 不可用时会落到系统层 hal-audio), 必须 await.
     */
    async applyAudioNow() {
      const bt = (this.audioMode === 'bluetooth' && this.btDevices.length) ? this.btDevices[0] : null
      const mac = bt ? bt.mac : ''
      const pcm = bt ? (bt.pcm || '') : ''
      // ★ 元素必须用 $refs.vv 取 —— 之前写的 this.video 根本不存在,
      //   路由函数一直收到 undefined, 于是每次都落到"没有 setAudioDeviceType"那一支.
      // ★ 后端无关: cvplayer 模式下没有 $refs.vv, 但 cvplayer 实例同样有
      //   setAudioDeviceType —— 把它当作"播放器对象"传下去就行.
      //   否则每次切蓝牙/扬声器都会落到 hal-audio 系统层 (而那条路对蓝牙是 no-op).
      const el = this.cv || this.$refs.vv || null
      let r = await audio.applyAudioRoute(el, this.audioMode, mac, pcm)
      // 记录这一次用的是哪种参数格式, 供 onError 里的回退判断
      if (r && r.ok && r.param) { this.btParamUsed = r.param; this.btParamRetried = false }
      else if (this.audioMode === 'bluetooth') { this.btParamUsed = 'MAC'; this.btParamRetried = false }
      if (!r || !r.ok) {
        // ★ 必须走 showTipLocal: 直接赋值 this.audioMsg 不会设定时器, 提示永不消失
        this.showTipLocal((r && r.msg) ? r.msg : '切换失败')
        log('音频', '路由失败: ' + this.audioMsg)
        // 蓝牙失败就退回扬声器, 不让用户面对无声
        if (this.audioMode === 'bluetooth') {
          this.audioMode = 'speaker'
          this.btLabel = '扬声器'
          await audio.applyAudioRoute(this.$refs.vv || null, 'speaker', '')
        }
      } else {
        // ★ 同理: 真机上"已切换到扬声器"就是卡在这里 —— 直接赋值, 没人清它
        this.showTipLocal(r.msg || '')
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
      const r = await this.applyAudioNow()
      const rm = (r && r.msg) ? r.msg : ''
      this.showTipLocal((r && r.ok) ? ('已切到' + this.btLabel) : rm)
      log('音频', '实时切换 -> ' + this.audioMode + ' ' + rm)
    },
    showTipLocal(t) {
      this.audioMsg = t
      const self = this
      if (this._audioTipT) { try { clearTimeout(this._audioTipT) } catch (e) {} }
      if (t === '') { this.audioMsg = ''; return }
      this._audioTipT = setTimeout(function () { if (self.audioMsg === t) self.audioMsg = '' }, 1800)
    },

    playStream(url, gen) {
      if (gen !== this.genSeq) return
      this.statusText = '缓冲中…'
      this.started = false
      this._applied = false
      this._lastUrl = url
      const self = this
      if (this.cv) {
        // ★ cvplayer 后端: 没有 :src 绑定这回事, 必须显式 setVideoSurface + setDataSource.
        //   顺序要紧: 先给矩形再给数据源, 免得管线先建在默认位置上又挪一次.
        //   ★ 这里**不要**动 this.src —— 它是给 <video> 的 :src 绑定用的.
        //     之前设了, 结果看门狗退回时 src 值没变化, Vue 的 diff 认为无需更新,
        //     元素的 :src 不重新加载 -> 退回后照样卡"缓冲中…"(实测).
        this.syncCVSurface()
        const rd = cvCall(this.cv, 'setDataSource', url)
        log('cvplayer', 'setDataSource(' + String(url).slice(0, 60) + '...) -> ' + JSON.stringify(rd))
        setTimeout(function () {
          if (gen !== self.genSeq) return
          self.elem('play', 0)
          self.opened = true
          self.startPoll()
          screenon.screenOnStart()
          log('播放', '起播(cvplayer) ' + self.bvid)
          // ★★ 看门狗: cvplayer 实例**没有 onError**, 失败是静默的 ——
          //   真机实测过 setVideoSurface/setDataSource/play 全返回 undefined
          //   (原生 void 的正常返回) 却一个事件都不回来, 画面永远卡在"缓冲中…".
          //   所以必须在 N 秒内没等到 onState 时**自动退回 <video>**,
          //   否则用户面对的就是一个不能播的页面.
          self.cvWatchdog(gen)
        }, 600)
        return
      }
      this.src = url
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
      this._cvGotState = true          // 看门狗判据: 收到过状态就说明管线活着
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
          // (音频路由已在起播前下发, 这里不要再调一次 —— 会触发 rebuildAudio_ 造成音画错位)
          // ★ 速率归一 + 探测 (用户提示"把解码速度提到 1x").
          //   为什么值得查: 若管线实际速率不是精确 1.0, 音视频会**持续漂移**,
          //   表现就是"一直对不上"而不是"固定差一点".
          //   setRate 走的是 GStreamer seek (TRICKMODE), 传 1 就是正常速度.
          try {
            const before = this.elem('getRate')
            // 无论设置里选的多少, 先探真实值
            log('播放', '速率探测 getRate=' + before + ' 期望=' + this.rate)
          } catch (e3) { log('播放', '速率探测失败: ' + e3) }
          this.elem('setRate', this.rate)
          const after = this.elem('getRate')
          log('播放', '速率已下发 setRate(' + this.rate + ') -> getRate=' + after)
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
        // 矩形变了要重新告诉原生, 否则画面还按旧位置铺
        this.syncCVSurface()
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
      const raw = e ? JSON.stringify(e) : ''
      log('播放', '元素报错: ' + raw.substring(0, 160))
      // ★ 403 降级: web 口的 CDN 地址 (upos-sz-mirror*.bilivideo.com) 校验 Referer,
      //   而原生播放器不带 Referer 头 -> "Forbidden".
      //   H5 口 (platform=html5) 的 CDN 不校验, 所以被拒时自动退到 H5 重取一次流.
      if (!this.h5Tried && /forbidden|403/i.test(raw)) {
        this.h5Tried = true
        this.statusText = '当前清晰度不可用, 正在切换…'
        log('播放', '被 CDN 拒绝(403), 降到 H5 口重试')
        const self = this
        setTimeout(function () { self.reloadH5() }, 300)
        return
      }
      // ★ 蓝牙参数回退: 元素报错是**事件**不是异常, 所以 applyAudioRoute 里的
      //   try/catch 抓不到 —— 回退只能挂在这里.
      //   真机 2026-11-08: 传完整 ALSA 串 -> {"code":100,"msg":"Could not open
      //   audio device for playback."}; 而 ALSA 侧 aplay 直连同一串是通的,
      //   说明是元素对参数格式的口味问题. 换另一种格式再试一次.
      if (!this.btParamRetried && /could not open audio device/i.test(raw) && this.audioMode === 'bluetooth') {
        this.btParamRetried = true
        const bt = this.btDevices.length ? this.btDevices[0] : null
        if (bt) {
          const alt = (this.btParamUsed === 'MAC') ? String(bt.pcm || '') : String(bt.mac || '')
          if (alt !== '') {
            const altLabel = (this.btParamUsed === 'MAC') ? 'PCM' : 'MAC'
            this.btParamUsed = altLabel
            log('音频', '蓝牙参数回退 [' + altLabel + ']=' + alt)
            try { this.elem('setAudioDeviceType', 4, alt) } catch (e2) { log('音频', '回退调用异常: ' + e2) }
            this.statusText = '正在切换音频输出…'
            return
          }
        }
      }
      this.statusText = '播放出错'
      this.playing = false
      this.stopPoll()
    },

    /** 用 H5 口重新取流 (不校验 Referer) 并起播 */
    async reloadH5() {
      if (!this.bvid || !this.cid) { this.statusText = '播放出错'; return }
      const gen = ++this.genSeq
      try {
        const wantQn = Math.min(Number(getCfg('defaultQuality')) || DEVICE_MAX_QN, DEVICE_MAX_QN)
        const p = await playUrl(this.bvid, this.cid, { source: 'html5', qn: wantQn })
        if (gen !== this.genSeq) return
        this.applyQualities(p)
        if (p.duration > 0) this.durMs = p.duration
        this.playStream(p.url, gen)
      } catch (err) {
        if (gen !== this.genSeq) return
        this.statusText = '播放出错'
        this.playing = false
        log('播放', 'H5 口也失败: ' + (err && err.message ? err.message : err))
      }
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