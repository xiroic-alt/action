<template>
  <div class="fpage">
    <div class="ftop">
      <div class="fback" @click="back"><text class="fback-t">‹ 返回</text></div>
      <text class="ftitle">动态</text>
      <div class="cats">
        <div v-for="(c, ci) in cats" :key="'c' + ci"
             :class="['cat', cat === c.k ? 'cat-on' : '']" @click="setCat(c.k)">
          <text :class="['cat-t', cat === c.k ? 'cat-t-on' : '']">{{ c.n }}</text>
        </div>
      </div>
    </div>

    <!-- 诊断: 状态行放在 scroller 外面(绝对定位) —— 用来区分"整页没渲染"还是"只有 scroller 空" -->
    <div class="fstatus" v-if="status !== ''" @click="retry"><text class="fstatus-t">{{ status }}</text></div>

    <scroller class="fscroll" scroll-direction="vertical" :show-scrollbar="true">
      <div class="fwrap">

        <div class="dyn" v-for="(d, di) in shown" :key="d.id || ('d' + di)">
          <div class="dhead">
            <image v-if="d.face" class="dface" :src="d.face" resize="cover"></image>
            <div v-else class="dface dface-ph"><text class="dface-t">{{ d.author ? d.author.charAt(0) : '?' }}</text></div>
            <text class="dauthor">{{ d.author }}</text>
            <text class="dtime">{{ d.pubText }}</text>
            <text class="dbadge">{{ kindName(d.kind) }}</text>
          </div>

          <richtext :class="['dtext', d.expanded ? 'dtext-open' : '']" @click="toggle(d)">
            <template v-for="(seg, si) in d.segs">
              <span v-if="seg.t === 0" :key="'s' + si">{{ seg.v }}</span>
              <span v-else-if="seg.t === 2" :key="'h' + si" class="dhl">{{ seg.v }}</span>
              <image v-else :key="'e' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
            </template>
          </richtext>
          <div v-if="d.segs && d.segs.length > 0 && !d.expanded" class="dmore" @click="toggle(d)">
            <text class="dmore-t">展开全文 ▾</text>
          </div>

          <div class="pics" v-if="d.rows && d.rows.length">
            <div class="pic-row" v-for="(row, ri) in d.rows" :key="'r' + ri">
              <div class="pic-box" v-for="(p, pi) in row" :key="'p' + ri + '_' + pi"
                   :style="{ width: p.w + 'px', height: p.h + 'px' }" @click="openPic(p)">
                <image class="pic-img" :src="p.src" @click="openPic(p)"
                       :style="{ width: p.w + 'px', height: p.h + 'px' }" resize="cover"></image>
              </div>
            </div>
          </div>

          <div class="vcard" v-if="d.archive" @click="openVideo(d.archive)">
            <image class="vcover" :src="d.archive.cover" resize="cover"></image>
            <div class="vmeta">
              <text class="vtitle">{{ d.archive.title }}</text>
              <text class="vstat">{{ '▶' + d.archive.playText + '   ' + d.archive.duration }}</text>
            </div>
          </div>

          <div class="ocard" v-if="d.opus">
            <text class="otitle">{{ d.opus.title }}</text>
            <text class="osum" v-if="d.opus.summary">{{ d.opus.summary }}</text>
          </div>

          <div class="ostat" v-if="d.orig">
            <text class="olabel">{{ '转发 @' + d.orig.author + '：' }}</text>
            <richtext class="dtext">
              <template v-for="(seg, si) in d.orig.segs">
                <span v-if="seg.t === 0" :key="'os' + si">{{ seg.v }}</span>
                <span v-else-if="seg.t === 2" :key="'oh' + si" class="dhl">{{ seg.v }}</span>
                <image v-else :key="'oe' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
              </template>
            </richtext>
            <div class="pics" v-if="d.orig.rows && d.orig.rows.length">
              <div class="pic-row" v-for="(row, ri) in d.orig.rows" :key="'or' + ri">
                <div class="pic-box" v-for="(p, pi) in row" :key="'op' + ri + '_' + pi"
                     :style="{ width: p.w + 'px', height: p.h + 'px' }" @click="openPic(p)">
                  <image class="pic-img" :src="p.src"
                         :style="{ width: p.w + 'px', height: p.h + 'px' }" resize="cover"></image>
                </div>
              </div>
            </div>
            <div class="vcard" v-if="d.orig.archive" @click="openVideo(d.orig.archive)">
              <image class="vcover" :src="d.orig.archive.cover" resize="cover"></image>
              <div class="vmeta">
                <text class="vtitle">{{ d.orig.archive.title }}</text>
                <text class="vstat">{{ '▶' + d.orig.archive.playText + '   ' + d.orig.archive.duration }}</text>
              </div>
            </div>
          </div>

          <div class="dfoot">
            <text class="dfoot-t">{{ '赞 ' + d.stat.like }}</text>
            <text class="dfoot-t">{{ '评论 ' + d.stat.reply }}</text>
            <text class="dfoot-t">{{ '转发 ' + d.stat.forward }}</text>
          </div>
        </div>

        <div class="loadmore" v-if="hasMore" @click="loadMore">
          <text class="loadmore-t">{{ loading ? '加载中…' : '加载更多动态' }}</text>
        </div>
        <div class="empty" v-if="!loading && shown.length === 0">
          <text class="empty-t">{{ status !== '' ? status : '这个分类下暂时没有动态' }}</text>
        </div>
      </div>
    </scroller>

    <div v-if="viewer.on" class="iview"
         @touchstart="ivStart" @touchmove="ivMove" @touchend="ivEnd">
      <image class="iview-img" :src="viewer.url" resize="contain" :style="viewerStyle"
             @load="onImgLoad"></image>
      <div v-if="viewer.loading || viewer.err !== ''" class="iv-mask">
        <text class="iv-mask-t">{{ viewer.err !== '' ? viewer.err : '加载中…' }}</text>
      </div>
      <!-- 左上角返回/关闭: 用与应用内一致的「‹ 返回」(✕ 字形本机字体没有, 显示为空白); 深色胶囊白底也看得清 -->
      <div class="iv-back" @click="ivClose"><text class="iv-back-t">‹ 返回</text></div>
      <div v-if="viewer.hint" class="iv-hint">
        <text class="iv-hint-t">双击后按住上下滑 = 缩放 · 拖动平移</text>
      </div>
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
import { getDynamicFeed } from '../../services/bili.js'
import { log } from '../../services/log.js'
import { bigUrl, clampScale, clampPan, imgStyle as makeImgStyle, VIEW_W, VIEW_H } from '../../services/imageview.js'

