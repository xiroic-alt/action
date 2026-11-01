<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 侧栏 (PiliNara NavigationRail 分支; 用户要求用侧栏, 不用底栏) -->
    <NavRail :current="nav" :face="face" @select="onNav" @reselect="onReselect"
             @search="onSearch" @avatar="onMine"></NavRail>

    <!-- ★ 单壳架构: 侧栏固定不动, 只换右侧内容 (用户要求"跟正常手机软件的侧边栏一样").
         nav 状态切换视图, 不做 navTo, 所以没有页面跳转也没有转场动画. -->
    <ViewMine v-if="nav === 'mine'" @user="onUser"></ViewMine>

    <div v-show="nav === 'home'" class="main">
      <!-- 顶部 TabBar: 规格来自 PiliNara lib/pages/home/view.dart
           高度 42 / 上间距 4 / 无分隔线 / 居中 / splash 圆角 10 -->
      <div class="tabbar" :style="{ backgroundColor: U.c.surface }">
        <div v-for="t in tabs" :key="t.id" class="tab" :style="tabStyle(t)" @click="pickTab(t)">
          <text class="tabt" :style="tabTextStyle(t)">{{ t.label }}</text>
          <div v-if="t.id === tab" class="ind" :style="{ backgroundColor: U.c.primary }"></div>
        </div>
      </div>

      <scroller class="body" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
        <!-- 加载动画: 三点跳动.
             为什么用 JS 驱动而不是 CSS 动画: 本框架对 @keyframes 支持不确定,
             而 setInterval + transform/opacity 一定可用 (transform 是明确支持的). -->
        <div v-if="loading && items.length === 0 && status === ''" class="hint">
          <div class="dots">
            <div v-for="n in 3" :key="'d' + n" class="dot" :style="dotStyle(n - 1)"></div>
          </div>
          <text class="hintt" :style="U.t.weak">加载中</text>
        </div>
        <div v-else-if="status !== '' && items.length === 0" class="hint">
          <text class="hintt" :style="U.t.weak">{{ status }}</text>
        </div>
        <div v-else class="grid">
          <div v-for="(v, i) in items" :key="v.bvid + '_' + i" class="cell"
               :style="{ width: cardW + 'px', marginRight: U.sp.sm + 'px', marginBottom: U.sp.sm + 'px' }">
            <VideoCard :v="v" :w="cardW" @open="openVideo"></VideoCard>
          </div>
        </div>
        <div v-if="items.length > 0" class="foot">
          <div class="more" :style="U.action" @click="loadMore">
            <text class="moret" :style="U.t.body">{{ loading ? '加载更多' : '加载更多' }}</text>
          </div>
        </div>
      </scroller>
    </div>

    <!-- 动态: 视图待补, 先给明确占位 (不留空白页) -->
    <div v-if="nav === 'dyn'" class="main">
      <div class="hint">
        <text class="hintt" :style="U.t.weak">动态页开发中</text>
      </div>
    </div>
  </div>
</template>

<script>
// 首页 —— PiliNara 结构: NavigationRail(侧栏) + 页内 TabBar + 卡片网格
// 布局依据见 docs/design-spec.md (逐条标注了上游出处)
import NavRail from '../../components/nav-rail.vue'
import ViewMine from '../../components/view-mine.vue'
import VideoCard from '../../components/video-card.vue'
import { ui } from '../../design/ui.js'
import { SCREEN, SPEC } from '../../design/tokens.js'
import { recommend, popular, bangumiList, liveList } from '../../services/api.js'
import { log } from '../../core/log.js'

// ★ 内容宽 = 屏宽 - 侧栏 - 安全边距. 这里必须用 SPEC.safeSpace:
//   SCREEN 里没有 safeSpace 这个键, 写错会得到 NaN, 卡片宽度就永远停在默认值.
const CONTENT_W = SCREEN.width - SCREEN.navRail - SPEC.safeSpace
// 列数: 笔屏 960x266 极扁, 3 列时封面高 174px + 文字区会超出可视区,
// 4 列封面 129px, 封面+文字 201px, 正好放进 220px 内容区并留出滚动余量.
const COL = 4

