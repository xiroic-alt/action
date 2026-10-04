<template>
  <div class="cpage">
    <!-- 顶栏: 返回 + 标题 + 评论数 -->
    <div class="ctop">
      <div class="cback" @click="back"><text class="cback-t">‹ 返回</text></div>
      <text class="ctitle">{{ title || '评论' }}</text>
      <text class="ccount">{{ total > 0 ? total : '' }}</text>
    </div>

    <scroller class="cscroll" scroll-direction="vertical" :show-scrollbar="true"
             :over-scroll="40"
             @scroll="onScroll">
      <div class="cwrap">
        <div class="status" v-if="status !== ''">{{ status }}</div>
        <div class="sortbar">
          <div :class="['sort-item', sortMode === 'hot' ? 'sort-on' : '']" @click="setSort('hot')">
            <text :class="['sort-text', sortMode === 'hot' ? 'sort-text-on' : '']">热度</text>
          </div>
          <div :class="['sort-item', sortMode === 'time' ? 'sort-on' : '']" @click="setSort('time')">
            <text :class="['sort-text', sortMode === 'time' ? 'sort-text-on' : '']">最新</text>
          </div>
        </div>

        <div class="reply" v-for="(r, ri) in replies" :key="r.rpid">
          <image v-if="r.face" class="face" :src="r.face" resize="cover" @click="openUser(r)"></image>
          <div class="rbody">
            <div class="rhead">
              <text class="rauthor" @click="openUser(r)">{{ r.author }}</text>
              <text v-if="r.pinned" class="tag tag-pin">置顶</text>
              <text v-if="r.isUp" class="tag tag-up">UP主</text>
              <text class="rtime">{{ r.timeText }}</text>
            </div>
            <div class="rwrap">
              <richtext :class="['rmsg', r.expanded ? 'rmsg-open' : '']" @click="toggle(r)">
                <template v-for="(seg, si) in r.segs">
                  <span v-if="seg.t === 0" :key="'s' + si">{{ seg.v }}</span>
                  <image v-else :key="'e' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
                </template>
              </richtext>
              <text v-if="!r.expanded && r.long" class="rmore" @click="toggle(r)">…</text>
            </div>
            <div v-if="r.pics && r.pics.length" class="pics">
              <div v-for="(pic, pi) in r.pics" :key="'pb' + pi" class="pic-box"
                   :style="{ width: pic.w + 'px', height: pic.h + 'px' }" @click="openPicAt(r, pi)">
                <image class="pic" :src="pic.src" @click="openPicAt(r, pi)"
                       :style="{ width: pic.w + 'px', height: pic.h + 'px' }" resize="cover"></image>
              </div>
            </div>
            <div class="rmeta">
              <div class="mbtn" @click="like(r)">
                <text :class="['mtext', r.liked ? 'mliked' : '']">赞 {{ r.likeText }}{{ r.liked ? ' ✓' : '' }}</text>
              </div>
              <div class="mbtn" @click="openSub(r)">
                <text class="mreply">回复 {{ r.replyCount }}</text>
              </div>
              <div v-if="r.pics && r.pics.length" class="mbtn" @click="openPic(r)">
                <text class="mpic">图 {{ r.pics.length }}</text>
              </div>
            </div>
          </div>
        </div>

        <div class="loadmore" v-if="replies.length > 0" @click="loadMore">
          <text class="loadmore-t">{{ loading ? '加载中…' : '加载更多评论' }}</text>
        </div>
        <div class="empty" v-if="!loading && replies.length === 0">
          <text class="empty-t">{{ status || '还没有评论' }}</text>
        </div>
      </div>
    </scroller>


    <!-- 图片查看器: 纯黑底 + 居中悬浮工具栏; 缩放/平移走 CSS transform (实测本机 <image> 支持) -->
    <div v-if="viewer.on" class="iview"
         @touchstart="ivStart" @touchmove="ivMove" @touchend="ivEnd">
      <image class="iview-img" :src="viewer.url" resize="contain" :style="viewerStyle"
             @load="onImgLoad"></image>

      <!-- 加载态 / 失败态 -->
      <div v-if="viewer.loading || viewer.err !== ''" class="iv-mask">
        <text class="iv-mask-t">{{ viewer.err !== '' ? viewer.err : '加载中…' }}</text>
      </div>

      <!-- 右上角关闭 (不用去底部栏找) -->
      <!-- 左上角返回/关闭: 用与应用内一致的「‹ 返回」(✕ 字形本机字体没有, 显示为空白); 深色胶囊白底也看得清 -->
      <div class="iv-back" @click="ivClose"><text class="iv-back-t">‹ 返回</text></div>

      <!-- 首次提示, 4 秒后自动消失 -->
      <div v-if="viewer.hint" class="iv-hint">
        <text class="iv-hint-t">双击后按住上下滑 = 缩放 · 拖动平移</text>
      </div>

      <!-- 底部悬浮工具栏 -->
      <div class="iv-bar">
        <div class="iv-panel">
          <div class="iv-btn" @click="ivZoomOut"><text class="iv-btn-t">-</text></div>
          <div class="iv-pill"><text class="iv-pill-t">{{ viewer.text }}</text></div>
          <div class="iv-btn" @click="ivZoomIn"><text class="iv-btn-t">+</text></div>
          <div class="iv-sep"></div>
          <div class="iv-btn iv-btn-wide" @click="ivFit"><text class="iv-btn-t">复位</text></div>
          <text v-if="viewer.sizeText !== ''" class="iv-size">{{ viewer.sizeText }}</text>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { getReplies, likeReply, addReply } from '../../services/bili.js'
