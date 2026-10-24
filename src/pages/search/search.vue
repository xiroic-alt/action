<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: 左侧返回 + 中间搜索框 (点击唤起系统输入法) + 右侧搜索动作.
         结构对齐 PiliNara lib/pages/search/view.dart:88-132 (_buildAppBar) -->
    <AppBar title="" :back="true" :actions="['search']" @back="onBack" @action="onAction"></AppBar>

    <!-- 搜索框铺在顶栏标题区: 命中区 44px 高. 不用 .stop 修饰符 (框架可能不支持),
         清空按钮与输入区是并排的兄弟节点, 各挂自己的 @click, 不会有冒泡冲突 -->
    <div class="sbox-layer" :style="{ width: SBOX_W + 'px', height: '44px' }">
      <div class="sbox" :style="{ width: SBOX_BOX_W + 'px', height: '44px' }" @click="openInput">
        <div class="sbox-inner" :style="{ backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.chip + 'px' }">
          <image class="sic" :src="MIc.search" :style="{ width: '20px', height: '20px' }"></image>
          <text class="stxt" :lines="1" :style="kw === '' ? U.t.weak : U.t.body">{{ kw === '' ? '搜索视频 / BV·av 号直达' : kw }}</text>
        </div>
      </div>
      <div v-if="kw !== ''" class="sclear" :style="{ width: '44px', height: '44px' }" @click="clearKw">
        <image class="cic" :src="MIc.close" :style="{ width: '22px', height: '22px' }"></image>
      </div>
    </div>

    <!-- 未搜索: 左"大家都在搜" + 右"搜索历史" (PiliNara 横屏分支: SliverCrossAxisGroup) -->
    <div v-if="!searched" class="home">
      <div class="panel panel-left">
        <div class="phead">
          <text class="ptitle" :lines="1" :style="U.t.subtitle">大家都在搜</text>
          <div class="pact" :style="{ width: '44px', height: '44px' }" @click="loadTrending">
            <image class="pact-ic" :src="MIc.refresh" :style="{ width: '20px', height: '20px' }"></image>
          </div>
        </div>
        <scroller class="plist" scroll-direction="vertical" :show-scrollbar="false">
          <div class="wrap">
            <div v-if="tloading && trending.length === 0" class="hint">
              <text class="hintt" :style="U.t.weak">加载中…</text>
            </div>
            <div v-for="(t, i) in trending" :key="t.keyword + '_' + i" class="kchip"
                 :style="chipStyle(LEFT_CHIP_W)" @click="searchFrom(t)">
              <text class="kt" :lines="1" :style="kwStyle(i < 3)">{{ t.showName }}</text>
            </div>
          </div>
        </scroller>
      </div>

      <div class="vdiv" :style="{ backgroundColor: U.c.outlineVariant }"></div>

      <div class="panel panel-right">
        <div class="phead">
          <text class="ptitle" :lines="1" :style="U.t.subtitle">搜索历史</text>
          <div v-if="history.length > 0" class="pclear" :style="{ height: '44px' }" @click="clearHistory">
            <text class="pcleart" :style="{ fontSize: U.f.caption + 'px', color: U.c.primary }">清空</text>
          </div>
        </div>
        <scroller class="plist" scroll-direction="vertical" :show-scrollbar="false">
          <div class="wrap">
            <div v-if="history.length === 0" class="hint">
              <text class="hintt" :style="U.t.weak">暂无搜索历史</text>
            </div>
            <div v-for="(h, i) in history" :key="h + '_' + i" class="kchip"
                 :style="chipStyle(RIGHT_CHIP_W)" @click="searchFrom({ keyword: h })">
              <text class="kt" :lines="1" :style="kwStyle(false)">{{ h }}</text>
            </div>
          </div>
        </scroller>
      </div>
    </div>

    <!-- 搜索结果 (PiliNara 结果列表: 封面 + 标题两行 + UP + 播放量 + 时长) -->
    <div v-else class="result">
      <scroller class="rlist" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
        <div v-if="loading && results.length === 0" class="hint">
          <text class="hintt" :style="U.t.weak">搜索中…</text>
        </div>
        <div v-else-if="results.length === 0" class="hint">
          <text class="hintt" :style="U.t.weak">{{ status }}</text>
        </div>
        <div v-else class="rows">
          <div v-for="(v, i) in results" :key="v.bvid + '_' + i" class="row"
               :style="{ backgroundColor: U.c.surfaceContainerLow, borderRadius: U.rad.card + 'px' }"
               @click="openVideo(v)">
            <image v-if="v.pic" class="cov" :src="v.pic"
                   :style="{ width: COV_W + 'px', height: COV_H + 'px', borderRadius: U.rad.card + 'px', backgroundColor: U.c.surfaceContainerHighest }"></image>
            <div v-else class="cov" :style="{ width: COV_W + 'px', height: COV_H + 'px', borderRadius: U.rad.card + 'px', backgroundColor: U.c.surfaceContainerHighest }"></div>
            <div class="rinfo">
              <text class="rtitle" :lines="2" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurface }">{{ v.title }}</text>
              <div class="rmeta">
                <text class="ra" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ v.author }}</text>
                <text class="rp" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ v.playText }}</text>
                <text v-if="v.durationText" class="rp" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ v.durationText }}</text>
                <text v-if="v.pubText" class="rp" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ v.pubText }}</text>
              </div>
            </div>
          </div>
          <div class="foot">
            <div class="more" :style="{ backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.chip + 'px', height: '44px' }" @click="loadMore">
              <text class="moret" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurface }">{{ moreText }}</text>
            </div>
          </div>
        </div>
      </scroller>
    </div>
  </div>
