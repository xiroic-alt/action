<template>
  <div class="page">
    <div class="topbar">
      <div class="back" @click="goBack">
        <image class="back-ic" :src="MI.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="back-text">返回</text>
      </div>
      <text class="title">全部回复 {{ total > 0 ? total : '' }}</text>
    </div>

    <!-- 原始评论折叠成一行引用: 完整内容按需求隐藏, 但保留「在回复谁」的上下文,
         否则只剩顶栏 + 几条子回复, 页面看着像空白 -->
    <div class="parent-line" @click="replyToParent">
      <text class="parent-line-text">回复 @{{ parentAuthor || '该评论' }}: {{ parentPreview }}</text>
    </div>

    <!-- 原始评论(父评论)按需求隐藏: 楼中页只列子回复;
         要回复主楼直接点底部输入栏(默认目标就是主评论) -->

    <scroller class="list" scroll-direction="vertical" :show-scrollbar="true"
              :loadmoreoffset="100" @loadmore="loadMore" @scroll="onListScroll"
              @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
      <text v-if="status !== ''" class="status">{{ status }}</text>
      <div v-for="r in replies" :key="r.rpid" class="reply">
        <image class="face" :src="r.face" resize="cover" @click="openUser(r)"></image>
        <div class="reply-main">
          <div class="reply-head">
            <text class="reply-author" @click="openUser(r)">{{ r.author }}</text>
            <text v-if="r.isUp" class="tag tag-up">UP主</text>
            <text class="reply-time">{{ r.timeText }}</text>
          </div>
          <!-- :key 重建生效: Falcon 的 lines 样式创建后不随 class 更新 -->
          <richtext :key="'r' + r.rpid + (r.expanded ? 1 : 0)"
                    :class="['reply-msg', r.expanded ? 'reply-msg-open' : '']" @click="toggleReply(r)">
            <template v-for="(seg, si) in r.segs">
              <span v-if="seg.t === 0" :key="'s' + si">{{ seg.v }}</span>
              <image v-else :key="'e' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
            </template>
          </richtext>
          <div v-if="r.pics && r.pics.length > 0" class="reply-pics">
            <!-- 每张图一个独立命中区: 原来所有图挤在一个引用作用域外变量(pic)的 div 里, 尺寸算出来是 0, 点不开 -->
            <div v-for="(pic, pi) in r.pics" :key="'pic' + r.rpid + pi" class="reply-pic-hit"
                 :style="{ width: pic.w + 'px', height: pic.h + 'px' }" @click="ivOpen(pic.src)">
              <image class="reply-pic" :src="pic.src"
                     :style="{ width: pic.w + 'px', height: pic.h + 'px' }" resize="cover"></image>
            </div>
          </div>
          <!-- 点赞 / 回复 / 看图: 事件挂在有尺寸的 div 上 (text 上的 @click 在本机固件不触发) -->
          <div class="reply-meta">
            <div class="meta-btn" @click="toggleReplyLike(r)">
              <image :src="r.liked ? MI.thumbupOn : MI.thumbup" :style="{ width: '20px', height: '20px' }"></image>
              <text :class="['meta-text', r.liked ? 'meta-liked' : '']">{{ r.likeText }}</text>
            </div>
            <div class="meta-btn" @click="setTarget(r)">
              <image :src="MI.reply" :style="{ width: '20px', height: '20px' }"></image>
              <text class="meta-reply">回复</text>
            </div>
            <div v-if="r.pics && r.pics.length > 0" class="meta-btn meta-btn-pic" @click="ivOpen(r.pics[0].src)">
              <image :src="MI.img" :style="{ width: '20px', height: '20px' }"></image>
              <text class="meta-pic">{{ r.pics.length }}</text>
            </div>
          </div>
        </div>
      </div>
      <text v-if="replies.length > 0 && hasMore" class="load-more" @click="loadMore">加载更多回复…</text>
      <text v-if="!loading && replies.length === 0 && status === ''" class="empty">还没有回复</text>
    </scroller>

    <!-- 底部发评栏: 回复目标提示 + IME 输入 -->
    <div class="postbar">
      <div class="post-input" @click="openPostInput">
        <text class="post-input-text">{{ logged ? inputHint : '登录后参与评论' }}</text>
      </div>
      <div class="post-btn" @click="openPostInput">
        <text class="post-btn-text">发送</text>
      </div>
    </div>
    <!-- 图片查看器 (transform 版, 与详情页同款): 楼中楼里的图原来点不开 ——
         模板引用了 ivOpen, 但整个页面根本没有这个实现 (也没有查看器) -->
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
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// 楼中页: 某条主评论的子回复列表 (x/v2/reply/reply) + 回复子评论 (addReply root/parent).
// 由评论页「回复 N」navTo 传入: aid(oid), root(顶层 rpid), msg/author/face(父评论展示).
// 点某条回复的「回复」= 设置目标 (发评时 parent=该条 rpid); 点父评论 = 回复主楼 (parent=root).
import { createIME } from '../../services/ime.js'
import { getSubReplies, addReply, parseMessage, likeReply } from '../../services/bili.js'
import { hasCookie } from '../../services/auth.js'
import { afterPaint } from '../../base-page.js'
import { log } from '../../services/log.js'
import { bigUrl, viewUrl, clampScale, clampPan, imgStyle as makeImgStyle, VIEW_W, VIEW_H } from '../../services/imageview.js'