import { log } from '../../services/log.js'
import { bigUrl, clampScale, clampPan, imgStyle as makeImgStyle, VIEW_W, VIEW_H } from '../../services/imageview.js'

// 计时器: 优先用页面实例的 setTimeout (本运行时组件里不保证有全局 setTimeout) —— 与 player.vue 同款
function setTimer(vm, ms, fn) {
  const p = vm.$page
  if (p && p.setTimeout) return p.setTimeout(fn, ms)
  return setTimeout(fn, ms)
}


const BUILTIN_EMOJI = {
'1f197': require('../../assets/emoji/1f197.png'),
'1f338': require('../../assets/emoji/1f338.png'),
'1f339': require('../../assets/emoji/1f339.png'),
'1f349': require('../../assets/emoji/1f349.png'),
'1f34b': require('../../assets/emoji/1f34b.png'),
'1f35a': require('../../assets/emoji/1f35a.png'),
'1f37a': require('../../assets/emoji/1f37a.png'),
'1f381': require('../../assets/emoji/1f381.png'),
'1f382': require('../../assets/emoji/1f382.png'),
'1f389': require('../../assets/emoji/1f389.png'),
'1f414': require('../../assets/emoji/1f414.png'),
'1f42e': require('../../assets/emoji/1f42e.png'),
'1f431': require('../../assets/emoji/1f431.png'),
'1f436': require('../../assets/emoji/1f436.png'),
'1f437': require('../../assets/emoji/1f437.png'),
'1f440': require('../../assets/emoji/1f440.png'),
'1f446': require('../../assets/emoji/1f446.png'),
'1f448': require('../../assets/emoji/1f448.png'),
'1f449': require('../../assets/emoji/1f449.png'),
'1f44d': require('../../assets/emoji/1f44d.png'),
'1f44e': require('../../assets/emoji/1f44e.png'),
'1f44f': require('../../assets/emoji/1f44f.png'),
'1f451': require('../../assets/emoji/1f451.png'),
'1f47b': require('../../assets/emoji/1f47b.png'),
'1f480': require('../../assets/emoji/1f480.png'),
'1f494': require('../../assets/emoji/1f494.png'),
'1f495': require('../../assets/emoji/1f495.png'),
'1f496': require('../../assets/emoji/1f496.png'),
'1f497': require('../../assets/emoji/1f497.png'),
'1f498': require('../../assets/emoji/1f498.png'),
'1f4a9': require('../../assets/emoji/1f4a9.png'),
'1f4aa': require('../../assets/emoji/1f4aa.png'),
'1f4ac': require('../../assets/emoji/1f4ac.png'),
'1f4af': require('../../assets/emoji/1f4af.png'),
'1f525': require('../../assets/emoji/1f525.png'),
'1f600': require('../../assets/emoji/1f600.png'),
'1f602': require('../../assets/emoji/1f602.png'),
'1f604': require('../../assets/emoji/1f604.png'),
'1f605': require('../../assets/emoji/1f605.png'),
'1f606': require('../../assets/emoji/1f606.png'),
'1f607': require('../../assets/emoji/1f607.png'),
'1f609': require('../../assets/emoji/1f609.png'),
'1f60a': require('../../assets/emoji/1f60a.png'),
'1f60d': require('../../assets/emoji/1f60d.png'),
'1f60f': require('../../assets/emoji/1f60f.png'),
'1f612': require('../../assets/emoji/1f612.png'),
'1f618': require('../../assets/emoji/1f618.png'),
'1f61c': require('../../assets/emoji/1f61c.png'),
'1f621': require('../../assets/emoji/1f621.png'),
'1f622': require('../../assets/emoji/1f622.png'),
'1f629': require('../../assets/emoji/1f629.png'),
'1f62a': require('../../assets/emoji/1f62a.png'),
'1f62d': require('../../assets/emoji/1f62d.png'),
'1f631': require('../../assets/emoji/1f631.png'),
'1f633': require('../../assets/emoji/1f633.png'),
'1f634': require('../../assets/emoji/1f634.png'),
'1f644': require('../../assets/emoji/1f644.png'),
'1f64f': require('../../assets/emoji/1f64f.png'),
'1f914': require('../../assets/emoji/1f914.png'),
'1f917': require('../../assets/emoji/1f917.png'),
'1f91d': require('../../assets/emoji/1f91d.png'),
'1f921': require('../../assets/emoji/1f921.png'),
'1f923': require('../../assets/emoji/1f923.png'),
'1f92c': require('../../assets/emoji/1f92c.png'),
'1f970': require('../../assets/emoji/1f970.png'),
'1f973': require('../../assets/emoji/1f973.png'),
'1f976': require('../../assets/emoji/1f976.png'),
'1f97a': require('../../assets/emoji/1f97a.png'),
'2615': require('../../assets/emoji/2615.png'),
'2705': require('../../assets/emoji/2705.png'),
'2728': require('../../assets/emoji/2728.png'),
'274c': require('../../assets/emoji/274c.png'),
'2753': require('../../assets/emoji/2753.png'),
'2764': require('../../assets/emoji/2764.png'),
}
var PULL_DY = 55