</template>

<script>
// 搜索页 —— 结构对齐 PiliNara lib/pages/search/view.dart
//   顶栏 (返回 + 搜索框 + 搜索动作) / 大家都在搜 + 搜索历史 (横屏左右分栏) / 结果列表
// 与上游的差异 (笔屏约束):
//   1. 输入法不是 TextField, 而是系统输入法 (services/ime.js), 点击搜索框唤起
//   2. 热搜/历史用固定宽 chip 两列铺排 (笔上不做自适应 wrap)
//   3. BV/av 号直达视频 —— 用户指定的两个消费点之一 (见 services/bv.js normalizeQuery)
import AppBar from '../../components/app-bar.vue'
import { ui } from '../../design/ui.js'
import { SCREEN } from '../../design/tokens.js'
import { searchVideo, hotKeywords } from '../../services/api.js'
import { normalizeQuery } from '../../services/bv.js'
import { getSearchHistory, addSearchHistory, clearSearchHistory } from '../../core/store.js'
import { createIME } from '../../services/ime.js'
import { log } from '../../core/log.js'

// 顶栏中间可用宽度 = 总宽 - 返回(44) - 搜索动作(44)
const SBOX_W = SCREEN.width - 44 - 44
// 左栏 (大家都在搜) 与右栏 (搜索历史) 分栏宽度: 右栏固定 392, 余下给左栏
const RIGHT_PANEL_W = 392
const LEFT_PANEL_W = SCREEN.width - RIGHT_PANEL_W - 1
const PANEL_PAD = 12
const CHIP_GAP = 8
const LEFT_CHIP_W = Math.floor((LEFT_PANEL_W - PANEL_PAD * 2 - CHIP_GAP) / 2)
const RIGHT_CHIP_W = Math.floor((RIGHT_PANEL_W - PANEL_PAD * 2 - CHIP_GAP) / 2)
// 结果行封面: 16:10 (PiliNara coverRatio)
const COV_W = 128
const COV_H = Math.round(COV_W / 1.6)

const MI = {
  search: require('../../assets/mi/search_24_w.png'),
  close: require('../../assets/mi/close_24_w.png'),
  refresh: require('../../assets/mi/refresh_24_w.png')
}
const MI_D = {
  search: require('../../assets/mi/search_24_d.png'),
  close: require('../../assets/mi/close_24_d.png'),
  refresh: require('../../assets/mi/refresh_24_d.png')
}

