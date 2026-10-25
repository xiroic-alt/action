<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏 44px: 标题先用跳转参数里的 name 顶着 (接口没回来前也有东西可看),
         空间信息回来后再换成接口里的真名 -->
    <AppBar :title="barTitle" :back="true" @back="onBack"></AppBar>

    <div class="main">
      <!-- 左栏固定 300px. 为什么分栏: 笔屏纵向只有 222px, 上游 PiliNara 的
           "名片 -> tab -> 列表" 纵向堆叠在这里会把列表挤到看不见, 所以名片与列表左右并排 -->
      <div class="side">
        <div class="srow">
          <div class="avbox" :style="avBox">
            <image v-if="faceUrl !== ''" class="avimg" :src="faceUrl" resize="cover" :style="avBox"></image>
          </div>
          <div class="sinfo">
            <RichText class="sname" :text="hostName" :size="U.f.subtitle" :color="U.c.onSurface" :lines="1" weight="bold" :drop-emoji="false" />
            <div class="smeta">
              <div v-if="level > 0" class="lv" :style="lvStyle">
                <text class="lvt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">LV{{ level }}</text>
              </div>
              <text v-if="fansLine !== ''" class="sfans" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ fansLine }}</text>
              <text v-if="vip !== ''" class="svip" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.primary }">{{ vip }}</text>
            </div>
          </div>
        </div>

        <!-- 签名: 用户内容必须走 RichText (emoji 要拆成独立字体段的 text).
             盒高 40px + overflow hidden = 最多 2 行, 超大字体档也不会顶穿 222px -->
        <div class="signbox">
          <RichText class="sign" :text="signText" :size="U.f.caption" :color="U.c.onSurfaceVariant" :lines="2" :drop-emoji="false" />
        </div>

        <div class="stats">
          <div v-for="(s, i) in stats" :key="'st_' + i" class="stat">
            <text class="statv" :lines="1" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurface }">{{ s.v }}</text>
            <text class="statl" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ s.l }}</text>
          </div>
        </div>

        <!-- 关注按钮: 命中区 44px 高 (整栏宽 276px), 未登录时接口会抛错, 用底部轻提示引导去登录 -->
        <div class="fbtn" :style="followStyle" @click="toggleFollow">
          <text class="fbtnt" :lines="1" :style="followTextStyle">{{ followLabel }}</text>
        </div>
      </div>

      <div class="vdiv" :style="vdivStyle"></div>

      <div class="right" :style="rightStyle">
        <!-- 顶部操作条 (44px): 投稿 / 动态 两个 tab + 已加载计数 + 刷新 -->
        <div class="tabs">
          <div class="tab" :style="tabStyle('video')" @click="pickTab('video')">
            <text class="tabt" :lines="1" :style="tabText('video')">投稿</text>
          </div>
          <div class="tab" :style="tabStyle('dyn')" @click="pickTab('dyn')">
            <text class="tabt" :lines="1" :style="tabText('dyn')">动态</text>
          </div>
          <text class="tabcnt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ countLine }}</text>
          <div class="tabact" :style="{ width: '44px', height: '44px' }" @click="reloadCurrent">
            <image class="tabic" :src="MIc.refresh" :style="{ width: '20px', height: '20px' }"></image>
          </div>
        </div>

        <scroller class="body" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
          <div v-if="loading && rowCount === 0" class="hint">
            <text class="hintt" :style="U.t.weak">加载中…</text>
          </div>
          <div v-else-if="rowCount === 0" class="hint">
            <text class="hintt" :style="U.t.weak">{{ statusText }}</text>
          </div>

          <!-- 投稿 tab: 横向卡片 (120x75 封面 + 标题 2 行 + 播放/弹幕), 点进播放页 -->
          <div v-else-if="tab === 'video'" class="rows">
            <div v-for="(v, i) in videos" :key="v.bvid + '_' + i" class="vrow" :style="vrowStyle" @click="openVideo(v)">
              <div class="cover" :style="coverBox">
                <image v-if="v.pic !== ''" class="cimg" :src="v.pic" resize="cover" :style="coverBox"></image>
                <div v-if="v.durationText !== ''" class="dur" :style="durStyle">
                  <text class="durt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">{{ v.durationText }}</text>
                </div>
              </div>
              <div class="vinfo">
                <RichText class="vtitle" :text="v.title" :size="U.f.body" :color="U.c.onSurface" :lines="2" :drop-emoji="false" />
                <text class="vmeta" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ vmetaText(v) }}</text>
              </div>
            </div>
            <div class="foot">
              <div class="more" :style="moreStyle" @click="loadMore">
                <text class="moret" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ moreText }}</text>
              </div>
            </div>
          </div>

          <!-- 动态 tab: 简化列表 (头像 + 作者 + 时间 + 正文 2 行).
               为什么整行不可点: 笔上不做动态详情页, 挂了点击只会给用户一个点不动的死区 -->
          <div v-else class="rows">
            <div v-for="(d, i) in dyns" :key="dynKey(d, i)" class="drow" :style="drowStyle">
              <div class="dav" :style="davBox">
                <image v-if="d.face !== ''" class="davimg" :src="d.face" resize="cover" :style="davBox"></image>
              </div>
              <div class="dinfo">
                <div class="dhead">
                  <RichText class="dauthor" :text="d.author" :size="U.f.caption" :color="U.c.onSurface" :lines="1" weight="bold" :style="{ flex: 1 }" :drop-emoji="false" />
                  <text class="dtime" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ d.timeText }}</text>
                </div>
                <RichText class="dtext" :text="dynText(d)" :size="U.f.caption" :color="U.c.onSurfaceVariant" :lines="2" :drop-emoji="false" />
              </div>
            </div>
            <div class="foot">
              <div class="more" :style="moreStyle" @click="loadMore">
                <text class="moret" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ moreText }}</text>
              </div>
            </div>
          </div>
        </scroller>
      </div>
    </div>

    <!-- 轻提示 (框架没有 toast): 关注成功/失败、未登录、分页失败都走这里 -->
    <div v-if="tip !== ''" class="tip" :style="tipStyle">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