export default {
  data() {
    return {
      aid: '',
      title: '',
      total: 0,
      pn: 1,
      sortMode: 'hot',
      replies: [],
      loading: false,
      status: '加载中…',
      draft: '',
      posting: false,
      scrollY: 0,
      viewer: { on: false, url: '', scale: 1, tx: 0, ty: 0, text: '100%', sizeText: '', err: '', loading: false, hint: false }
    }
  },
  // 生命周期: 本运行时 BasePage 只把 onShow/onHide/onUnload 转发给页面根组件($root),
  // onLoad(options) 只落在 Page 实例上 —— 组件里写 onLoad/created 都不会执行(0.9.52/0.9.53 卡「加载中」的真因).
  computed: {
    // 缩放/平移全部交给 CSS transform (本机固件实测 <image> 支持 scale/translate)
    viewerStyle() { return makeImgStyle(this.viewer.scale, this.viewer.tx, this.viewer.ty) }
  },
  methods: {
    onShow() {
      if (this.$page && !this._newOptionsBound) {
        this._newOptionsBound = true
        const self = this
        this.$page.onNewOptions = function (o) { self.applyOptions(o) }
      }
      this.applyOptions((this.$page && this.$page.options) || {})
    },
    applyOptions(o) {
      o = o || {}
      this.aid = String(o.aid || this.aid || '')
      this.title = o.title ? ('评论 · ' + o.title) : (this.title || '评论')
      this.total = Number(o.total || this.total || 0)
      if (!this.aid) { this.status = '缺少稿件参数'; return }
      if (this._started) return
      this._started = true
      try { log('评论页', '打开 aid=' + this.aid) } catch (e) {}
      this.load(true)
    },
    back() { try { this.$page.finish() } catch (e) {} },
    async load(reset, fresh) {
      if (!this.aid || this.loading) return
      this.loading = true
      if (reset) { this.pn = 1; this.status = '加载中…' }
      try {
        const r = await getReplies(this.aid, this.pn, BUILTIN_EMOJI, this.sortMode, fresh)
        if (reset) this.replies = []
        const seen = {}
        for (let i = 0; i < this.replies.length; i++) seen[this.replies[i].rpid] = true
        for (let i = 0; i < r.replies.length; i++) {
          const it = r.replies[i]
          if (seen[it.rpid]) continue
          it.expanded = false
          this.replies.push(it)
          seen[it.rpid] = true
        }
        this.total = r.total || this.total
        this.status = this.replies.length === 0 ? '还没有评论' : ''
        try { log('评论页', '加载完成 ' + this.replies.length + ' 条 (total=' + this.total + ')') } catch (e) {}
      } catch (e) {
        this.status = (e && e.message) ? e.message : String(e)
        try { log('评论页', '加载失败 ' + this.status) } catch (e) {}
      } finally {
        this.loading = false
      }
    },
    setSort(m) { if (m === this.sortMode) return; this.sortMode = m; this.load(true, true) },
    loadMore() { if (this.loading) return; this.pn = this.pn + 1; this.load(false) },
    onScroll(e) { try { const c = e && e.contentOffset; if (c) this.scrollY = c.y || 0 } catch (err) {} },
    toggle(r) { r.expanded = !r.expanded },
    async like(r) {
      if (this._likeBusy) return
      this._likeBusy = true
      const want = !r.liked
      try {
        await likeReply(this.aid, r.rpid, want)
        r.liked = want
        r.likeText = String(want ? (parseInt(r.likeText || '0', 10) || 0) + 1 : Math.max(0, (parseInt(r.likeText || '0', 10) || 0) - 1))
      } catch (e) { this.status = (e && e.message) ? e.message : '点赞失败' }
      this._likeBusy = false
    },
    openUser(r) { if (r.mid) { try { $falcon.navTo('up', { mid: String(r.mid), name: r.author }) } catch (e) {} } },
    openSub(r) { try { $falcon.navTo('subreply', { aid: this.aid, root: String(r.rpid), count: String(r.replyCount || 0), msg: r.message || '', author: r.author }) } catch (e) {} },
    openPic(r) { if (r.pics && r.pics.length) this.ivOpen(r.pics[0].src) },
    // 点评论里的图 -> 独立图片查看器 (原来 <image> 上没有点击处理, 命中区为 0, 所以「点不开照片」)
    openPicAt(r, i) { if (r.pics && r.pics[i]) this.ivOpen(r.pics[i].src) },
    onInput(e) { try { this.draft = e.detail && e.detail.value !== undefined ? e.detail.value : (e.target && e.target.value) || '' } catch (err) {} },
    // 打开: 只把大图 URL 交给 <image resize="contain">, 缩放/平移全用 transform (不落盘, 不阻塞)
    ivOpen(url) {
      const self = this
      this.viewer.url = bigUrl(url)
      this.viewer.scale = 1
      this.viewer.tx = 0
      this.viewer.ty = 0
      this.viewer.text = '100%'
      this.viewer.sizeText = ''
      this.viewer.err = ''
      this.viewer.loading = true
      this.viewer.hint = true
      this.viewer.on = true
      try { log('图片查看器', '打开 ' + this.viewer.url) } catch (e) {}
      setTimer(this, 4000, function () { self.viewer.hint = false })      // 提示自动消失
      setTimer(this, 8000, function () { self.viewer.loading = false })   // load 没回来也别一直转
    },
    // <image> 的 load 事件: 拿到 success / size -> 关掉加载态 + 显示原图尺寸
    onImgLoad(e) {
      const d = (e && e.detail) || {}
      this.viewer.loading = false
      if (d.success === false) { this.viewer.err = '图片加载失败'; return }
      this.viewer.err = ''
      const s = d.size || {}
      const w = s.width || s.w || s.imgWidth || 0
      const h = s.height || s.h || s.imgHeight || 0
      if (w && h) this.viewer.sizeText = w + '×' + h
    },
    ivZoomIn() { this.viewer.hint = false; this.ivZoom(1.25) },
    ivZoomOut() { this.viewer.hint = false; this.ivZoom(0.8) },
    // 双击: 100% <-> 200%
    ivDouble() {
      if (this.viewer.scale > 1.05) { this.ivFit(); return }
      this.viewer.scale = clampScale(2)
      this.ivApply()
    },
    ivApply() {
      const p = clampPan({ x: this.viewer.tx, y: this.viewer.ty }, this.viewer.scale)
      this.viewer.tx = p.x
      this.viewer.ty = p.y
      this.viewer.text = Math.round(this.viewer.scale * 100) + '%'
    },
    ivZoom(f) {
      this.viewer.scale = clampScale(this.viewer.scale * f)
      this.ivApply()
    },
    ivFit() {
      this.viewer.scale = 1
      this.viewer.tx = 0
      this.viewer.ty = 0
      this.viewer.text = '100%'
      this.viewer.hint = false
    },
    ivClose() { this.viewer.on = false },
    txy(e) {
      try {
        const t = (e && e.changedTouches && e.changedTouches[0]) || (e && e.touches && e.touches[0])
        if (t && typeof t.pageY === 'number') return { x: t.pageX, y: t.pageY, ok: true }
      } catch (err) {}
      return { x: 0, y: 0, ok: false }
    },
    // 触点列表: <image>/div 的 touch 事件里 touches[] 才是当前所有手指(changedTouches 只有变化的那根)
    // 触点: 实测本机运行时 e.touches 不存在(touches=0), 只给 changedTouches -> 三种形态都兼容
    touchList(e) {
      const out = []
      const push = function (arr) {
        if (!arr) return
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] && typeof arr[i].pageY === 'number') out.push({ pageX: arr[i].pageX, pageY: arr[i].pageY })
        }
      }
      try {
        const d = (e && e.detail) || null
        push(e && e.touches)
        if (out.length === 0) push(e && e.changedTouches)
        if (out.length === 0 && d) push(d.touches)
        if (out.length === 0 && d) push(d.changedTouches)
      } catch (err) {}
      return out
    },
    pt(e) {
      const ts = this.touchList(e)
      if (ts.length) return { x: ts[0].pageX, y: ts[0].pageY, ok: true }
      return this.txy(e)
    },
    pinchDist(ts) { const dx = ts[0].pageX - ts[1].pageX; const dy = ts[0].pageY - ts[1].pageY; return Math.sqrt(dx * dx + dy * dy) || 1 },
    ivStart(e) {
      this._moved = false
      const ts = this.touchList(e)
      // 只记前几次原始结构, 用来确认运行时到底下发什么(本机实测 e.touches 不存在)
      this._diag = (this._diag || 0) + 1
      if (this._diag <= 4) {
        try {
          const d = (e && e.detail) || {}
          log('图片查看器', 'evt keys=' + Object.keys(e || {}).join(',') + ' | detail keys=' + Object.keys(d).join(',')
            + ' | touches=' + ((e && e.touches && e.touches.length) || 0)
            + ' changed=' + ((e && e.changedTouches && e.changedTouches.length) || 0)
            + ' d.touches=' + ((d.touches && d.touches.length) || 0))
        } catch (e0) {}
      }
      if (ts.length >= 2) { this._zoomDrag = null; this.startPinch(ts); return }
      this._pinch = null
      const p = this.pt(e)
      // 双击之后紧接的一次按住 -> 竖直拖动连续缩放(本机不支持双指, 用这个替代捏合)
      if (this._lastTap && Date.now() - this._lastTap < 320 && p.ok) {
        this._zoomDrag = { y: p.y, scale: this.viewer.scale }
        this._lastTap = 0
        this._ix = p.x
        this._iy = p.y
        this.viewer.hint = false
        try { log('图片查看器', '进入上下滑缩放 scale=' + this.viewer.scale) } catch (e0) {}
        return
      }
      this._zoomDrag = null
      this._ix = p.ok ? p.x : null
      this._iy = p.ok ? p.y : null
    },
    startPinch(ts) {
      const mx = (ts[0].pageX + ts[1].pageX) / 2
      const my = (ts[0].pageY + ts[1].pageY) / 2
      this._pinch = { d: this.pinchDist(ts), mx: mx, my: my, scale: this.viewer.scale, tx: this.viewer.tx, ty: this.viewer.ty }
      this._ix = null
      this._iy = null
      this.viewer.hint = false
      try { log('图片查看器', '开始双指缩放 d=' + Math.round(this._pinch.d) + ' scale=' + this.viewer.scale) } catch (e0) {}
    },
    ivMove(e) {
      const ts = this.touchList(e)
      // ---- 双指捏合缩放 (两指间距比例 = 缩放比例; 焦点跟随两指中点, 手感才对) ----
      if (ts.length >= 2) {
        if (!this._pinch) { this.startPinch(ts); return }
        const f = this.pinchDist(ts) / (this._pinch.d || 1)
        const s2 = clampScale(this._pinch.scale * f)
        const k = s2 / (this._pinch.scale || 1)
        const mx = (ts[0].pageX + ts[1].pageX) / 2
        const my = (ts[0].pageY + ts[1].pageY) / 2
        const cx = VIEW_W / 2
        const cy = VIEW_H / 2
        this.viewer.scale = s2
        this.viewer.tx = mx - cx - (this._pinch.mx - cx - this._pinch.tx) * k
        this.viewer.ty = my - cy - (this._pinch.my - cy - this._pinch.ty) * k
        this._moved = true
        this.ivApply()
        return
      }
      // ---- 双击后按住上下滑: 连续缩放 (单指可用, 替代双指捏合) ----
      if (this._zoomDrag) {
        const q = this.pt(e)
        if (!q.ok) return
        const dy = this._zoomDrag.y - q.y
        if (Math.abs(dy) > 8) { this._moved = true; this.viewer.hint = false }
        this.viewer.scale = clampScale(this._zoomDrag.scale * Math.exp(dy / 130))
        this.ivApply()
        return
      }
      // ---- 单指拖动平移 ----
      if (this._pinch) { this._pinch = null; this._moved = true; return }
      const p = this.pt(e)
      if (!p.ok || this._ix === null || this._ix === undefined) return
      const dx = p.x - this._ix, dy = p.y - this._iy
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      if (Math.abs(dx) + Math.abs(dy) > 4) { this._moved = true; this.viewer.hint = false }
      this._ix = p.x; this._iy = p.y
      this.viewer.tx += dx
      this.viewer.ty += dy
      this.ivApply()
    },
    ivEnd() {
      if (this._pinch) { this._pinch = null; this._ix = undefined; this._iy = undefined; this._lastTap = 0; return }
      const moved = this._moved === true
      if (this._zoomDrag) {
        // 按住了但没滑 -> 就是普通双击(100% <-> 200%); 滑过了 -> 保持当前倍率
        const wasDrag = moved
        this._zoomDrag = null
        this._ix = undefined
        this._iy = undefined
        this._moved = false
        if (!wasDrag) this.ivDouble()
        return
      }
      const now = Date.now()
      this._ix = undefined
      this._iy = undefined
      this._moved = false
      if (moved) { this._lastTap = 0; return }
      // 320ms 内第二次轻点 = 双击 (放大/还原)
      if (now - (this._lastTap || 0) < 320) { this._lastTap = 0; this.ivDouble() }
      else this._lastTap = now
    }
  }
}
</script>

