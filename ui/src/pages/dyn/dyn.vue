<template>
  <div class="dpage">
    <div class="dtop">
      <div class="dback" @click="back">
        <image class="dback-ic" :src="MI.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="dback-t">返回</text>
      </div>
      <text class="dtitle">{{ headTitle }}</text>
      <text v-if="author !== ''" class="dtag">{{ author }}</text>
      <div class="dtop-spacer"></div>
    </div>

    <div class="dstatus" v-if="status !== ''" @click="retry">
      <image class="dstatus-ic" :src="MI.refresh" :style="{ width: '24px', height: '24px' }"></image>
      <text class="dstatus-t">{{ status }}</text>
    </div>

    <scroller v-else class="dscroll" scroll-direction="vertical" :show-scrollbar="true">
      <div class="dwrap">
        <div class="ahead">
          <image v-if="face !== ''" class="aface" :src="face" resize="cover"></image>
          <div v-else class="aface aface-ph"><text class="aface-t">{{ author ? author.charAt(0) : '?' }}</text></div>
          <text class="aname">{{ author }}</text>
          <text class="atime">{{ pubText }}</text>
        </div>

        <!-- 专栏 / 图文全文 (opus/detail): 标题 + 结构化段落 -->
        <template v-if="art">
          <text v-if="art.title !== ''" class="artitle">{{ art.title }}</text>
          <div class="pblock" v-for="(b, bi) in art.blocks" :key="'b' + bi">
            <richtext v-if="b.k === 'text' || b.k === 'quote'" :class="['ptext', b.k === 'quote' ? 'pquote' : '']">
              <template v-for="(seg, si) in b.segs">
                <span v-if="seg.t === 0" :key="'ts' + si">{{ seg.v }}</span>
                <span v-else-if="seg.t === 2" :key="'th' + si" class="phl">{{ seg.v }}</span>
                <image v-else :key="'te' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
              </template>
            </richtext>
            <div v-else-if="b.k === 'pic'" class="pimg" :style="{ width: b.w + 'px', height: b.h + 'px' }" @click="openPic(b)">
              <image class="pimg-i" :src="b.src" resize="cover" :style="{ width: b.w + 'px', height: b.h + 'px' }"></image>
            </div>
            <div v-else-if="b.k === 'list'" class="plist">
              <div class="plist-row" v-for="(r, ri) in b.rows" :key="'lr' + ri">
                <text class="plist-mark">{{ r.mark }}</text>
                <richtext class="plist-txt">
                  <template v-for="(seg, si) in r.segs">
                    <span v-if="seg.t === 0" :key="'ls' + si">{{ seg.v }}</span>
                    <span v-else-if="seg.t === 2" :key="'lh' + si" class="phl">{{ seg.v }}</span>
                    <image v-else :key="'le' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
                  </template>
                </richtext>
              </div>
            </div>
            <text v-else-if="b.k === 'code'" class="pcode">{{ b.text }}</text>
            <div v-else-if="b.k === 'line'" class="pline"></div>
            <div v-else-if="b.k === 'card'" class="pcard"><text class="pcard-t">{{ b.title }}</text></div>
          </div>
        </template>

        <!-- 动态本体: 投稿 / 转发 / 纯文字 / 图文 (没有全文时兜底) -->
        <template v-else>
          <richtext v-if="segs.length > 0" class="ptext">
            <template v-for="(seg, si) in segs">
              <span v-if="seg.t === 0" :key="'ps' + si">{{ seg.v }}</span>
              <span v-else-if="seg.t === 2" :key="'ph' + si" class="phl">{{ seg.v }}</span>
              <image v-else :key="'pe' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
            </template>
          </richtext>
          <div class="pics" v-if="rows.length > 0">
            <div class="pic-row" v-for="(row, ri) in rows" :key="'pr' + ri">
              <div class="pic-box" v-for="(p, pi) in row" :key="'pb' + ri + '_' + pi"
                   :style="{ width: p.w + 'px', height: p.h + 'px' }" @click="openPic(p)">
                <image class="pic-img" :src="p.src" resize="cover"
                       :style="{ width: p.w + 'px', height: p.h + 'px' }"></image>
              </div>
            </div>
          </div>
          <div class="vcard" v-if="archive" @click="openVideo(archive)">
            <image class="vcover" :src="archive.cover" resize="cover"></image>
            <div class="vmeta">
              <text class="vtitle">{{ archive.title }}</text>
              <div class="vstatrow">
                <image class="vstat-ic" :src="MI.play" :style="{ width: '18px', height: '18px' }"></image>
                <text class="vstat">{{ archive.playText + '   ' + archive.duration }}</text>
              </div>
            </div>
          </div>
          <div class="ostat" v-if="orig">
            <text class="olabel">{{ '转发 @' + orig.author }}</text>
            <richtext v-if="orig.segs.length > 0" class="ptext">
              <template v-for="(seg, si) in orig.segs">
                <span v-if="seg.t === 0" :key="'os' + si">{{ seg.v }}</span>
                <span v-else-if="seg.t === 2" :key="'oh' + si" class="phl">{{ seg.v }}</span>
                <image v-else :key="'oe' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
              </template>
            </richtext>
            <div class="pics" v-if="origRows.length > 0">
              <div class="pic-row" v-for="(row, ri) in origRows" :key="'or' + ri">
                <div class="pic-box" v-for="(p, pi) in row" :key="'ob' + ri + '_' + pi"
                     :style="{ width: p.w + 'px', height: p.h + 'px' }" @click="openPic(p)">
                  <image class="pic-img" :src="p.src" resize="cover"
                         :style="{ width: p.w + 'px', height: p.h + 'px' }"></image>
                </div>
              </div>
            </div>
          </div>
        </template>

        <div class="foot" v-if="footStat">
          <image class="foot-ic" :src="MI.thumbup" :style="{ width: '20px', height: '20px' }"></image>
          <text class="foot-t">{{ footStat.like }}</text>
          <image class="foot-ic" :src="MI.comment" :style="{ width: '20px', height: '20px' }"></image>
          <text class="foot-t">{{ footStat.reply }}</text>
          <image class="foot-ic" :src="MI.share" :style="{ width: '20px', height: '20px' }"></image>
          <text class="foot-t">{{ footStat.forward }}</text>
        </div>
      </div>
    </scroller>

    <!-- 图片查看器: 与动态页同款 (手势期轻量图 + 每帧最多写一次 + 静置 260ms 才换原图) -->
    <div v-if="viewer.on" class="iview"
         @touchstart="ivStart" @touchmove="ivMove" @touchend="ivEnd">
      <image class="iview-img" :src="viewer.url" resize="contain" :style="viewerStyle"
             @load="onImgLoad"></image>
      <div v-if="viewer.loading || viewer.err !== ''" class="iv-mask">
        <text class="iv-mask-t">{{ viewer.err !== '' ? viewer.err : '加载中…' }}</text>
      </div>
      <div class="iv-back" @click="ivClose">
        <image class="iv-back-ic" :src="MI.back" :style="{ width: '24px', height: '24px' }"></image>
        <text class="iv-back-t">返回</text>
      </div>
      <div v-if="viewer.hint" class="iv-hint">
        <text class="iv-hint-t">双击后按住上下滑 = 缩放 · 拖动平移</text>
      </div>
      <div class="iv-bar">
        <div class="iv-panel">
          <div class="iv-btn" @click="ivZoomOut"><image :src="MI.minus" :style="{ width: '32px', height: '32px' }"></image></div>
          <div class="iv-pill"><text class="iv-pill-t">{{ viewer.text }}</text></div>
          <div class="iv-btn" @click="ivZoomIn"><image :src="MI.plus" :style="{ width: '32px', height: '32px' }"></image></div>
          <div class="iv-sep"></div>
          <div class="iv-btn iv-btn-wide" @click="ivFit"><text class="iv-btn-t">复位</text></div>
          <text v-if="viewer.sizeText !== ''" class="iv-size">{{ viewer.sizeText }}</text>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { getDynamicDetail, getOpusDetail } from '../../services/bili.js'