export default {
  components: { AppBar },
  name: 'search',
  data() {
    return {
      U: ui(),
      MI: MI,
      SBOX_W: SBOX_W,
      SBOX_BOX_W: SBOX_W - 44,
      LEFT_CHIP_W: LEFT_CHIP_W,
      RIGHT_CHIP_W: RIGHT_CHIP_W,
      COV_W: COV_W,
      COV_H: COV_H,
      kw: '',
      searched: false,
      results: [],
      page: 1,
      loading: false,
      status: '',
      history: [],
      trending: [],
      tloading: false,
      _gen: 0,
      _ime: null,
      _unloaded: false
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    moreText() {
      if (this.loading) return '加载中…'
      return this.status === '' || this.status === '没有更多了' ? (this.status || '加载更多') : '加载更多'
    }
  },
  mounted() {
    this.history = getSearchHistory(12)
    this.loadTrending()
  },
  methods: {
    // 组件里只有 onShow 会被框架转发
    onShow() {
      this.U = ui()
      this.history = getSearchHistory(12)
    },
    onPageUnload() {
      this._unloaded = true
      this._gen++
      if (this._ime) { try { this._ime.destroy() } catch (e) {} this._ime = null }
    },

    onBack() {
      try { this.$page.finish() } catch (e) {
        try { $falcon.navTo('index') } catch (e2) {}
      }
    },

    // ---------------- 输入 ----------------
    async openInput() {
      if (this._unloaded) return
      if (!this._ime) this._ime = createIME()
      let text = null
      try {
        text = await this._ime.open({ text: this.kw, placeholder: '搜索视频 / BV·av 号直达', maxlength: 64 })
      } catch (e) {
        log('搜索', '输入法不可用: ' + (e && e.message ? e.message : e))
        return
      }
      if (this._unloaded || text === null) return
      this.kw = String(text).trim()
      if (this.kw !== '') this.submit(this.kw)
    },

    clearKw() {
      this.kw = ''
      this.searched = false
      this.results = []
      this.status = ''
      this._gen++
      this.loading = false
    },

    // 顶栏右侧搜索动作: 空输入时先唤起输入法
    onAction() {
      if (this.kw === '') { this.openInput(); return }
      this.submit(this.kw)
    },

    // ---------------- 搜索 ----------------
    searchFrom(t) {
      const kw = String((t && t.keyword) || '')
      if (kw === '') return
      this.kw = kw
      this.submit(kw)
    },

    /**
     * 提交搜索.
     * ★ BV/av 号直达 (用户指定的消费点): normalizeQuery 认出视频号就直接进详情,
     *   不把它当关键词丢给搜索接口 —— 否则搜出来是一堆无关视频.
     */
    submit(raw) {
      const q = String(raw == null ? '' : raw).trim()
      if (q === '') return
      this.kw = q
      const norm = normalizeQuery(q)
      if (norm.kind === 'video') {
        this.record(q)
        log('搜索', '视频号直达 ' + norm.bvid)
        try { $falcon.navTo('play', { bvid: norm.bvid }) } catch (e) {}
        return
      }
      this.record(q)
      this.searched = true
      this.results = []
      this.status = ''
      this.page = 1
      this.loadResults(true)
    },

    record(kw) {
      try { addSearchHistory(kw) } catch (e) {}
      this.history = getSearchHistory(12)
    },

    async loadResults(reset) {
      log('搜索', '开始加载 p' + this.page + ' kw=' + this.kw)
      const gen = ++this._gen
      if (reset) { this.page = 1; this.status = '' }
      this.loading = true
      try {
        const r = await searchVideo(this.kw, this.page)
        if (gen !== this._gen) return
        const list = r.list || []
        this.results = reset ? list : this.results.concat(list)
        const lastPage = r.numPages > 0 ? this.page >= r.numPages : list.length === 0
        if (this.results.length === 0) this.status = '没有找到相关视频'
        else if (lastPage) this.status = '没有更多了'
        else this.status = ''
        log('搜索', '"' + this.kw + '" 第 ' + this.page + ' 页 -> ' + this.results.length + ' 条')
      } catch (e) {
        if (gen !== this._gen) return
        const msg = e && e.message ? e.message : String(e)
        if (reset) this.status = msg
        else this.status = '加载失败: ' + msg
        log('搜索', '失败: ' + msg)
      } finally {
        if (gen === this._gen) this.loading = false
      }
    },

    loadMore() {
      if (this.loading) return
      if (this.status === '没有更多了') return
      this.page++
      this.loadResults(false)
    },

    onScroll(e) {
      const d = (e && e.detail) ? e.detail : {}
      if (d.scrollBottom != null && d.scrollBottom < 80 && this.results.length > 0 && !this.loading) this.loadMore()
    },

    async loadTrending() {
      const gen = ++this._gen
      this.tloading = true
      try {
        const list = await hotKeywords(14)
        if (gen !== this._gen) return
        this.trending = list || []
        log('搜索', '热搜 ' + this.trending.length + ' 条')
      } catch (e) {
        if (gen !== this._gen) return
        this.trending = []
      } finally {
        if (gen === this._gen) this.tloading = false
      }
    },

    clearHistory() {
      try { clearSearchHistory() } catch (e) {}
      this.history = []
      log('搜索', '已清空搜索历史')
    },

    openVideo(v) {
      if (!v || !v.bvid) return
      try { $falcon.navTo('play', { bvid: v.bvid, title: v.title }) } catch (e) {}
    },

    // ---------------- 样式 ----------------
    chipStyle(w) {
      return {
        width: w + 'px',
        height: '44px',
        marginRight: CHIP_GAP + 'px',
        marginBottom: CHIP_GAP + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.chip + 'px',
        paddingLeft: '12px',
        paddingRight: '12px'
      }
    },
    kwStyle(hot) {
      return { fontSize: this.U.f.body + 'px', color: hot ? this.U.c.primary : this.U.c.onSurfaceVariant }
    }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
/* 搜索框层: 盖住顶栏标题区 (左侧返回 44 之后) */
.sbox-layer { position: absolute; left: 44px; top: 0px; flex-direction: row; align-items: center; }
.sbox { justify-content: center; align-items: center; }
.sbox-inner { width: 100%; height: 34px; flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; }
.sic { margin-right: 8px; }
.stxt { flex: 1; }
.sclear { justify-content: center; align-items: center; }

.home { position: absolute; left: 0px; top: 44px; width: 960px; height: 222px; flex-direction: row; }
.panel { flex-direction: column; }
.panel-left { width: 567px; }
.panel-right { width: 392px; }
.vdiv { width: 1px; height: 222px; }
.phead { height: 44px; flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; }
.ptitle { flex: 1; }
.pact { justify-content: center; align-items: center; }
.pact-ic { }
.pclear { justify-content: center; align-items: center; padding-left: 8px; padding-right: 8px; }
.pcleart { }
.plist { flex: 1; width: 100%; }
.wrap { flex-direction: row; flex-wrap: wrap; padding-left: 12px; padding-right: 12px; }
.kchip { flex-direction: row; align-items: center; justify-content: flex-start; }
.kt { }
.hint { width: 100%; height: 100px; justify-content: center; align-items: center; }
.hintt { }

.result { position: absolute; left: 0px; top: 44px; width: 960px; height: 222px; }
.rlist { width: 960px; height: 222px; }
.rows { flex-direction: column; padding-left: 12px; padding-right: 12px; padding-top: 8px; }
.row { flex-direction: row; height: 96px; margin-bottom: 8px; padding: 8px; }
.cov { }
.rinfo { flex: 1; flex-direction: column; padding-left: 10px; }
.rtitle { }
.rmeta { flex-direction: row; align-items: center; margin-top: 4px; }
.ra { margin-right: 10px; }
.rp { margin-right: 10px; }
.foot { width: 100%; justify-content: center; align-items: center; padding-top: 4px; padding-bottom: 12px; }
.more { padding-left: 24px; padding-right: 24px; justify-content: center; align-items: center; }
.moret { }
.cic { width: 16px; height: 16px; }
</style>