<style scoped>
.cpage { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #14161a; }
.ctop { position: absolute; left: 0px; top: 0px; width: 960px; height: 44px; flex-direction: row; align-items: center; background-color: #1b1e24; }
.cback { padding-left: 16px; padding-right: 16px; height: 40px; justify-content: center; }
.cback-t { font-size: 21px; color: #cfd5de; }
.ctitle { font-size: 19px; color: #e6eaf0; flex: 1; lines: 1; overflow: hidden; }
.ccount { font-size: 17px; color: #fb7299; padding-right: 18px; }
.cscroll { position: absolute; left: 0px; top: 44px; width: 960px; height: 178px; }
.cwrap { padding-left: 14px; padding-right: 14px; padding-bottom: 10px; }
.status { font-size: 17px; color: #8a93a0; text-align: center; padding-top: 14px; padding-bottom: 8px; }
.sortbar { flex-direction: row; margin-top: 6px; margin-bottom: 6px; }
.sort-item { padding-left: 14px; padding-right: 14px; height: 28px; border-radius: 6px; margin-right: 10px; background-color: #232830; justify-content: center; }
.sort-on { background-color: #fb7299; }
.sort-text { font-size: 17px; color: #aab2bd; }
.sort-text-on { color: #ffffff; }
.reply { flex-direction: row; padding-top: 8px; padding-bottom: 8px; }
.face { width: 44px; height: 44px; border-radius: 22px; margin-right: 10px; background-color: #232830; }
.rbody { flex: 1; }
.rhead { flex-direction: row; align-items: center; }
.rauthor { font-size: 18px; color: #8fb8ff; lines: 1; }
.rtime { font-size: 15px; color: #7c8592; margin-left: 10px; }
.tag { font-size: 15px; padding-left: 8px; padding-right: 8px; padding-top: 2px; padding-bottom: 2px; border-radius: 6px; margin-left: 8px; justify-content: center; }
.tag-pin { background-color: #fb7299; color: #ffffff; }
.tag-up { background-color: #2f80ed; color: #ffffff; }
.rwrap { position: relative; margin-top: 2px; }
.rmsg { font-size: 19px; color: #dfe4ea; lines: 3; }
.rmsg-open { lines: 99; }
.rmore { position: absolute; right: 0px; bottom: 0px; font-size: 19px; color: #8fb8ff; background-color: #14161a; }
.pics { flex-direction: row; margin-top: 6px; }
.pic-box { margin-right: 8px; border-radius: 8px; background-color: #232830; }
.pic { border-radius: 8px; }
.rmeta { flex-direction: row; align-items: center; margin-top: 4px; }
.mbtn { padding-top: 8px; padding-bottom: 8px; padding-right: 20px; }
.mtext { font-size: 16px; color: #9aa3af; }
.mliked { color: #fb7299; }
.mreply { font-size: 16px; color: #9aa3af; padding-top: 6px; padding-bottom: 6px; margin-right: 20px; }
.mpic { font-size: 16px; color: #fb7299; background-color: #2b2f36; padding-left: 12px; padding-right: 12px; padding-top: 3px; padding-bottom: 3px; border-radius: 6px; }
.loadmore { height: 40px; justify-content: center; }
.loadmore-t { font-size: 17px; color: #8fb8ff; }
.empty { margin-top: 20px; justify-content: center; }
.empty-t { font-size: 18px; color: #8a93a0; }
/* ---------- 图片查看器 (纯黑底 + 悬浮工具栏) ---------- */
.iview { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #05070a; z-index: 200; }
.iview-img { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; }
.iv-mask { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; justify-content: center; align-items: center; }
.iv-mask-t { font-size: 19px; color: #e6eaf0; background-color: rgba(0,0,0,0.62); padding-left: 20px; padding-right: 20px; padding-top: 8px; padding-bottom: 8px; border-radius: 18px; }
.iv-back { position: absolute; left: 14px; top: 12px; height: 40px; padding-left: 16px; padding-right: 20px; border-radius: 20px; background-color: rgba(0,0,0,0.62); flex-direction: row; justify-content: center; align-items: center; }
.iv-back-t { font-size: 19px; color: #ffffff; }
.iv-hint { position: absolute; left: 0px; bottom: 68px; width: 960px; flex-direction: column; align-items: center; }
.iv-hint-t { font-size: 16px; color: #ffffff; background-color: rgba(0,0,0,0.62); padding-left: 16px; padding-right: 16px; padding-top: 6px; padding-bottom: 6px; border-radius: 16px; }
/* 工具栏: 深色面板打底 —— 白底照片上白半透明按钮会看不见(实测反馈), 全部改成深底浅字 */
.iv-bar { position: absolute; left: 0px; bottom: 12px; width: 960px; flex-direction: row; justify-content: center; align-items: center; }
.iv-panel { flex-direction: row; justify-content: center; align-items: center; padding-left: 10px; padding-right: 14px; padding-top: 6px; padding-bottom: 6px; border-radius: 20px; background-color: rgba(0,0,0,0.70); }
.iv-btn { width: 62px; height: 40px; margin-right: 8px; border-radius: 12px; background-color: rgba(255,255,255,0.22); flex-direction: row; justify-content: center; align-items: center; }
.iv-btn-wide { width: 88px; }
.iv-btn-t { font-size: 26px; color: #ffffff; }
.iv-pill { height: 40px; padding-left: 18px; padding-right: 18px; margin-right: 8px; border-radius: 12px; background-color: #fb7299; flex-direction: row; justify-content: center; align-items: center; }
.iv-pill-t { font-size: 20px; color: #ffffff; }
.iv-sep { width: 1px; height: 26px; background-color: rgba(255,255,255,0.30); margin-right: 8px; }
.iv-size { font-size: 16px; color: rgba(255,255,255,0.72); margin-left: 4px; }
</style>