// 计时器: 优先用页面实例的 setTimeout (本运行时组件里不保证有全局 setTimeout) —— 与 player.vue 同款
function setTimer(vm, ms, fn) {
  const p = vm.$page
  if (p && p.setTimeout) return p.setTimeout(fn, ms)
  return setTimeout(fn, ms)
}


const CATS = [
  { k: 'all', n: '全部' },
  { k: 'av', n: '投稿' },
  { k: 'draw', n: '图文' },
  { k: 'word', n: '文字' },
  { k: 'forward', n: '转发' },
  { k: 'opus', n: '专栏' }
]
const KIND_NAME = { av: '投稿', draw: '图文', word: '文字', opus: '专栏', forward: '转发', live: '直播', other: '动态' }

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export default {
  data() {
    return {
      cats: CATS,
      cat: 'all',
      items: [],
      offset: '',
      hasMore: false,
      loading: false,
      status: '加载中…',
      viewer: { on: false, url: '', scale: 1, tx: 0, ty: 0, text: '100%', sizeText: '', err: '', loading: false, hint: false }
    }
  },
  computed: {
    // 缩放/平移交给 CSS transform (本机固件实测 <image> 支持 scale/translate)
    viewerStyle() { return makeImgStyle(this.viewer.scale, this.viewer.tx, this.viewer.ty) },
    // 分类筛选: 投稿 / 图文 / 文字 / 转发 / 专栏
    shown() {
      if (this.cat === 'all') return this.items
      const out = []
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].kind === this.cat) out.push(this.items[i])
      }
      return out
    }
  },
  methods: {
    // 生命周期: BasePage 只把 onShow/onHide/onUnload 转发给页面根组件
    onShow() {
      try { log('动态页', 'onShow 到达 started=' + (this._started === true)) } catch (e0) {}
      if (this.$page && !this._newOptionsBound) {
        this._newOptionsBound = true
        const self = this
        this.$page.onNewOptions = function () { self.load(true) }
      }
      // 二次进入: 上次没拿到数据(超时/失败)就自动再试一次
      if (this._started) { if (this.items.length === 0) this.load(true); return }
      this._started = true
      this.load(true)
    },
    // 接口偶发不返回(实测有 1 分钟不 resolve 的情况) -> 给用户一个明确的重试入口
    retry() { this._gen++; this.loading = false; this.status = '加载中…'; this.load(true) },
    back() { try { this.$page.finish() } catch (e) {} },
    kindName(k) { return KIND_NAME[k] || '动态' },
    setCat(k) {
      if (this.cat === k) return
      this.cat = k
      try { log('动态页', '切换分类 ' + k) } catch (e) {}
    },
    async load(reset) {
      if (this.loading) return
      if (!reset && !this.hasMore) return
      const self = this
      this.loading = true
      if (reset) this.status = '加载中…'
      try { log('动态页', 'load 开始 reset=' + reset) } catch (e0) {}
      const gen = ++this._gen
      // 看门狗: 12 秒不回来就当超时, 绝不让页面永远停在「加载中…」
      const watchdog = new Promise(function (res, rej) {
        setTimer(self, 12000, function () { rej(new Error('加载超时，点这里重试')) })
      })
      try {
        const r = await Promise.race([getDynamicFeed(reset ? '' : this.offset), watchdog])
        if (gen !== this._gen) return
        const add = r.items || []
        for (let i = 0; i < add.length; i++) {
          add[i].rows = chunk(add[i].pics || [], 3)
          if (add[i].orig) add[i].orig.rows = chunk(add[i].orig.pics || [], 3)
          add[i].expanded = false
        }
        if (reset) this.items = []
        for (let i = 0; i < add.length; i++) this.items.push(add[i])
        this.offset = r.offset || ''
        this.hasMore = !!r.hasMore
        this.status = this.items.length === 0 ? '关注的 UP 主暂无动态' : ''
        let nd = 0
        for (let i = 0; i < this.items.length; i++) { if (this.items[i].kind === 'draw') nd++ }
        try { log('动态页', '加载完成 ' + this.items.length + ' 条 (图文 ' + nd + ' / offset=' + this.offset + ')') } catch (e) {}
      } catch (e) {
        if (gen !== this._gen) return
        this.status = (e && e.message) ? e.message : String(e)
        try { log('动态页', '加载失败 ' + this.status) } catch (e2) {}
      } finally {
        if (gen === this._gen) this.loading = false
      }
    },
    loadMore() { if (this.loading || !this.hasMore) return; this.load(false) },
    toggle(d) { d.expanded = !d.expanded },
    openVideo(a) {
      if (!a || !a.bvid) return
      try { $falcon.navTo('page', { bvid: a.bvid, title: a.title }) } catch (e) {}
    },
    openPic(p) { if (p && p.full) this.ivOpen(p.full) },
    // 打开: 只把大图 URL 交给 <image resize="contain">, 缩放/平移用 transform (不落盘/不阻塞/不受图片缓存影响)
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
    ivZoomIn() { this.viewer.hint = false; this.ivZoom(1.25) },
    ivZoomOut() { this.viewer.hint = false; this.ivZoom(0.8) },
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
      if (now - (this._lastTap || 0) < 320) { this._lastTap = 0; this.ivDouble() }
      else this._lastTap = now
    }
  }
}
</script>