import { log } from '../../services/log.js'
import { afterPaint } from '../../base-page.js'
import { bigUrl, viewUrl, clampScale, clampPan, imgStyle as makeImgStyle, VIEW_W, VIEW_H } from '../../services/imageview.js'

// 图标: material-icons-svg 的光栅化产物 (生成器 tools/make-icons.mjs)
const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  refresh: require('../../assets/mi/refresh_30_w.png'),
  play: require('../../assets/mi/play_18_w.png'),
  thumbup: require('../../assets/mi/thumbup_20_m.png'),
  comment: require('../../assets/mi/comment_20_m.png'),
  share: require('../../assets/mi/share_20_m.png'),
  minus: require('../../assets/mi/remove_32_w.png'),
  plus: require('../../assets/mi/add_32_w.png')
}

// 计时器: 组件里没有全局 setTimeout (与 feed.vue / player.vue 同款)
function setTimer(vm, ms, fn) {
  const p = vm.$page
  if (p && p.setTimeout) return p.setTimeout(fn, ms)
  return setTimeout(fn, ms)
}

// 图片按 4 列切行 (与列表页 GRID_CELL=200 对齐)
function chunkRows(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export default {
  name: 'dyn',
  data() {
    return {
      id: '',
      kind: '',
      status: '加载中…',
      art: null,      // 专栏/图文全文 (getOpusDetail)
      item: null,     // 动态本体 (getDynamicDetail)
      segs: [],
      rows: [],
      origRows: [],
      loading: false,
      // 异步世代守卫: 必须声明在 data() 里, 否则 ++undefined=NaN 且 NaN!==NaN 恒真 ->
      // 结果被整段丢弃, loading 永不复位 (0.9.57 动态页「永远加载中」的根因)
      generation: 0,
      viewer: { on: false, url: '', full: '', scale: 1, tx: 0, ty: 0, text: '100%', sizeText: '', err: '', loading: false, hint: false }
    }
  },
  computed: {
    MI() { return MI },
    viewerStyle() { return makeImgStyle(this.viewer.scale, this.viewer.tx, this.viewer.ty) },
    // 顶部标题: 有全文就是专栏, 否则是动态
    headTitle() { return (this.art && this.art.title !== '') ? '专栏' : '动态' },
    author() {
      if (this.art && this.art.author && this.art.author.name) return this.art.author.name
      return this.item ? this.item.author : ''
    },
    face() {
      if (this.art && this.art.author && this.art.author.face) return this.art.author.face
      return this.item ? this.item.face : ''
    },
    pubText() {
      if (this.art && this.art.author && this.art.author.pubText) return this.art.author.pubText
      return this.item ? this.item.pubText : ''
    },
    archive() { return this.item ? this.item.archive : null },
    orig() { return this.item ? this.item.orig : null },
    footStat() {
      if (this.art && this.art.stat) return this.art.stat
      return this.item ? this.item.stat : null
    }
  },
  methods: {
    onShow() {
      try { log('动态详情', 'onShow 到达 started=' + (this._started === true)) } catch (e0) {}
      if (this.$page && !this._newOptionsBound) {
        this._newOptionsBound = true
        const self = this
        this.$page.onNewOptions = function (options) { self.begin(options) }
      }
      if (this._started) return
      this._started = true
      this.begin()
    },
    // 同一页面被 navTo 重新打开时只有 onNewOptions
    onNewOptions(options) { this.begin(options) },
    begin(options) {
      options = options || (this.$page ? this.$page.options : null) || {}
      const id = String(options.id || '')
      this.kind = String(options.kind || '')
      if (!id) { this.status = '缺少动态参数'; return }
      if (id === this.id && this.status === '') return
      this.id = id
      this.item = null
      this.art = null
      this.segs = []
      this.rows = []
      this.origRows = []
      this.load()
    },
    retry() { this.generation++; this.loading = false; this.load() },
    back() { try { this.$page.finish() } catch (e) {} },
    async load() {
      if (this.loading) return
      if (!this.id) return
      this.loading = true
      this.status = '加载中…'
      const self = this
      const gen = ++this.generation
      // 先让「加载中…」画出来再发请求 (bilinet 的同步实现会阻塞 JS 线程)
      afterPaint(async function () {
        try {
          // 1) 动态本体: 所有类型都有 (作者/时间/图/视频卡/转发)
          let it = null
          try {
            it = await getDynamicDetail(self.id)
          } catch (e0) {
            try { log('动态详情', '本体失败: ' + (e0 && e0.message ? e0.message : e0)) } catch (e1) {}
          }
          if (gen !== self.generation) return
          if (it) {
            self.item = it
            self.segs = it.segs || []
            self.rows = chunkRows(it.pics || [], 4)
            self.origRows = it.orig ? chunkRows(it.orig.pics || [], 4) : []
          }
          // 2) 专栏/图文全文: 列表里的字只是摘要 (实测 211 字 + has_more), 全文只在 opus/detail
          let full = null
          try {
            full = await getOpusDetail(self.id)
          } catch (e2) {
            try { log('动态详情', '全文失败: ' + (e2 && e2.message ? e2.message : e2)) } catch (e3) {}
          }
          if (gen !== self.generation) return
          self.art = full
          if (!it && !full) {
            self.status = '这条动态没有可显示的内容'
          } else {
            self.status = ''
            try {
              log('动态详情', '渲染 id=' + self.id + ' 全文=' + (full ? full.blocks.length + '块' : '无') + ' 本体=' + (it ? it.kind : '无'))
            } catch (e4) {}
          }
        } catch (err) {
          if (gen !== self.generation) return
          const msg = err && err.message ? err.message : String(err)
          self.status = msg
          try { log('动态详情', '加载失败 ' + msg) } catch (e5) {}
        } finally {
          if (gen === self.generation) self.loading = false
        }
      })
    },
    openVideo(a) {
      if (!a || !a.bvid) return
      try { $falcon.navTo('page', { bvid: a.bvid, title: a.title }) } catch (e) {}
    },
    openPic(p) { if (p && p.full) this.ivOpen(p.full) },

    // ---------- 图片查看器 (与 feed.vue 同一套实现) ----------
    ivOpen(url) {
      const self = this
      this.viewer.full = bigUrl(url)
      this.viewer.url = viewUrl(url, false)
      this.viewer.scale = 1
      this.viewer.tx = 0
      this.viewer.ty = 0
      this.viewer.text = '100%'
      this.viewer.sizeText = ''
      this.viewer.err = ''
      this.viewer.loading = true
      this.viewer.hint = true
      this.viewer.on = true
      try { log('动态图', '打开 ' + this.viewer.url) } catch (e) {}
      setTimer(this, 4000, function () { self.viewer.hint = false })
      setTimer(this, 8000, function () { self.viewer.loading = false })
    },
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
    ivZoomIn() { this.viewer.hint = false; this.ivZoom(1.25); this.ivScheduleUpgrade() },
    ivZoomOut() { this.viewer.hint = false; this.ivZoom(0.8) },
    ivDouble() {
      if (this.viewer.scale > 1.05) { this.ivFit(); return }
      this.viewer.scale = clampScale(2)
      this.ivApply()
      this.ivScheduleUpgrade()
    },
    ivApply(silent) {
      const p = clampPan({ x: this.viewer.tx, y: this.viewer.ty }, this.viewer.scale)
      const nx = Math.round(p.x)
      const ny = Math.round(p.y)
      if (nx !== this.viewer.tx) this.viewer.tx = nx
      if (ny !== this.viewer.ty) this.viewer.ty = ny
      if (silent) return
      const t = Math.round(this.viewer.scale * 100) + '%'
      if (t !== this.viewer.text) this.viewer.text = t
    },
    // 手势期间样式写入合并成「一帧最多一次」: 逐 move 写 transform 会让合成器边写边扫 -> 果冻
    ivFlush() {
      if (this._ivPend) return
      const self = this
      this._ivPend = true
      setTimer(this, 33, function () {
        self._ivPend = false
        self.ivApply(true)
      })
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
      this.ivLight()
    },
    ivLight() { if (this.viewer.full) this.viewer.url = viewUrl(this.viewer.full, false) },
    ivScheduleUpgrade() {
      const self = this
      if (!this.viewer.full) return
      setTimer(this, 260, function () {
        if (!self.viewer.on) return
        const want = self.viewer.scale >= 2 ? self.viewer.full : viewUrl(self.viewer.full, false)
        if (self.viewer.url === want) return
        self.viewer.url = want
        try { log('图片查看器', '切图 ' + (want === self.viewer.full ? '原图2040' : '轻量1080')) } catch (e0) {}
      })
    },
    ivClose() { this.viewer.on = false },
    txy(e) {
      try {
        const t = (e && e.changedTouches && e.changedTouches[0]) || (e && e.touches && e.touches[0])
        if (t && typeof t.pageY === 'number') return { x: t.pageX, y: t.pageY, ok: true }
      } catch (err) {}
      return { x: 0, y: 0, ok: false }
    },
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
      if (ts.length >= 2) { this._zoomDrag = null; this.startPinch(ts); return }
      this._pinch = null
      const p = this.pt(e)
      if (this._lastTap && Date.now() - this._lastTap < 320 && p.ok) {
        this._zoomDrag = { y: p.y, scale: this.viewer.scale }
        this._lastTap = 0
        this._ix = p.x
        this._iy = p.y
        this.viewer.hint = false
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
    },
    ivMove(e) {
      const ts = this.touchList(e)
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
        this.ivFlush()
        return
      }
      if (this._zoomDrag) {
        const q = this.pt(e)
        if (!q.ok) return
        const dy = this._zoomDrag.y - q.y
        if (Math.abs(dy) > 8) { this._moved = true; this.viewer.hint = false }
        this.viewer.scale = clampScale(this._zoomDrag.scale * Math.exp(dy / 130))
        this.ivFlush()
        return
      }
      if (this._pinch) { this._pinch = null; this._moved = true; return }
      const p = this.pt(e)
      if (!p.ok || this._ix === null || this._ix === undefined) return
      const dx = p.x - this._ix, dy2 = p.y - this._iy
      if (Math.abs(dx) < 1 && Math.abs(dy2) < 1) return
      if (Math.abs(dx) + Math.abs(dy2) > 4) { this._moved = true; this.viewer.hint = false }
      this._ix = p.x; this._iy = p.y
      this.viewer.tx += dx
      this.viewer.ty += dy2
      this.ivFlush()
    },
    ivEnd() {
      this.ivScheduleUpgrade()
      this.ivApply()
      if (this._pinch) { this._pinch = null; this._ix = undefined; this._iy = undefined; this._lastTap = 0; return }
      const moved = this._moved === true
      if (this._zoomDrag) {
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
      if (now - (this._lastTap || 0) < 320) { this._lastTap = 0; this.ivDouble() }
      else this._lastTap = now
    }
  }
}
</script>

<style scoped>
.dpage { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #14161a; }
.dtop { position: absolute; left: 0px; top: 0px; width: 960px; height: 44px; flex-direction: row; align-items: center; background-color: #1b1e24; }
.dback { padding-left: 16px; padding-right: 14px; height: 40px; flex-direction: row; align-items: center; justify-content: center; }
.dback-ic { margin-right: 4px; }
.dback-t { font-size: 21px; color: #cfd5de; }
.dtitle { font-size: 19px; color: #e6eaf0; }
.dtag { font-size: 15px; color: #ffffff; background-color: #2b313a; padding-left: 8px; padding-right: 8px; padding-top: 2px; padding-bottom: 2px; border-radius: 6px; margin-left: 10px; }
.dtop-spacer { flex: 1; }
.dstatus { position: absolute; left: 0px; top: 46px; width: 960px; height: 40px; flex-direction: row; justify-content: center; align-items: center; }
.dstatus-ic { margin-right: 6px; }
.dstatus-t { font-size: 17px; color: #8a93a0; }
.dscroll { position: absolute; left: 0px; top: 46px; width: 960px; height: 220px; }
.dwrap { padding-left: 40px; padding-right: 40px; padding-bottom: 16px; }
.ahead { flex-direction: row; align-items: center; margin-top: 8px; }
.aface { width: 40px; height: 40px; border-radius: 20px; margin-right: 10px; background-color: #232830; }
.aface-ph { justify-content: center; align-items: center; }
.aface-t { font-size: 18px; color: #7c8592; }
.aname { font-size: 18px; color: #8fb8ff; }
.atime { font-size: 15px; color: #7c8592; margin-left: 10px; }
.artitle { font-size: 26px; color: #ffffff; margin-top: 10px; lines: 4; }
.pblock { margin-top: 8px; }
.ptext { font-size: 19px; color: #dfe4ea; }
.pquote { font-size: 19px; color: #aab2bd; padding-left: 14px; background-color: #1a1d22; border-radius: 8px; padding-top: 6px; padding-bottom: 6px; }
.phl { color: #8fb8ff; }
.pimg { border-radius: 10px; background-color: #232830; margin-top: 4px; }
.pimg-i { border-radius: 10px; }
.plist-row { flex-direction: row; margin-top: 4px; }
.plist-mark { font-size: 19px; color: #8fb8ff; margin-right: 6px; }
.plist-txt { font-size: 19px; color: #dfe4ea; }
.pcode { font-size: 17px; color: #cfe0ff; background-color: #1a1d22; padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px; border-radius: 8px; }
.pline { height: 2px; background-color: #2b313a; margin-top: 10px; margin-bottom: 4px; }
.pcard { padding: 8px; background-color: #262b33; border-radius: 8px; }
.pcard-t { font-size: 17px; color: #8fb8ff; }
.pics { margin-top: 6px; }
.pic-row { flex-direction: row; }
.pic-box { margin-right: 6px; margin-bottom: 6px; border-radius: 8px; background-color: #232830; }
.pic-img { border-radius: 8px; }
.vcard { flex-direction: row; margin-top: 8px; padding: 8px; background-color: #262b33; border-radius: 8px; }
.vcover { width: 160px; height: 100px; border-radius: 6px; margin-right: 10px; }
.vmeta { flex: 1; }
.vtitle { font-size: 18px; color: #ffffff; lines: 2; }
.vstatrow { flex-direction: row; align-items: center; margin-top: 6px; }
.vstat-ic { margin-right: 4px; }
.vstat { font-size: 16px; color: #888888; }
.ostat { margin-top: 8px; padding: 8px; background-color: #1a1d22; border-radius: 8px; }
.olabel { font-size: 17px; color: #8fb8ff; }
.foot { flex-direction: row; align-items: center; margin-top: 12px; }
.foot-ic { margin-right: 6px; }
.foot-t { font-size: 16px; color: #9aa3af; margin-right: 18px; }
.iview { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #05070a; z-index: 200; }
.iview-img { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; }
.iv-mask { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; justify-content: center; align-items: center; }
.iv-mask-t { font-size: 19px; color: #e6eaf0; background-color: rgba(0,0,0,0.62); padding-left: 20px; padding-right: 20px; padding-top: 8px; padding-bottom: 8px; border-radius: 18px; }
.iv-back { position: absolute; left: 14px; top: 12px; height: 40px; padding-left: 14px; padding-right: 20px; border-radius: 20px; background-color: rgba(0,0,0,0.62); flex-direction: row; justify-content: center; align-items: center; }
.iv-back-ic { margin-right: 4px; }
.iv-back-t { font-size: 19px; color: #ffffff; }
.iv-hint { position: absolute; left: 0px; bottom: 68px; width: 960px; flex-direction: column; align-items: center; }
.iv-hint-t { font-size: 16px; color: #ffffff; background-color: rgba(0,0,0,0.62); padding-left: 16px; padding-right: 16px; padding-top: 6px; padding-bottom: 6px; border-radius: 16px; }
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
