<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 侧栏 (PiliNara NavigationRail 分支; 用户要求用侧栏, 不用底栏) -->
    <NavRail :current="nav" :face="face" @select="onNav" @reselect="onReselect"
             @search="onSearch" @avatar="onMine"></NavRail>

    <div class="main">
      <!-- 顶部 TabBar: 规格来自 PiliNara lib/pages/home/view.dart
           高度 42 / 上间距 4 / 无分隔线 / 居中 / splash 圆角 10 -->
      <div class="tabbar" :style="{ backgroundColor: U.c.surface }">
        <div v-for="t in tabs" :key="t.id" class="tab" :style="tabStyle(t)" @click="pickTab(t)">
          <text class="tabt" :style="tabTextStyle(t)">{{ t.label }}</text>
          <div v-if="t.id === tab" class="ind" :style="{ backgroundColor: U.c.primary }"></div>
        </div>
      </div>

      <scroller class="body" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
        <div v-if="loading && items.length === 0 && status === ''" class="hint">
          <text class="hintt" :style="U.t.weak">加载中…</text>
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
            <text class="moret" :style="U.t.body">{{ loading ? '加载中…' : '加载更多' }}</text>
          </div>
        </div>
      </scroller>
    </div>
  </div>
</template>

<script>
// 首页 —— PiliNara 结构: NavigationRail(侧栏) + 页内 TabBar + 卡片网格
// 布局依据见 docs/design-spec.md (逐条标注了上游出处)
import NavRail from '../../components/nav-rail.vue'
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
  components: { NavRail, VideoCard },
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

    onNav(id) {
      if (id === 'mine') this.onMine()
      else if (id === 'dyn') log('首页', '动态页下一批接入')
    },
    onReselect(id) { if (id === 'home') this.load(true) },
    onMine() { try { $falcon.navTo('mine', {}) } catch (e) {} },
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
      log('首页', '开始加载 ' + this.tab + ' p' + this.page + ' gen=' + gen)
      try {
        if (this.tab === 'rcmd') {
          const list = await recommend(12, this.page)
          if (gen !== this.genSeq) return
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
        if (gen === this.genSeq) this.loading = false
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
        if (v.bvid) $falcon.navTo('play', { bvid: v.bvid, title: v.title })
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
</style>