import RichText from '../../components/rich-text.vue'
// UP 主空间 —— 对应 PiliNara lib/pages/member_home:
//   左: 头像 / 昵称 / 等级 / 粉丝 / 签名 / 关注按钮; 右: 投稿 + 动态 两个 tab 的列表.
// 与上游的差异 (笔屏 960x266):
//   1. 上游是"名片在上 + tab + 列表"的纵向堆叠, 222px 高度放不下 -> 改左右分栏
//   2. 动态只做简化列表 (头像/作者/时间/正文), 不做动态详情跳转 (笔上没这个页面)
//   3. 关注态不能只靠本地开关: 空间接口不返回"我关注了 TA 没有",
//      权威字段是 userCard 的 data.following, 否则已关注的用户点一下只会拿到接口报错
import AppBar from '../../components/app-bar.vue'
import { ui } from '../../design/ui.js'
import { SCREEN } from '../../design/tokens.js'
import { playCount } from '../../services/format.js'
import { log } from '../../core/log.js'
import { spaceInfo, spaceVideos, spaceDynamics, relationModify, userCard } from '../../services/api.js'

// ---- 笔屏几何: 数字只在这里出现, 模板与样式都从这里取 ----
const SIDE_W = 300
const RIGHT_W = SCREEN.width - SIDE_W - 1        // 1px 是竖分割线
const CONTENT_H = SCREEN.content
const AV = 56
const COVER_W = 120
const COVER_H = 75                                // 120 / 75 = 16:10, 同 tokens.js SPEC.coverRatio
const VROW_H = 83                                 // 75 封面 + 上下各 4 的内边距
const DAV = 36
const DROW_H = 62
const VIDEO_PS = 20                               // spaceVideos 内部固定 ps=20: 不足一页即到底
const TIP_MS = 2000

const MI = { refresh: require('../../assets/mi/refresh_24_w.png') }
const MI_D = { refresh: require('../../assets/mi/refresh_24_d.png') }