export default {
  components: { NavRail, VideoCard, ViewMine },
  name: 'index',
  data() {
    return {
      U: ui(),
      nav: 'home',
      tab: 'rcmd',
      tabs: [
        { id: 'rcmd', label: '推荐' },
        { id: 'hot', label: '热门' },
        { id: 'bangumi', label: '番剧' },
        { id: 'live', label: '直播' }
      ],
      items: [],
      page: 1,
      loading: false,
      status: '',
      face: '',
      cardW: 200,
      genSeq: 0
    }
  },
  mounted() {
    this.layout()
    this.load(true)
  },
  methods: {
    // 组件里只有 onShow 会被框架转发 (设备框架行为)
    onShow() {
      this.U = ui()
      this.layout()
      if (this.items.length === 0) this.load(true)
    },
    /** 卡片宽度: mounted 在设备上不保证被转发, 所以 onShow 也调一次 */
    layout() {
      const inner = CONTENT_W - SPEC.safeSpace
      const w = Math.floor((inner - (COL - 1) * this.U.sp.sm) / COL)
      if (w > 0 && w !== this.cardW) this.cardW = w
    },
    onPageUnload() { this.genSeq++ },

    // ★ 单壳架构: 侧栏点击只切 nav 状态, 不 navTo.
    //   侧栏永远不动, 右侧内容按 nav 切换 —— 这就是"正常手机软件的侧边栏"行为.
    /** 三点加载动画: 每 260ms 推进一相位 */
    startDots() {
      if (this.dotTimer) return
      const self = this
      this.dotTimer = setInterval(function () {
        self.dotPhase = (self.dotPhase + 1) % 3
      }, 260)
    },
    stopDots() {
      if (this.dotTimer) { clearInterval(this.dotTimer); this.dotTimer = null }
    },
    /** 当前相位下的三点样式 (依次点亮) */
    dotStyle(i) {
      const on = (i === this.dotPhase)
      return {
        width: on ? '9px' : '7px',
        height: on ? '9px' : '7px',
        borderRadius: '5px',
        marginRight: '5px',
        backgroundColor: on ? this.U.c.primary : this.U.c.surfaceContainerHighest
      }
    },

    onNav(id) {
      log('首页', '侧栏切到 ' + id)
      this.nav = id
      if (id === 'home' && this.items.length === 0) this.load(true)
    },
    onReselect(id) { if (id === 'home') this.load(true) },
    onMine() { this.nav = 'mine'; log('首页', '头像 -> 我的') },
    /** 子视图广播上来的用户信息: 同步给侧栏头像 (用户要求两者一致) */
    onUser(u) {
      if (!u) return
      this.face = u.face || ''
      log('首页', '同步侧栏头像: ' + (this.face ? '有' : '空') + ' / ' + (u.uname || ''))
    },
    onSearch() { try { $falcon.navTo('search', {}) } catch (e) {} },

    pickTab(t) {
      if (t.id === this.tab) { this.load(true); return }
      this.tab = t.id
      this.items = []
      this.page = 1
      this.load(true)
    },
    tabStyle(t) {
      return {
        height: '34px',
        paddingLeft: '14px',
        paddingRight: '14px',
        marginRight: this.U.sp.sm + 'px',
        borderRadius: this.U.rad.chip + 'px',
        backgroundColor: t.id === this.tab ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest
      }
    },
    tabTextStyle(t) {
      return {
        fontSize: this.U.f.body + 'px',
        color: t.id === this.tab ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    },

    async load(reset) {
      const gen = ++this.genSeq
      if (reset) { this.page = 1; this.status = '' }
      this.loading = true
      this.startDots()
      log('首页', '开始加载 ' + this.tab + ' p' + this.page + ' gen=' + gen)
      try {
        if (this.tab === 'rcmd') {
          const raw = await recommend(12, this.page)
          if (gen !== this.genSeq) return
          // 跳过直播 / 番剧推荐等非视频条目: 首页只放普通视频 (用户要求)
          const list = (raw || []).filter(function (x) {
            if (!x) return false
            if (x.type === 'live' || x.goto === 'live') return false
            if (!x.bvid && !x.aid) return false
            return true
          })
          this.items = reset ? list : this.items.concat(list)
          if (!list.length) this.status = '没有更多了'
        } else if (this.tab === 'hot') {
          const list = await popular(this.page)
          if (gen !== this.genSeq) return
          this.items = reset ? list : this.items.concat(list)
        } else if (this.tab === 'bangumi') {
          const list = await bangumiList()
          if (gen !== this.genSeq) return
          this.items = list
          if (!list.length) this.status = '暂无番剧数据'
        } else {
          const list = await liveList(this.page)
          if (gen !== this.genSeq) return
          this.items = reset ? list : this.items.concat(list)
          if (!list.length) this.status = '暂无直播'
        }
        log('首页', '装载 ' + this.items.length + ' 条 (' + this.tab + ' p' + this.page + ')')
      } catch (e) {
        if (gen !== this.genSeq) return
        this.status = (e && e.message ? e.message : String(e))
        log('首页', '加载失败[' + ((e && e.kind) || 'unknown') + ']: ' + this.status)
      } finally {
        if (gen === this.genSeq) { this.loading = false; this.stopDots() }
      }
    },
    loadMore() {
      if (this.loading) return
      this.page++
      this.load(false)
    },
    onScroll(e) {
      const d = e && e.detail ? e.detail : {}
      if (d && d.scrollBottom != null && d.scrollBottom < 80 && this.items.length > 0 && !this.loading) this.loadMore()
    },
    openVideo(v) {
      if (!v) return
      try {
        if (v.kind === 'live' && v.roomId) { $falcon.navTo('play', { roomid: v.roomId, mode: 'live', title: v.title }); return }
        if (v.kind === 'bangumi') { this.status = '番剧详情下一批接入'; return }
        // 点卡片先到**详情页**, 由详情页再进播放 (用户要求: 不要直接跳播放页)
      if (v.bvid) $falcon.navTo('video', { bvid: v.bvid, title: v.title })
      } catch (e) {}
    }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: row; }
.main { flex: 1; flex-direction: column; }
.tabbar { flex-direction: row; align-items: center; padding-left: 12px; margin-top: 4px; height: 42px; }
.tab { justify-content: center; align-items: center; position: relative; }
.tabt { }
.ind { position: absolute; bottom: 1px; left: 14px; width: 24px; height: 3px; border-radius: 2px; }
.body { flex: 1; width: 100%; }
.grid { flex-direction: row; flex-wrap: wrap; padding-left: 12px; padding-top: 6px; }
.cell { }
.hint { width: 100%; height: 120px; justify-content: center; align-items: center; }
.hintt { }
.foot { width: 100%; justify-content: center; align-items: center; padding-top: 6px; padding-bottom: 12px; }
.more { padding-left: 20px; padding-right: 20px; height: 36px; justify-content: center; align-items: center; }
.moret { }
.dots { flex-direction: row; align-items: center; justify-content: center; height: 18px; }
.dot { }
</style>
