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
      <text v-if="pubText !== ''" class="dtime">{{ pubText }}</text>
    </div>

    <!-- ============ 左栏: 内容 (580px) ============ -->
    <div class="dleft">
      <div class="actrow">
        <div :class="['act-btn', liked ? 'act-on' : '']" @click="doLike">
          <text :class="['act-text', liked ? 'act-text-on' : '']">{{ liked ? '已赞' : '点赞' }}</text>
          <text :class="['act-num', liked ? 'act-num-on' : '']">{{ likeText }}</text>
        </div>
        <div class="act-btn act-static">
          <text class="act-text">评论</text>
          <text class="act-num">{{ replyText }}</text>
        </div>
        <div class="act-btn act-static">
          <text class="act-text">转发</text>
          <text class="act-num">{{ forwardText }}</text>
        </div>
        <text v-if="actStatus !== ''" class="act-status">{{ actStatus }}</text>
      </div>

      <div class="dstatus" v-if="status !== ''" @click="retry">
        <image class="dstatus-ic" :src="MI.refresh" :style="{ width: '24px', height: '24px' }"></image>
        <text class="dstatus-t">{{ status }}</text>
      </div>

      <scroller v-else class="dscroll" scroll-direction="vertical" :show-scrollbar="true">
        <div class="dwrap">
          <div class="ahead" @click="openUp">
            <div class="aface-wrap">
              <image v-if="face !== ''" class="aface" :src="face" resize="cover"></image>
              <div v-else class="aface aface-ph"><text class="aface-t">{{ author ? author.charAt(0) : '?' }}</text></div>
              <image v-if="pendant !== ''" class="apendant" :src="pendant" resize="contain"></image>
            </div>
            <div class="acol">
              <div class="anamerow">
                <text class="aname">{{ author }}</text>
                <text class="atime">{{ pubText }}</text>
              </div>
              <!-- 认证标识 (图2 的样式) -->
              <div v-if="verifyText !== ''" class="averify">
                <div :class="['averify-badge', (item && item.officialType === 1) ? 'averify-org' : 'averify-per']">
                  <image class="averify-ic" :src="MI.bolt" :style="{ width: '11px', height: '11px' }"></image>
                </div>
                <text class="averify-t">{{ verifyText }}</text>
              </div>
            </div>
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
                <image class="pimg-i" :src="b.src" :lazy-load="true" resize="cover" :style="{ width: b.w + 'px', height: b.h + 'px' }"></image>
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
                  <image class="pic-img" :src="p.src" :lazy-load="true" resize="cover"
                         :style="{ width: p.w + 'px', height: p.h + 'px' }"></image>
                </div>
              </div>
            </div>
            <div class="vcard" v-if="archive" @click="openVideo(archive)">
              <image class="vcover" :src="archive.cover" :lazy-load="true" resize="cover"></image>
              <div class="vmeta">
                <text class="vtitle">{{ archive.title }}</text>
                <div class="vstatrow">
                  <image class="vstat-ic" :src="MI.play" :style="{ width: '18px', height: '18px' }"></image>
                  <text class="vstat">{{ archive.playText + '   ' + archive.duration }}</text>
                </div>
              </div>
            </div>
            <div class="ostat" v-if="orig">
              <text class="olabel" @click="openOrigUp">{{ '转发 @' + orig.author }}</text>
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
                    <image class="pic-img" :src="p.src" :lazy-load="true" resize="cover"
                           :style="{ width: p.w + 'px', height: p.h + 'px' }"></image>
                  </div>
                </div>
              </div>
              <!-- 转发内容里的视频: 之前详情页漏渲染了 (用户反馈「转发的视频就没有了」) -->
              <div class="vcard" v-if="orig.archive" @click="openVideo(orig.archive)">
                <image class="vcover" :src="orig.archive.cover" :lazy-load="true" resize="cover"></image>
                <div class="vmeta">
                  <text class="vtitle">{{ orig.archive.title }}</text>
                  <div class="vstatrow">
                    <image class="vstat-ic" :src="MI.play" :style="{ width: '18px', height: '18px' }"></image>
                    <text class="vstat">{{ orig.archive.playText + '   ' + orig.archive.duration }}</text>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </scroller>
    </div>

    <div class="dsep"></div>

    <!-- ============ 右栏: 评论 (378px) ============ -->
    <div class="dright">
      <div class="sortbar">
        <div :class="['sort-item', sortMode === 'hot' ? 'sort-on' : '']" @click="switchSort('hot')">
          <text :class="['sort-text', sortMode === 'hot' ? 'sort-text-on' : '']">热度</text>
        </div>
        <div :class="['sort-item', sortMode === 'time' ? 'sort-on' : '']" @click="switchSort('time')">
          <text :class="['sort-text', sortMode === 'time' ? 'sort-text-on' : '']">最新</text>
        </div>
        <text class="sort-count">{{ total > 0 ? ('共 ' + total) : '' }}</text>
      </div>
      <scroller class="clist" scroll-direction="vertical" :show-scrollbar="true"
                :loadmoreoffset="100" @loadmore="loadMoreComments">
        <text v-if="cStatus !== ''" class="c-status">{{ cStatus }}</text>
        <div v-for="r in replies" :key="r.rpid" class="reply">
          <image class="face" :src="r.face" :lazy-load="true" resize="cover"></image>
          <div class="reply-main">
            <div class="reply-head">
              <text class="reply-author">{{ r.author }}</text>
              <text v-if="r.pinned" class="tag tag-pin">置顶</text>
              <text v-if="r.isUp" class="tag tag-up">UP主</text>
              <text class="reply-time">{{ r.timeText }}</text>
            </div>
            <!-- 事件挂在 .reply-wrap 这个 div 上 (richtext 上的 @click 本机不触发) -->
            <div class="reply-wrap" @click="toggleReplyText(r)">
              <richtext :key="'r' + r.rpid + (r.expanded ? 1 : 0)"
                        :class="['reply-msg', r.expanded ? 'reply-msg-open' : '']">
                <template v-for="(seg, si) in r.segs">
                  <span v-if="seg.t === 0" :key="'s' + si">{{ seg.v }}</span>
                  <image v-else :key="'e' + si" :src="seg.v" :style="{ width: seg.w + 'px', height: seg.h + 'px' }"></image>
                </template>
              </richtext>
              <text v-if="!r.expanded && r.long" class="reply-more" @click="toggleReplyText(r)">…</text>
            </div>
            <div class="reply-meta">
              <div class="meta-btn" @click="toggleReplyLike(r)">
                <image :src="r.liked ? MI.thumbupOn : MI.thumbup" :style="{ width: '20px', height: '20px' }"></image>
                <text :class="['meta-text', r.liked ? 'meta-liked' : '']">{{ r.likeText }}</text>
              </div>
              <div class="meta-btn" @click="openSubReply(r)">
                <image :src="MI.reply" :style="{ width: '20px', height: '20px' }"></image>
                <text class="meta-reply">{{ r.replyCount }}</text>
              </div>
            </div>
          </div>
        </div>
        <text v-if="hasMore && replies.length > 0" class="load-more" @click="loadMoreComments">加载更多评论…</text>
        <text v-if="!cLoading && replies.length === 0 && cStatus === ''" class="empty">还没有评论</text>
      </scroller>
      <!-- 发评论: 走系统输入法 (services/ime.js), 与视频详情页同一套 -->
      <div class="postbar">
        <div class="post-input" @click="openPostInput">
          <text class="post-input-text">{{ logged ? (posting ? '发送中…' : '说点什么…') : '登录后参与评论' }}</text>
        </div>
        <div class="post-btn" @click="openPostInput">
          <text class="post-btn-text">发送</text>
        </div>
      </div>
    </div>

    <!-- 图片查看器 (与动态页同款) -->
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
import { getDynamicDetail, getOpusDetail, getReplies, likeDynamic, likeReply, addReply, GRID_COLS } from '../../services/bili.js'
import { hasCookie } from '../../services/auth.js'
import { createIME } from '../../services/ime.js'
import { log } from '../../services/log.js'
import { afterPaint } from '../../base-page.js'
import { bigUrl, viewUrl, clampScale, clampPan, imgStyle as makeImgStyle, VIEW_W, VIEW_H } from '../../services/imageview.js'