export default {
  components: { AppBar, RichText },
  name: 'member',
  data() {
    return {
      U: ui(),
      // ★ 世代守卫必须是 data 里的普通数字键: Vue2 不代理 _ 开头的键, ++undefined = NaN,
      //   而 NaN !== NaN 恒真, 响应会被永远判成"过期"直接丢弃 (项目历史踩过)
      infoGen: 0,
      paramKey: '',
      vidGen: 0,
      dynGen: 0,
      mid: '',
      nameOpt: '',
      info: null,
      follow: false,
      followBusy: false,
      tab: 'video',
      videos: [],
      vidPage: 0,        // 已加载到第几页 (spaceVideos 的 pn 从 1 开始)
      vidMore: true,
      vidLoading: false,
      vidStatus: '',
      dyns: [],
      dynOffset: '',     // 动态是游标分页: 首页传空串, 之后用上一页返回的 offset
      dynMore: true,
      dynLoading: false,
      dynStatus: '',
      dynLoaded: false,
      cardFans: '',      // userCard 的粉丝数: 空间接口的 fans 常年是 0, 用它兜底
      tip: '',
      SIDE_W: SIDE_W,
      AV: AV,
      COVER_W: COVER_W,
      COVER_H: COVER_H,
      VROW_H: VROW_H,
      DROW_H: DROW_H
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    hostName() {
      if (this.info && this.info.name) return this.info.name
      return this.nameOpt !== '' ? this.nameOpt : 'UP 主空间'
    },
    barTitle() { return this.hostName },
    faceUrl() { return (this.info && this.info.face) ? this.info.face : '' },
    level() { return this.info ? (Number(this.info.level) || 0) : 0 },
    vip() { return (this.info && this.info.vip) ? String(this.info.vip) : '' },
    fansText() {
      const f = this.info ? (Number(this.info.fans) || 0) : 0
      if (f > 0) return this.info.fansText || playCount(f)
      return this.cardFans
    },
    fansLine() {
      if (this.fansText === '') return ''
      return '粉丝 ' + this.fansText
    },
    signText() {
      if (this.mid === '') return '缺少 mid 参数'
      if (this.info) return this.info.sign || '这个人很懒, 什么都没写'
      return '加载中…'
    },
    stats() {
      const i = this.info || {}
      return [
        { l: '投稿', v: playCount(i.archive || 0) },
        { l: '粉丝', v: this.fansText !== '' ? this.fansText : '--' },
        { l: '获赞', v: playCount(i.like || 0) }
      ]
    },
    followLabel() { return this.follow ? '已关注' : '关注' },
    loading() { return this.tab === 'video' ? this.vidLoading : this.dynLoading },
    rowCount() { return this.tab === 'video' ? this.videos.length : this.dyns.length },
    statusText() {
      if (this.mid === '') return '缺少 mid 参数'
      const s = this.tab === 'video' ? this.vidStatus : this.dynStatus
      return s !== '' ? s : '这里什么都没有'
    },
    canMore() { return this.tab === 'video' ? this.vidMore : this.dynMore },
    moreText() {
      if (this.loading) return '加载中…'
      return this.canMore ? '加载更多' : '没有更多了'
    },
    countLine() {
      if (this.rowCount === 0) return ''
      return this.tab === 'video' ? '已加载 ' + this.videos.length + ' 个投稿' : '已加载 ' + this.dyns.length + ' 条动态'
    },

    // ---- 样式 ----
    avBox() {
      return {
        width: AV + 'px',
        height: AV + 'px',
        borderRadius: (AV / 2) + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest
      }
    },
    lvStyle() {
      return {
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.chip + 'px'
      }
    },
    followStyle() {
      return {
        backgroundColor: this.follow ? this.U.c.surfaceContainerHighest : this.U.c.primary,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    followTextStyle() {
      return {
        fontSize: this.U.f.body + 'px',
        color: this.follow ? this.U.c.onSurfaceVariant : this.U.c.onPrimary
      }
    },
    vdivStyle() { return { backgroundColor: this.U.c.outlineVariant, width: '1px', height: CONTENT_H + 'px' } },
    rightStyle() { return { width: RIGHT_W + 'px', height: CONTENT_H + 'px' } },
    coverBox() {
      return {
        width: COVER_W + 'px',
        height: COVER_H + 'px',
        borderRadius: this.U.rad.card + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest
      }
    },
    durStyle() {
      return { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: '6px' }
    },
    davBox() {
      return {
        width: DAV + 'px',
        height: DAV + 'px',
        borderRadius: (DAV / 2) + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest
      }
    },
    vrowStyle() { return { backgroundColor: this.U.c.surfaceContainerLow, borderRadius: this.U.rad.card + 'px' } },
    drowStyle() { return { backgroundColor: this.U.c.surfaceContainerLow, borderRadius: this.U.rad.card + 'px' } },
    moreStyle() { return { backgroundColor: this.U.c.surfaceContainerHighest, borderRadius: this.U.rad.btn + 'px' } },
    tipStyle() { return { backgroundColor: this.U.c.inverseSurface, borderRadius: this.U.rad.chip + 'px' } }
  },
  mounted() {
    // ★ 参数统一走 readOptions(): mounted 在设备上不一定被调用
    this.readOptions()
  },
  methods: {
    // 框架只转发 onShow / onPageUnload 这两个钩子
    onShow() {
      this.U = ui()
      this.readOptions()
    },
    /** 读取页面参数 (mounted 不保证触发, onShow 也要读; 同 mid 幂等) */
    readOptions() {
      const o = (this.$page && this.$page.options) || {}
      const mid = String(o.mid == null ? '' : o.mid)
      if (this.paramKey === mid && mid !== '') return
      this.paramKey = mid
      this.mid = mid
      this.nameOpt = String(o.name == null ? '' : o.name)
      if (this.mid === '') { this.status = '缺少 mid 参数'; log('空间', '缺少 mid 参数'); return }
      log('空间', '载入 mid=' + this.mid)
      this.loadInfo()
      this.loadVideos(true)
    },
    onPageUnload() {
      this.infoGen++
      this.vidGen++
      this.dynGen++
      if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null }
    },

    // ---------------- 名片 ----------------
    async loadInfo() {
      const gen = ++this.infoGen
      try {
        const info = await spaceInfo(this.mid)
        if (gen !== this.infoGen) return
        this.info = info
        log('空间', '名片 ' + info.name + ' 粉丝 ' + info.fansText)
      } catch (e) {
        if (gen !== this.infoGen) return
        log('空间', '名片失败: ' + (e && e.message ? e.message : e))
        this.showTip('UP 主信息加载失败')
      }
      // 关注态单独一路: 空间接口没有这个字段, userCard 的 data.following 才权威.
      // 失败就保持默认(未关注), 点关注时接口会给出真实结果
      try {
        const c = await userCard(this.mid)
        if (gen !== this.infoGen) return
        this.follow = !!c.following
        this.cardFans = c.fansText || ''
      } catch (e) {}
    },

    async toggleFollow() {
      if (this.mid === '') { this.showTip('缺少 mid 参数'); return }
      if (this.followBusy) return
      this.followBusy = true
      const act = this.follow ? 2 : 1
      try {
        await relationModify(this.mid, act)
        this.follow = act === 1
        this.showTip(act === 1 ? '已关注' : '已取消关注')
        log('空间', act === 1 ? '已关注 ' + this.mid : '已取关 ' + this.mid)
      } catch (e) {
        const msg = e && e.message ? e.message : String(e)
        log('空间', '关注失败: ' + msg)
        // 未登录 (缺少 SESSDATA / csrf) 时接口给的是技术文案, 用户只需要知道去登录
        if (/csrf|登录|SESSDATA/i.test(msg)) this.showTip('请先登录')
        else this.showTip('操作失败: ' + msg)
      } finally {
        this.followBusy = false
      }
    },

    // ---------------- 投稿 ----------------
    async loadVideos(reset) {
      if (this.mid === '') return
      const gen = ++this.vidGen
      if (reset) {
        this.videos = []
        this.vidPage = 0
        this.vidMore = true
        this.vidStatus = ''
      }
      this.vidLoading = true
      try {
        const pn = this.vidPage + 1
        const list = await spaceVideos(this.mid, pn)
        if (gen !== this.vidGen) return
        this.vidPage = pn
        this.videos = reset ? list : this.videos.concat(list)
        // 接口不给总页数: 不足一页就是到底了
        this.vidMore = list.length >= VIDEO_PS
        if (this.videos.length === 0) this.vidStatus = 'TA 还没有投稿'
        else this.vidStatus = this.vidMore ? '' : '没有更多了'
        log('空间', '投稿第 ' + pn + ' 页 -> 累计 ' + this.videos.length + ' 个')
      } catch (e) {
        if (gen !== this.vidGen) return
        const msg = e && e.message ? e.message : String(e)
        this.vidMore = false
        this.vidStatus = '加载失败: ' + msg
        this.showTip('投稿加载失败')
      } finally {
        if (gen === this.vidGen) this.vidLoading = false
      }
    },

    // ---------------- 动态 ----------------
    async loadDynamics(reset) {
      if (this.mid === '') return
      const gen = ++this.dynGen
      if (reset) {
        this.dyns = []
        this.dynOffset = ''
        this.dynMore = true
        this.dynStatus = ''
      }
      this.dynLoading = true
      try {
        const r = await spaceDynamics(this.mid, reset ? '' : this.dynOffset)
        if (gen !== this.dynGen) return
        const items = r.items || []
        this.dyns = reset ? items : this.dyns.concat(items)
        this.dynOffset = r.offset || ''
        // 游标为空却声称还有下一页时停手: 否则会反复拉第 1 页, 列表里出现重复动态
        this.dynMore = !!r.hasMore && this.dynOffset !== ''
        this.dynLoaded = true
        if (this.dyns.length === 0) this.dynStatus = 'TA 还没有发布动态'
        else this.dynStatus = this.dynMore ? '' : '没有更多了'
        log('空间', '动态 +' + items.length + ' -> 累计 ' + this.dyns.length + ' 条')
      } catch (e) {
        if (gen !== this.dynGen) return
        const msg = e && e.message ? e.message : String(e)
        this.dynMore = false
        this.dynLoaded = true
        this.dynStatus = '加载失败: ' + msg
        this.showTip('动态加载失败')
      } finally {
        if (gen === this.dynGen) this.dynLoading = false
      }
    },

    // ---------------- 交互 ----------------
    pickTab(t) {
      if (t !== 'video' && t !== 'dyn') return
      if (this.tab === t) { this.reloadCurrent(); return }        // 点当前 tab = 重拉 (PiliNara toTopAndRefresh)
      this.tab = t
      // 动态是第一次切过来才拉; 已经在拉就等它 (避免来回切 tab 放大请求)
      if (t === 'dyn' && !this.dynLoaded && !this.dynLoading) this.loadDynamics(true)
    },
    reloadCurrent() {
      if (this.mid === '') return
      if (this.tab === 'video') this.loadVideos(true)
      else this.loadDynamics(true)
    },
    loadMore() {
      if (this.mid === '') return
      if (this.loading) return
      if (!this.canMore) return
      if (this.tab === 'video') this.loadVideos(false)
      else this.loadDynamics(false)
    },
    onScroll(e) {
      // scroller 的 detail 在快到底时会带 scrollBottom, 提前触发下一页
      const d = (e && e.detail) ? e.detail : {}
      if (d.scrollBottom != null && d.scrollBottom < 80) this.loadMore()
    },
    openVideo(v) {
      if (!v || !v.bvid) return
      log('空间', '打开 ' + v.bvid)
      try { $falcon.navTo('video', { bvid: v.bvid, title: v.title }) } catch (e) {}
    },

    // ---------------- 文案 ----------------
    vmetaText(v) {
      const parts = []
      if (v.playText) parts.push(v.playText + ' 播放')
      if (v.danmakuText) parts.push(v.danmakuText + ' 弹幕')
      return parts.length ? parts.join(' · ') : '暂无播放数据'
    },
    dynText(d) {
      if (d.text) return d.text
      // 纯图/视频/专栏动态正文是空的: 用占位说明, 否则卡片看起来像加载坏了
      if (d.video && d.video.title) return '[视频] ' + d.video.title
      if (d.article && d.article.title) return '[专栏] ' + d.article.title
      if (d.repost) return '[转发] ' + (d.repost.text || (d.repost.video && d.repost.video.title) || '')
      if (d.pics && d.pics.length) return '[图片 x' + d.pics.length + ']'
      return '(无正文)'
    },
    dynKey(d, i) { return 'dy_' + (d.id || i) },

    // ---------------- 样式 ----------------
    tabStyle(id) {
      const on = id === this.tab
      return {
        backgroundColor: on ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.chip + 'px'
      }
    },
    tabText(id) {
      const on = id === this.tab
      return {
        fontSize: this.U.f.body + 'px',
        color: on ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    },

    // ---------------- 导航 / 提示 ----------------
    onBack() {
      try { this.$page.finish() } catch (e) {
        try { $falcon.navTo('index', {}) } catch (e2) {}
      }
    },
    showTip(msg) {
      this.tip = String(msg || '')
      if (this._tipTimer) clearTimeout(this._tipTimer)
      const self = this
      this._tipTimer = setTimeout(function () {
        self.tip = ''
        self._tipTimer = null
      }, TIP_MS)
    }
  }
}
</script>

<style scoped>
/* 页面根: 绝对定位铺满笔屏 (960x266), 顶栏 44 + 内容 222 */
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
.main { flex: 1; width: 100%; flex-direction: row; }

/* ---- 左栏 300px ---- */
.side { width: 300px; height: 222px; flex-direction: column; padding-left: 12px; padding-right: 12px; padding-top: 10px; }
.srow { width: 100%; height: 56px; flex-direction: row; align-items: center; }
.avbox { overflow: hidden; }
.avimg { }
.sinfo { flex: 1; height: 56px; flex-direction: column; justify-content: center; margin-left: 10px; }
.sname { width: 100%; }
.smeta { width: 100%; height: 20px; flex-direction: row; align-items: center; margin-top: 4px; }
.lv { height: 18px; padding-left: 6px; padding-right: 6px; justify-content: center; align-items: center; }
.lvt { }
.sfans { margin-left: 8px; }
.svip { margin-left: 8px; }
.signbox { width: 100%; height: 40px; margin-top: 6px; overflow: hidden; }
.sign { width: 100%; }
.stats { width: 100%; height: 40px; flex-direction: row; align-items: center; margin-top: 2px; }
.stat { flex: 1; height: 40px; flex-direction: column; justify-content: center; align-items: center; }
.statv { }
.statl { }
.fbtn { width: 100%; height: 44px; margin-top: 2px; justify-content: center; align-items: center; }
.fbtnt { }

/* ---- 分割线 + 右栏 ---- */
.vdiv { }
.right { flex-direction: column; }

/* ---- 顶部操作条 ---- */
.tabs { width: 100%; height: 44px; flex-direction: row; align-items: center; padding-left: 12px; padding-right: 4px; }
.tab { height: 44px; padding-left: 14px; padding-right: 14px; margin-right: 8px; justify-content: center; align-items: center; }
.tabt { }
.tabcnt { flex: 1; margin-left: 4px; }
.tabact { justify-content: center; align-items: center; }
.tabic { }

/* ---- 列表 ---- */
.body { flex: 1; width: 100%; }
.hint { width: 100%; height: 120px; justify-content: center; align-items: center; }
.hintt { }
.rows { flex-direction: column; padding-left: 12px; padding-right: 12px; padding-top: 2px; }
.vrow { width: 100%; height: 83px; flex-direction: row; align-items: center; padding-left: 4px; padding-right: 8px; margin-bottom: 6px; }
.cover { position: relative; overflow: hidden; }
.cimg { }
.dur { position: absolute; right: 4px; bottom: 4px; height: 18px; padding-left: 5px; padding-right: 5px; justify-content: center; align-items: center; }
.durt { }
.vinfo { flex: 1; flex-direction: column; justify-content: center; margin-left: 10px; }
.vtitle { width: 100%; }
.vmeta { width: 100%; margin-top: 4px; }
.drow { width: 100%; height: 62px; flex-direction: row; align-items: center; padding-left: 8px; padding-right: 8px; margin-bottom: 6px; }
.dav { overflow: hidden; }
.davimg { }
.dinfo { flex: 1; flex-direction: column; justify-content: center; margin-left: 10px; }
.dhead { width: 100%; height: 18px; flex-direction: row; align-items: center; }
.dauthor { flex: 1; }
.dtime { margin-left: 8px; }
.dtext { width: 100%; margin-top: 2px; }
.foot { width: 100%; flex-direction: row; justify-content: center; align-items: center; padding-top: 2px; padding-bottom: 12px; }
.more { height: 44px; padding-left: 22px; padding-right: 22px; justify-content: center; align-items: center; }
.moret { }

/* ---- 轻提示 ---- */
.tip { position: absolute; left: 312px; bottom: 8px; width: 440px; height: 40px; justify-content: center; align-items: center; }
.tipt { }
</style>