<style scoped>
.fpage { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #14161a; }
.ftop { position: absolute; left: 0px; top: 0px; width: 960px; height: 44px; flex-direction: row; align-items: center; background-color: #1b1e24; }
.fback { padding-left: 16px; padding-right: 14px; height: 40px; justify-content: center; }
.fback-t { font-size: 21px; color: #cfd5de; }
.ftitle { font-size: 19px; color: #e6eaf0; margin-right: 16px; }
.cats { flex-direction: row; flex: 1; }
.cat { padding-left: 12px; padding-right: 12px; height: 28px; border-radius: 6px; margin-right: 8px; background-color: #232830; justify-content: center; }
.cat-on { background-color: #fb7299; }
.cat-t { font-size: 17px; color: #aab2bd; }
.cat-t-on { color: #ffffff; }
.fscroll { position: absolute; left: 0px; top: 74px; width: 960px; height: 192px; }
.fstatus { position: absolute; left: 0px; top: 46px; width: 960px; height: 26px; flex-direction: row; justify-content: center; align-items: center; }
.fstatus-t { font-size: 16px; color: #8a93a0; }
.fwrap { padding-left: 20px; padding-right: 20px; padding-bottom: 12px; }
.status { font-size: 17px; color: #8a93a0; text-align: center; padding-top: 14px; padding-bottom: 6px; }
.dyn { width: 920px; margin-top: 10px; padding-left: 12px; padding-right: 12px; padding-top: 10px; padding-bottom: 10px; background-color: #1f1f1f; border-radius: 12px; }
.dhead { flex-direction: row; align-items: center; }
.dface { width: 40px; height: 40px; border-radius: 20px; margin-right: 10px; background-color: #232830; }
.dface-ph { justify-content: center; align-items: center; }
.dface-t { font-size: 18px; color: #7c8592; }
.dauthor { font-size: 18px; color: #8fb8ff; }
.dtime { font-size: 15px; color: #7c8592; margin-left: 10px; }
.dbadge { font-size: 15px; color: #ffffff; background-color: #fb7299; padding-left: 8px; padding-right: 8px; padding-top: 2px; padding-bottom: 2px; border-radius: 6px; margin-left: 10px; }
.dtext { font-size: 19px; color: #dfe4ea; lines: 3; margin-top: 4px; }
.dtext-open { lines: 99; }
.dhl { color: #8fb8ff; }
.dmore { padding-top: 6px; padding-bottom: 6px; }
.dmore-t { font-size: 16px; color: #8fb8ff; }
.pics { margin-top: 6px; }
.pic-row { flex-direction: row; }
.pic-box { margin-right: 6px; margin-bottom: 6px; border-radius: 8px; background-color: #232830; }
.pic-img { border-radius: 8px; }
.vcard { flex-direction: row; margin-top: 6px; padding: 8px; background-color: #262b33; border-radius: 8px; }
.vcover { width: 160px; height: 100px; border-radius: 6px; margin-right: 10px; }
.vmeta { flex: 1; }
.vtitle { font-size: 18px; color: #ffffff; lines: 2; }
.vstat { font-size: 16px; color: #888888; margin-top: 6px; }
.ocard { margin-top: 6px; padding: 8px; background-color: #262b33; border-radius: 8px; }
.otitle { font-size: 18px; color: #ffffff; lines: 2; }
.osum { font-size: 17px; color: #aab2bd; lines: 2; margin-top: 4px; }
.ostat { margin-top: 6px; padding: 8px; background-color: #1a1d22; border-radius: 8px; }
.olabel { font-size: 17px; color: #8fb8ff; }
.dfoot { flex-direction: row; margin-top: 8px; }
.dfoot-t { font-size: 16px; color: #9aa3af; margin-right: 20px; }
.loadmore { height: 40px; justify-content: center; }
.loadmore-t { font-size: 17px; color: #8fb8ff; }
.empty { margin-top: 20px; justify-content: center; }
.empty-t { font-size: 18px; color: #8a93a0; }
.iview { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #05070a; z-index: 200; }
.iview-img { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; }
.iv-mask { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; justify-content: center; align-items: center; }
.iv-mask-t { font-size: 19px; color: #e6eaf0; background-color: rgba(0,0,0,0.62); padding-left: 20px; padding-right: 20px; padding-top: 8px; padding-bottom: 8px; border-radius: 18px; }
.iv-back { position: absolute; left: 14px; top: 12px; height: 40px; padding-left: 16px; padding-right: 20px; border-radius: 20px; background-color: rgba(0,0,0,0.62); flex-direction: row; justify-content: center; align-items: center; }
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