// 图标: material-icons-svg 的光栅化产物 (生成器 tools/make-icons.mjs)
const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  refresh: require('../../assets/mi/refresh_30_w.png'),
  play: require('../../assets/mi/play_18_w.png'),
  thumbup: require('../../assets/mi/thumbup_20_m.png'),
  thumbupOn: require('../../assets/mi/thumbup_20_p.png'),
  bolt: require('../../assets/mi/bolt_16_w.png'),
  reply: require('../../assets/mi/reply_20_m.png'),
  minus: require('../../assets/mi/remove_32_w.png'),
  plus: require('../../assets/mi/add_32_w.png')
}

// 计时器: 组件里没有全局 setTimeout (与 feed.vue / player.vue 同款)
function setTimer(vm, ms, fn) {
  const p = vm.$page
  if (p && p.setTimeout) return p.setTimeout(fn, ms)
  return setTimeout(fn, ms)
}

// 图片按 GRID_COLS 列切行 (列数与格子尺寸同源, 见 bili.js)
function chunkRows(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// 点赞数 +1/-1 (接口给的是 "1.2万" 这类文案, 只能就地加减整数部分)
function bumpCount(text, add) {
  const t = String(text == null ? '' : text)
  const m = /^(\d+)(.*)$/.exec(t)
  if (!m) return t
  const n = Math.max(0, parseInt(m[1], 10) + (add ? 1 : -1))
  return n + m[2]
}

// 内置常用 emoji 映射: .vue 里的 require png 会被 aiot-cli 编译成 images/<hash>.png
// (services/*.js 里的 require 不会被编译, QuickJS 无 require 会崩, 见 0.8.7 黑屏教训)
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
      liked: false,
      likeText: '0',
      replyText: '0',
      forwardText: '0',
      actStatus: '',
      liking: false,
      replies: [],
      total: 0,
      pn: 1,
      hasMore: false,
      cLoading: false,
      cStatus: '',
      sortMode: 'hot',
      commentType: 11,
      commentOid: '',
      cGeneration: 0,
      loading: false,
      ime: null,
      posting: false,
      logged: false,
      // 异步世代守卫: 必须声明在 data() 里 (0.9.57「永远加载中」的根因)
      generation: 0,
      viewer: { on: false, url: '', full: '', scale: 1, tx: 0, ty: 0, text: '100%', sizeText: '', err: '', loading: false, hint: false }
    }
  },
  computed: {
    MI() { return MI },
    viewerStyle() { return makeImgStyle(this.viewer.scale, this.viewer.tx, this.viewer.ty) },
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
    // 认证徽章 + 头像框: 都来自动态本体 item (getDynamicDetail -> mapDynamicItem)
    pendant() { return (this.item && this.item.pendant) || '' },
    verifyText() {
      const it = this.item
      const desc = (it && it.officialDesc) || ''
      if (!desc) return ''
      return ((it.officialType === 1) ? 'bilibili机构认证：' : 'bilibili个人认证：') + desc
    }
  },
  methods: {
    onShow() {
      this.logged = hasCookie()
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
    onUnload() {
      if (this.ime) { try { this.ime.destroy() } catch (e) {} this.ime = null }
    },
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
      this.replies = []
      this.total = 0
      this.pn = 1
      this.hasMore = false
      this.cStatus = ''
      this.actStatus = ''
      this.liked = false
      this.likeText = '0'
      this.load()
    },
    retry() { this.generation++; this.loading = false; this.status = '加载中…'; this.load() },
    back() { try { this.$page.finish() } catch (e) {} },
    goLogin() { try { $falcon.navTo('login', {}) } catch (e) {} },
    openUp() {
      const mid = (this.item && this.item.mid) || 0
      if (!mid) return
      try { $falcon.navTo('up', { mid: String(mid), name: this.author }) } catch (e) { this.status = '打开主页失败' }
    },
    openOrigUp() {
      const mid = (this.orig && this.orig.authorMid) || 0
      if (!mid) return
      try { $falcon.navTo('up', { mid: String(mid), name: this.orig.author }) } catch (e) { this.status = '打开主页失败' }
    },
    async load() {
      if (this.loading) return
      if (!this.id) return
      this.loading = true
      this.status = '加载中…'
      const self = this
      const gen = ++this.generation
      afterPaint(async function () {
        try {
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
            self.rows = chunkRows(it.pics || [], GRID_COLS)
            self.origRows = it.orig ? chunkRows(it.orig.pics || [], GRID_COLS) : []
            self.liked = !!(it.stat && it.stat.liked)
            self.likeText = (it.stat && it.stat.likeText) || '0'
            self.replyText = (it.stat && it.stat.replyText) || '0'
            self.forwardText = (it.stat && it.stat.forwardText) || '0'
            self.commentType = it.commentType || 11
            self.commentOid = it.commentOid || ''
          }
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
              log('动态详情', '渲染 id=' + self.id + ' 全文=' + (full ? full.blocks.length + '块' : '无')
                + ' 本体=' + (it ? it.kind : '无') + ' 转发视频=' + (it && it.orig && it.orig.archive ? '有' : '无')
                + ' 评论区=' + self.commentType + '/' + self.commentOid)
            } catch (e4) {}
          }
          if (self.commentOid) self.loadComments(true, false)
          else self.cStatus = '这条动态没有评论区'
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

    // ---------------- 点赞 (动态) ----------------
    async doLike() {
      if (this.liking) return
      if (!hasCookie()) { this.actStatus = '登录后才能点赞'; return }
      const want = !this.liked
      this.liking = true
      this.liked = want
      this.likeText = bumpCount(this.likeText, want)
      try {
        await likeDynamic(this.id, want)
        this.actStatus = want ? '已点赞' : '已取消赞'
        try { log('动态详情', '点赞 ' + (want ? 'on' : 'off') + ' id=' + this.id) } catch (e0) {}
      } catch (err) {
        this.liked = !want
        this.likeText = bumpCount(this.likeText, !want)
        this.actStatus = (err && err.message) ? err.message : '点赞失败'
        try { log('动态详情', '点赞失败 ' + this.actStatus) } catch (e1) {}
      } finally {
        this.liking = false
      }
    },

    // ---------------- 评论 ----------------
    switchSort(mode) {
      if (this.sortMode === mode) return
      this.sortMode = mode
      this.replies = []
      this.total = 0
      this.pn = 1
      this.hasMore = false
      this.cGeneration++
      this.cStatus = '加载中…'
      this.loadComments(true, true)
    },
    async loadComments(reset, fresh) {
      if (!this.commentOid) return
      if (this.cLoading) return
      if (!reset && !this.hasMore) return
      this.cLoading = true
      if (reset) this.cStatus = '加载中…'
      const self = this
      const gen = ++this.cGeneration
      const pn = reset ? 1 : this.pn
      try {
        const r = await getReplies(this.commentOid, pn, BUILTIN_EMOJI, this.sortMode, fresh, this.commentType)
        if (gen !== this.cGeneration) return
        if (reset) this.replies = []
        for (let i = 0; i < r.replies.length; i++) {
          const item = r.replies[i]
          item.expanded = false   // 推入时声明, 保证响应式 (点击展开用)
          this.replies.push(item)
        }
        this.total = r.total || 0
        this.hasMore = r.replies.length >= 20
        this.pn = pn + 1
        this.cStatus = ''
        try { log('动态详情', '评论 ' + this.replies.length + ' 条 (total=' + this.total + ' pn=' + pn + ' type=' + this.commentType + ')') } catch (e0) {}
      } catch (err) {
        if (gen !== this.cGeneration) return
        this.cStatus = (err && err.message) ? err.message : String(err)
        try { log('动态详情', '评论失败 ' + this.cStatus) } catch (e2) {}
      } finally {
        if (gen === this.cGeneration) this.cLoading = false
      }
    },
    loadMoreComments() { if (this.cLoading || !this.hasMore) return; this.loadComments(false, false) },
    toggleReplyText(r) { r.expanded = !r.expanded },
    async toggleReplyLike(r) {
      if (!hasCookie()) { this.cStatus = '登录后才能点赞'; return }
      const want = !r.liked
      r.liked = want
      const before = r.likeText
      r.likeText = bumpCount(before, want)
      try {
        await likeReply(this.commentOid, r.rpid, want, this.commentType)
        this.cStatus = want ? '已点赞' : '已取消赞'
      } catch (err) {
        r.liked = !want
        r.likeText = before
        this.cStatus = (err && err.message) ? err.message : '点赞失败'
      }
    },
    openSubReply(r) {
      if (!r || !r.rpid) return
      try {
        $falcon.navTo('subreply', {
          aid: this.commentOid, root: r.rpid, ctype: this.commentType,
          author: r.author, face: r.face, count: r.replyCount, msg: r.message
        })
      } catch (e) { this.cStatus = '打开楼中楼失败' }
    },
    // 发评论: 系统输入法拿文本 -> addReply (type 用本动态的 commentType)
    async openPostInput() {
      if (!hasCookie()) { this.cStatus = '登录后才能评论'; this.goLogin(); return }
      if (this.ime == null) this.ime = createIME()
      try {
        const text = await this.ime.open({
          text: '',
          placeholder: '说点什么…',
          maxlength: 500,
          multiLinesEditVisible: false,
          enterButtonText: '发送',
          confirmText: '发送'
        })
        if (text === null || text.trim() === '') return
        await this.postComment(text.trim())
      } catch (err) {
        this.cStatus = '输入失败: ' + (err && err.message ? err.message : err)
      }
    },
    async postComment(message) {
      if (this.posting) return
      if (!this.commentOid) { this.cStatus = '这条动态没有评论区'; return }
      this.posting = true
      this.cStatus = '发送中…'
      try {
        await addReply(this.commentOid, message, null, null, this.commentType)
        this.pn = 1
        this.replies = []
        this.total = 0
        this.cStatus = '已发送'
        try { log('动态详情', '评论已发送 len=' + message.length + ' type=' + this.commentType) } catch (e0) {}
        this.loadComments(true, true)
      } catch (err) {
        this.cStatus = '发送失败: ' + (err && err.message ? err.message : err)
      } finally {
        this.posting = false
      }
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
.dtime { font-size: 15px; color: #7c8592; padding-right: 16px; }

/* ---- 左栏: 内容 ---- */
.dleft { position: absolute; left: 0px; top: 44px; width: 580px; height: 222px; flex-direction: column; }
.actrow { height: 36px; flex-direction: row; align-items: center; padding-left: 16px; background-color: #16181d; }
.act-btn { height: 26px; flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; border-radius: 13px; background-color: #232830; margin-right: 10px; }
.act-on { background-color: #3a2733; }
.act-static { background-color: #1b1e24; }
.act-text { font-size: 16px; color: #cfd5de; }
.act-text-on { color: #fb7299; }
.act-num { font-size: 15px; color: #8a94a6; margin-left: 6px; }
.act-num-on { color: #fb7299; }
.act-status { font-size: 15px; color: #e6a23c; margin-left: 2px; }
.dstatus { position: absolute; left: 0px; top: 36px; width: 580px; height: 40px; flex-direction: row; justify-content: center; align-items: center; }
.dstatus-ic { margin-right: 6px; }
.dstatus-t { font-size: 17px; color: #8a93a0; }
.dscroll { position: absolute; left: 0px; top: 36px; width: 580px; height: 186px; }
.dwrap { padding-left: 18px; padding-right: 16px; padding-bottom: 14px; }
.ahead { flex-direction: row; align-items: center; margin-top: 6px; margin-bottom: 4px; }
.aface-wrap { position: relative; width: 36px; height: 36px; margin-right: 8px; }
.aface { width: 36px; height: 36px; border-radius: 18px; background-color: #232830; }
.apendant { position: absolute; right: -5px; bottom: -4px; width: 22px; height: 22px; }
.aface-ph { justify-content: center; align-items: center; }
.aface-t { font-size: 17px; color: #7c8592; }
.acol { flex-direction: column; }
.anamerow { flex-direction: row; align-items: center; }
.aname { font-size: 17px; color: #8fb8ff; }
.atime { font-size: 14px; color: #7c8592; margin-left: 8px; }
.averify { flex-direction: row; align-items: center; margin-top: 2px; }
.averify-badge { width: 18px; height: 18px; border-radius: 9px; margin-right: 6px; justify-content: center; align-items: center; }
.averify-per { background-color: #ffac2c; }
.averify-org { background-color: #3ca5ec; }
.averify-t { font-size: 14px; color: #8a94a6; width: 460px; lines: 1; text-overflow: ellipsis; overflow: hidden; }
.artitle { font-size: 24px; color: #ffffff; margin-top: 6px; margin-bottom: 2px; lines: 4; }
.pblock { margin-top: 8px; }
.ptext { font-size: 18px; color: #dfe4ea; }
.pquote { font-size: 18px; color: #aab2bd; padding-left: 12px; padding-right: 8px; padding-top: 6px; padding-bottom: 6px; background-color: #1a1d22; border-radius: 8px; }
.phl { color: #8fb8ff; }
.pimg { border-radius: 10px; background-color: #232830; margin-top: 4px; }
.pimg-i { border-radius: 10px; }
.plist-row { flex-direction: row; margin-top: 4px; }
.plist-mark { font-size: 18px; color: #8fb8ff; margin-right: 6px; }
.plist-txt { font-size: 18px; color: #dfe4ea; }
.pcode { font-size: 16px; color: #cfe0ff; background-color: #1a1d22; padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px; border-radius: 8px; }
.pline { height: 2px; background-color: #2b313a; margin-top: 10px; margin-bottom: 4px; }
.pcard { padding: 8px; background-color: #262b33; border-radius: 8px; }
.pcard-t { font-size: 16px; color: #8fb8ff; }
.pics { margin-top: 6px; }
.pic-row { flex-direction: row; }
.pic-box { margin-right: 6px; margin-bottom: 6px; border-radius: 8px; background-color: #232830; }
.pic-img { border-radius: 8px; }
.vcard { flex-direction: row; margin-top: 8px; padding: 8px; background-color: #262b33; border-radius: 8px; }
.vcover { width: 140px; height: 88px; border-radius: 6px; margin-right: 10px; }
.vmeta { flex: 1; }
.vtitle { font-size: 17px; color: #ffffff; lines: 2; }
.vstatrow { flex-direction: row; align-items: center; margin-top: 6px; }
.vstat-ic { margin-right: 4px; }
.vstat { font-size: 15px; color: #888888; }
.ostat { margin-top: 8px; padding: 8px; background-color: #1a1d22; border-radius: 8px; }
.olabel { font-size: 16px; color: #8fb8ff; }

/* ---- 右栏: 评论 + 发评栏 ---- */
.dsep { position: absolute; left: 580px; top: 44px; width: 2px; height: 222px; background-color: #232830; }
.dright { position: absolute; left: 582px; top: 44px; width: 378px; height: 222px; flex-direction: column; }
.sortbar { height: 30px; flex-direction: row; align-items: center; padding-left: 8px; background-color: #1a1d22; }
.sort-item { height: 24px; justify-content: center; align-items: center; padding-left: 10px; padding-right: 10px; border-radius: 12px; margin-right: 6px; }
.sort-on { background-color: #2c313a; }
.sort-text { font-size: 15px; color: #8a94a6; }
.sort-text-on { color: #fb7299; }
.sort-count { font-size: 14px; color: #5c6672; margin-left: 4px; }
.clist { position: absolute; left: 0px; top: 30px; width: 378px; height: 152px; flex-direction: column; padding-left: 12px; padding-right: 12px; }
.c-status { font-size: 16px; color: #e6a23c; margin-top: 6px; margin-bottom: 6px; }
.reply { flex-direction: row; padding-top: 8px; padding-bottom: 8px; border-bottom-width: 1px; border-bottom-color: #262b33; }
.face { width: 44px; height: 44px; border-radius: 22px; margin-right: 10px; }
.reply-main { width: 300px; flex-direction: column; }
.reply-head { flex-direction: row; align-items: center; margin-bottom: 2px; }
.reply-author { font-size: 16px; color: #8a94a6; margin-right: 10px; }
.reply-time { font-size: 14px; color: #5c6672; }
.tag { font-size: 14px; padding-left: 8px; padding-right: 8px; padding-top: 2px; padding-bottom: 2px; border-radius: 6px; margin-right: 8px; justify-content: center; }
.tag-pin { background-color: #fb7299; color: #ffffff; }
.tag-up { background-color: #2f80ed; color: #ffffff; }
.reply-wrap { position: relative; width: 100%; }
.reply-msg { font-size: 17px; color: #e8edf3; lines: 3; text-overflow: ellipsis; overflow: hidden; margin-top: 2px; }
.reply-msg-open { lines: 0; }
.reply-more { position: absolute; right: 0px; bottom: 0px; padding-left: 8px; font-size: 17px; color: #e8edf3; background-color: #14161a; }
.reply-meta { flex-direction: row; align-items: center; margin-top: 3px; }
.meta-btn { flex-direction: row; align-items: center; padding-top: 6px; padding-bottom: 6px; margin-right: 18px; }
.meta-text { lines: 1; font-size: 15px; color: #8a94a6; margin-left: 4px; }
.meta-liked { color: #fb7299; }
.meta-reply { font-size: 15px; color: #8a94a6; margin-left: 4px; }
.load-more { font-size: 16px; color: #8fb8ff; text-align: center; padding-top: 10px; padding-bottom: 10px; }
.empty { font-size: 16px; color: #8a93a0; text-align: center; margin-top: 16px; }
.postbar { position: absolute; left: 0px; top: 182px; width: 378px; height: 40px; flex-direction: row; align-items: center; background-color: #21242b; padding-left: 10px; padding-right: 10px; }
.post-input { width: 248px; height: 32px; border-radius: 16px; background-color: #2a2f38; justify-content: center; padding-left: 14px; }
.post-input-text { font-size: 16px; color: #8a94a6; }
.post-btn { width: 78px; height: 32px; border-radius: 16px; background-color: #fb7299; justify-content: center; align-items: center; margin-left: 8px; }
.post-btn-text { font-size: 16px; color: #ffffff; }

/* ---- 图片查看器 ---- */
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