// 计时器: 优先用页面实例的 setTimeout
function setTimer(vm, ms, fn) {
  const p = vm.$page
  if (p && p.setTimeout) return p.setTimeout(fn, ms)
  return setTimeout(fn, ms)
}

// 内置常用 emoji 映射: .vue 里的 require png 会被 aiot-cli 编译成 images/<hash>.png
// (services/*.js 里的 require 不会被编译, QuickJS 无 require 会崩, 见 0.8.7 黑屏教训)
// 点赞数 +1/-1 (返回的是 "1.2万" 这类文本, 只动整数部分)
function bumpCount(text, add) {
  const t = String(text == null ? '' : text)
  const m = /^(\d+)(.*)$/.exec(t)
  if (!m) return t
  return Math.max(0, parseInt(m[1], 10) + (add ? 1 : -1)) + m[2]
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

// 图标: material-icons-svg 的光栅化产物 (生成器 tools/make-icons.mjs)
const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  thumbup: require('../../assets/mi/thumbup_20_m.png'),
  thumbupOn: require('../../assets/mi/thumbup_20_p.png'),
  reply: require('../../assets/mi/reply_20_m.png'),
  img: require('../../assets/mi/image_20_m.png')
}

export default {
  name: 'subreply',
  data() {
    return {
      aid: 0,
      // 图片查看器 (transform 版): 楼中楼里的图原来点不开 —— 模板引用了 ivOpen, 但整页没有实现
      viewer: { on: false, url: '', full: '', scale: 1, tx: 0, ty: 0, text: '100%', sizeText: '', err: '', loading: false, hint: false },
      root: 0,
      parentAuthor: '',
      parentFace: '',
      parentSegs: [],
      parentPreview: '',   // 原始评论摘要 (一行引用条显示)
      total: 0,
      replies: [],
      pn: 1,
      hasMore: false,
      loading: false,
      logged: false,
      status: '加载中…',
      posting: false,
      ime: null,
      generation: 0,
      // 当前回复目标: null = 回复主楼; { rpid, author } = 回复某条子回复
      target: null
    }
  },
  computed: {
    MI() { return MI },
    viewerStyle() { return makeImgStyle(this.viewer.scale, this.viewer.tx, this.viewer.ty) },
    inputHint() {
      return this.target ? '回复 @' + this.target.author : '回复主评论…'
    }
  },
  methods: {
    onShow() {
      if (this.$page && !this._newOptionsBound) {
        this._newOptionsBound = true
        const self = this
        this.$page.onNewOptions = function (options) { self.applyOptions(options) }
      }
      const wasLogged = this.logged
      this.logged = hasCookie()
      if (this.logged && !wasLogged && this.root && this.replies.length === 0) {
        this.status = '加载中…'
        this.load(true)
        return
      }
      this.applyOptions((this.$page && this.$page.options) || {})
    },

    onUnload() {
      if (this.ime) { try { this.ime.destroy() } catch (e) {} }
    },

    applyOptions(options) {
      try { log('楼中楼', 'applyOptions aid=' + (options && options.aid) + ' root=' + (options && options.root) + ' count=' + (options && options.count)) } catch (e) {}
      const aid = parseInt(options.aid || '0', 10) || 0
      const root = parseInt(options.root || '0', 10) || 0
      if (root === this.root && (this.replies.length > 0 || this.loading)) return
      this.aid = aid
      this.root = root
      this.parentAuthor = options.author || ''
      this.parentFace = options.face || ''
      this.total = parseInt(options.count || '0', 10) || 0
      // 父评论内容: 用内置 emoji 解析成图文混排段
      this.parentSegs = parseParentSegs(options.msg || '')
      // 摘要: 去掉换行/多余空格并截断, 引用条要一行显示
      this.parentPreview = String(options.msg || '').replace(/\s+/g, ' ').slice(0, 40)
      this.replies = []
      this.pn = 1
      this.hasMore = false
      this.target = null
      this.generation++
      this.loading = false
      this.status = '加载中…'
      this.load(true)
    },

    load(reset) {
      if (!this.root || this.loading) return
      const gen = ++this.generation
      this.loading = true
      if (reset) this.status = '加载中…'
      const runLoad = async () => {
        log('楼中楼', '开始加载 aid=' + this.aid + ' root=' + this.root + ' pn=' + this.pn)
        try {
          const r = await getSubReplies(this.aid, this.root, this.pn, BUILTIN_EMOJI)
          if (gen !== this.generation) return
          if (reset) this.replies = []
          for (let i = 0; i < r.replies.length; i++) {
            const item = r.replies[i]
            let dup = false
            for (let j = 0; j < this.replies.length; j++) {
              if (this.replies[j].rpid === item.rpid) { dup = true; break }
            }
            if (!dup) {
              item.expanded = false   // 推入时声明, 保证响应式 (点击展开用)
              this.replies.push(item)
            }
          }
          this.total = r.total
          this.hasMore = this.replies.length < r.total && r.replies.length > 0
          this.status = ''
          log('楼中楼', '加载完成 ' + this.replies.length + ' 条 (total=' + this.total + ')')
        } catch (err) {
          if (gen !== this.generation) return
          console.log('[subreply] load error: ' + (err && err.message ? err.message : err))
          this.status = err && err.message ? err.message : String(err)
          log('楼中楼', '加载失败: ' + this.status)
        } finally {
          if (gen === this.generation) this.loading = false
        }
      }
      if (typeof afterPaint === 'function') {
        try { afterPaint(runLoad) } catch (e) { log('楼中楼', 'afterPaint 失败, 直接加载: ' + (e && e.message ? e.message : e)); runLoad() }
      } else { runLoad() }
    },

    loadMore() {
      if (this.loading || !this.hasMore) return
      this.pn++
      this.load(false)
    },

    // ---------- 下拉刷新 (与 index/page 同款 touch 方案) ----------
    touchXY(e) {
      try {
        const t = (e && e.changedTouches && e.changedTouches[0]) ||
          (e && e.touches && e.touches[0]) || e
        if (t) {
          if (typeof t.pageY === 'number') return t.pageY
          if (typeof t.clientY === 'number') return t.clientY
          if (typeof t.y === 'number') return t.y
        }
      } catch (err) {}
      return 0
    },
    onListScroll(e) {
      try {
        const co = e && e.contentOffset
        this._scrollY = co && typeof co.y === 'number' ? co.y : (this._scrollY || 0)
      } catch (err) {}
    },
    onTouchStart(e) {
      this._touchY0 = this.touchXY(e)
      this._pullArmed = false
      this._pullOk = (this._scrollY || 0) <= 2
    },
    onTouchMove(e) {
      if (!this._pullOk) return
      if ((this._scrollY || 0) > 2) { this._pullOk = false; return }
      if (this.touchXY(e) - this._touchY0 > 55) this._pullArmed = true
    },
    onTouchEnd() {
      if (this._pullArmed && this._pullOk && (this._scrollY || 0) <= 2) {
        this._pullArmed = false
        if (!this.loading) {
          this.pn = 1
          this.load(true)
        }
        return
      }
      this._pullArmed = false
    },

    // 点某条子回复的「回复」→ 设为目标
    // 评论点赞 (乐观更新, 失败回滚)
    async toggleReplyLike(r) {
      if (!this.requireLogin()) return
      const want = !r.liked
      r.liked = want
      const before = r.likeText
      r.likeText = bumpCount(before, want)
      try {
        await likeReply(this.aid, r.rpid, want)
        this.status = want ? '已点赞' : '已取消赞'
      } catch (err) {
        r.liked = !want
        r.likeText = before
        this.status = (err && err.message) ? err.message : '点赞失败'
      }
    },

    // 点头像/昵称 -> TA 的主页
    // ---------------- 图片查看器 (transform 版) ----------------
    ivOpen(url) {
      const self = this
      // 原图留到「放大到 2 倍以上 + 手势结束静置」时才用; 手势期间用轻量图
      // (2040 宽 ≈235 万像素, 每帧重采样就是掉帧的元凶; 见 services/imageview.js 注释)
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
      try { log('图片查看器', '打开 ' + this.viewer.url) } catch (e) {}
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
      // 位置取整: 半像素位置会让合成器每帧重新采样整张图, 拖动时的「果冻/撕裂」就是它
      const nx = Math.round(p.x)
      const ny = Math.round(p.y)
      if (nx !== this.viewer.tx) this.viewer.tx = nx
      if (ny !== this.viewer.ty) this.viewer.ty = ny
      if (silent) return
      const t = Math.round(this.viewer.scale * 100) + '%'
      if (t !== this.viewer.text) this.viewer.text = t
    },
    // 手势期间把样式写入合并成「一帧最多一次」:
    // 逐 move 写 transform 会让合成器边写边扫 -> 画面半边新半边旧, 视觉上就是果冻效应
    // (0.9.58 用户反馈「照片查看像帧不同步」). touchmove 本身已被框架节流, 再叠写入风暴只会更糟.
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
      this.ivLight()   // 回到适配态: 换回轻量图 (够清晰且拖动跟手)
    },
    // 换回轻量图 (手势期间 / 适配态)
    ivLight() { if (this.viewer.full) this.viewer.url = viewUrl(this.viewer.full, false) },
    // 原图只在「放大到 2 倍以上 + 手停下来静置 260ms」之后才换:
    // 换 src 会重新解码, 手势过程中换必然闪一下 + 掉帧
    ivScheduleUpgrade() {
      const self = this
      if (!this.viewer.full) return
      setTimer(this, 260, function () {
        if (!self.viewer.on) return
        const want = self.viewer.scale >= 2 ? self.viewer.full : viewUrl(self.viewer.full, false)
        if (self.viewer.url === want) return
        self.viewer.url = want
        // 打点: 现场能直接从日志看出「手势期间是轻量图 / 静置后有没有换原图」
        try { log('图片查看器', '切图 ' + (want === self.viewer.full ? '原图2040' : '轻量1080') + ' scale=' + (Math.round(self.viewer.scale * 100) / 100)) } catch (e0) {}
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
      const dx = p.x - this._ix, dy = p.y - this._iy
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      if (Math.abs(dx) + Math.abs(dy) > 4) { this._moved = true; this.viewer.hint = false }
      this._ix = p.x; this._iy = p.y
      this.viewer.tx += dx
      this.viewer.ty += dy
      this.ivFlush()   // 平移也必须合并写: 逐 move 写就是「果冻/撕裂」的主因
    },
    ivEnd() {
      this.ivScheduleUpgrade()   // 手停了再决定要不要换原图
      this.ivApply()             // 手停: 落一次最终位置, 百分比文字也在这时刷新
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
    },
    openUser(r) {
      if (!r || !r.mid) return
      try { $falcon.navTo('up', { mid: r.mid, name: r.author }) } catch (e) { this.status = '打开主页失败' }
    },

    // 需要登录的操作统一入口 (有些页面用 requireLogin, 本页此前没有)
    requireLogin() {
      if (this.logged) return true
      this.status = '请先登录'
      return false
    },

    setTarget(r) {
      this.target = { rpid: r.rpid, author: r.author }
    },

    // 长评论收起/展开 (expanded 在推入时已声明, 响应式)
    toggleReply(r) {
      r.expanded = !r.expanded
    },

    // 点父评论 → 回复主楼 (parent = root)
    replyToParent() {
      this.target = null
    },

    async openPostInput() {
      if (!hasCookie()) {
        $falcon.navTo('login', {})
        return
      }
      if (this.ime == null) this.ime = createIME()
      try {
        const text = await this.ime.open({
          text: '',
          placeholder: this.inputHint,
          maxlength: 500,
          multiLinesEditVisible: false,
          enterButtonText: '发送',
          confirmText: '发送'
        })
        if (text === null || text.trim() === '') return
        await this.postReply(text.trim())
      } catch (err) {
        this.status = '输入失败: ' + (err && err.message ? err.message : err)
      }
    },

    async postReply(message) {
      if (this.posting) return
      this.posting = true
      this.status = '发送中…'
      const parent = this.target ? this.target.rpid : this.root
      try {
        await addReply(this.aid, message, this.root, parent)
        this.target = null
        this.pn = 1
        this.replies = []
        this.status = '已发送'
        this.load(true)
      } catch (err) {
        this.status = '发送失败: ' + (err && err.message ? err.message : err)
      } finally {
        this.posting = false
      }
    },

    goBack() {
      this.$page.finish()
    }
  }
}

// 父评论内容解析 (无 emote 映射, 只做 unicode emoji -> 内置图): 复用 bili.js 的 parseMessage
function parseParentSegs(msg) {
  return parseMessage(msg, {}, BUILTIN_EMOJI)
}
</script>

<style scoped>
.page {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 960px;
  height: 266px;
  background-color: #16181c;
}
.topbar {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 960px;
  height: 44px;
  flex-direction: row;
  align-items: center;
  background-color: #21242b;
}
.back {
  width: 132px;
  height: 38px;
  margin-left: 12px;
  border-radius: 19px;
  background-color: #37404a;
  justify-content: center;
  align-items: center;
}
.back-text {
  font-size: 22px;
  color: #ffffff;
}
.title {
  font-size: 22px;
  color: #ffffff;
  margin-left: 14px;
  lines: 1;
  text-overflow: ellipsis;
  overflow: hidden;
}
/* 父评论卡片 */
.parent {
  position: absolute;
  left: 0px;
  top: 44px;
  width: 960px;
  height: 66px;
  flex-direction: row;
  align-items: center;
  padding-left: 12px;
  padding-right: 12px;
  background-color: #1a1d22;
  border-bottom-width: 1px;
  border-bottom-color: #262b33;
}
.pface {
  width: 40px;
  height: 40px;
  border-radius: 20px;
  margin-right: 10px;
}
.pmain {
  width: 880px;
  flex-direction: column;
}
.phead {
  flex-direction: row;
  align-items: center;
}
.pauthor {
  font-size: 18px;
  color: #8a94a6;
}
.pmsg {
  font-size: 19px;
  color: #c8d2de;
  lines: 1;
  text-overflow: ellipsis;
}
.list {
  position: absolute;
  left: 0px;
  top: 74px;   /* 原来给父评论块留的 44-110 空洞已用引用条 + 列表补上 */
  width: 960px;
  height: 148px;   /* 74 -> 222 (postbar 上沿) */
  padding-left: 12px;
  padding-right: 12px;
}
.parent-line {
  position: absolute;
  left: 0px;
  top: 44px;
  width: 960px;
  height: 30px;
  background-color: #1f1f1f;
  justify-content: center;
  padding-left: 16px;
  padding-right: 16px;
}
.parent-line-text {
  font-size: 17px;
  color: #8a93a0;
  lines: 1;
  text-overflow: ellipsis;
  overflow: hidden;
}
.tag-up {
  font-size: 15px;
  padding-left: 8px;
  padding-right: 8px;
  padding-top: 2px;
  padding-bottom: 2px;
  border-radius: 6px;
  margin-left: 8px;
  background-color: #2f80ed;
  color: #ffffff;
  justify-content: center;
}
.reply-pics {
  flex-direction: row;
  margin-top: 6px;
  margin-bottom: 4px;
}
.reply-pic-hit {
  margin-right: 8px;
}
.reply-pic {
  margin-right: 8px;
  border-radius: 8px;
}
.status {
  font-size: 19px;
  color: #e6a23c;
  margin-top: 8px;
  margin-bottom: 8px;
  width: 100%;
  text-align: center;
}
.reply {
  flex-direction: row;
  padding-top: 8px;
  padding-bottom: 8px;
  border-bottom-width: 1px;
  border-bottom-color: #262b33;
}
.face {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  margin-right: 10px;
}
.reply-main {
  width: 870px;
  flex-direction: column;
}
.reply-head {
  flex-direction: row;
  align-items: center;
  margin-bottom: 2px;
}
.reply-author {
  font-size: 18px;
  color: #8a94a6;
  margin-right: 12px;
}
.reply-time {
  font-size: 16px;
  color: #5c6672;
}
.reply-msg {
  font-size: 20px;
  color: #e8edf3;
  lines: 3;
  margin-top: 2px;
}
.reply-msg-open {
  lines: 0;
}
.reply-meta {
  flex-direction: row;
  align-items: center;
  margin-top: 3px;
}
.meta-text {
  font-size: 16px;
  color: #6a7684;
  padding-top: 6px;
  padding-bottom: 6px;
}
.meta-liked {
  color: #fb7299;
}
.meta-pic {
  lines: 1;
  font-size: 17px;
  color: #fb7299;
  margin-left: 22px;
  padding-left: 12px;
  padding-right: 12px;
  padding-top: 2px;
  padding-bottom: 2px;
  border-radius: 6px;
  background-color: #2b2f36;
}
.meta-reply {
  font-size: 16px;
  color: #fb7299;
  margin-left: 18px;
  padding-top: 6px;
  padding-bottom: 6px;
  padding-right: 12px;
}
.load-more {
  font-size: 19px;
  color: #fb7299;
  text-align: center;
  margin-top: 10px;
  margin-bottom: 10px;
}
.empty {
  font-size: 19px;
  color: #6a7684;
  margin-top: 16px;
  text-align: center;
}
.postbar {
  position: absolute;
  left: 0px;
  top: 222px;
  width: 960px;
  height: 44px;
  flex-direction: row;
  align-items: center;
  background-color: #21242b;
  padding-left: 12px;
  padding-right: 12px;
}
.post-input {
  width: 800px;
  height: 32px;
  border-radius: 16px;
  background-color: #2a2f38;
  justify-content: center;
  padding-left: 14px;
}
.post-input-text {
  font-size: 19px;
  color: #8a94a6;
}
.post-btn {
  width: 110px;
  height: 32px;
  border-radius: 16px;
  background-color: #fb7299;
  justify-content: center;
  align-items: center;
  margin-left: 10px;
}
.post-btn-text {
  font-size: 19px;
  color: #ffffff;
}
/* ---------- 图标 (material) ---------- */
.back { flex-direction: row; }
.back-ic { margin-right: 4px; }
.meta-btn { flex-direction: row; align-items: center; padding-top: 4px; padding-bottom: 4px; margin-right: 8px; }
.meta-btn-pic { margin-right: 0px; }
.meta-text, .meta-reply, .meta-pic { margin-left: 6px; }
.reply-pic-hit { border-radius: 8px; background-color: #232830; }
/* ---------- 图片查看器 (transform 版) ---------- */
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
.iv-btn-t { font-size: 22px; color: #ffffff; }
.iv-pill { height: 40px; padding-left: 18px; padding-right: 18px; margin-right: 8px; border-radius: 12px; background-color: #fb7299; flex-direction: row; justify-content: center; align-items: center; }
.iv-pill-t { font-size: 20px; color: #ffffff; }
.iv-sep { width: 1px; height: 26px; background-color: rgba(255,255,255,0.30); margin-right: 8px; }
</style>
