<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: 标题用路由参数里的收藏夹名; 右侧刷新 (列表接口可能因风控/网络失败, 给个重试入口) -->
    <AppBar :title="barTitle" :back="true" :actions="['refresh']" @back="onBack" @action="onAction"></AppBar>

    <!-- 列表区: 只有这一层滚动, 222px 全给卡片 (笔屏纵向寸土寸金, 不再插概览条) -->
    <scroller class="body" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
      <!-- 未登录: 收藏夹内容接口必须带 Cookie, 没 Cookie 时先给登录入口,
           否则会白等一次注定失败的请求, 用户只看到一个空列表 -->
      <div v-if="needLogin" class="hint">
        <image class="hintic" :src="IC.favlist" :style="{ width: '30px', height: '30px' }"></image>
        <text class="hintt" :style="U.t.weak">请先登录</text>
        <div class="loginbtn" :style="loginBtnStyle" @click="goLogin">
          <text class="loginbtt" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">去登录</text>
        </div>
      </div>

      <div v-else-if="loading && items.length === 0" class="hint">
        <text class="hintt" :style="U.t.weak">加载中…</text>
      </div>

      <!-- 空态 / 错误态共用: 有 status 就显示 status (错误信息), 否则显示"收藏夹是空的" -->
      <div v-else-if="items.length === 0" class="hint">
        <image class="hintic" :src="IC.favlist" :style="{ width: '30px', height: '30px' }"></image>
        <text class="hintt" :style="U.t.weak">{{ emptyText }}</text>
        <div v-if="status !== ''" class="retry" :style="retryStyle" @click="reload">
          <text class="retryt" :style="{ fontSize: U.f.caption + 'px', color: U.c.primary }">重试</text>
        </div>
      </div>

      <div v-else class="list">
        <!-- 横向卡片: 左 120x75 封面 + 右侧标题两行 + UP 名 + 播放量.
             一行 92px = 封面 75 + 上下留白, 222px 里正好露出 2 行多一点, 滚动时看得出还有内容 -->
        <div v-for="(v, i) in items" :key="rowKey(v, i)" class="row" :style="rowStyle" @click="openVideo(v)">
          <div class="cov" :style="covStyle">
            <image v-if="v.pic !== ''" class="cimg" :src="v.pic" :style="covStyle" resize="cover"></image>
            <div v-if="v.durationText !== ''" class="dur" :style="durStyle">
              <text class="durt" :style="{ fontSize: U.f.tiny + 'px', color: '#ffffff' }">{{ v.durationText }}</text>
            </div>
          </div>
          <div class="info">
            <RichText class="title" :text="v.title" :size="U.f.body" :color="U.c.onSurface" :lines="2" :drop-emoji="false" />
            <div class="meta">
              <RichText class="author" :text="v.author" :size="U.f.caption" :color="U.c.onSurfaceVariant" :lines="1"
                        :style="{ maxWidth: '300px', marginRight: '12px' }" :drop-emoji="false" />
              <text class="stat" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ statText(v) }}</text>
            </div>
          </div>
        </div>

        <!-- 底部加载更多: 滚到底也能点, 不依赖滚动事件 (真机上 scroll 事件偶尔丢) -->
        <div class="foot">
          <div class="more" :style="moreStyle" @click="loadMore">
            <text class="moret" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ moreText }}</text>
          </div>
        </div>
      </div>
    </scroller>

    <!-- 轻提示: 框架没有 toast, 用页面内小条 (只做静态显示, 不做 opacity 动画) -->
    <div v-if="tip !== ''" class="tip" :style="tipStyle">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
import AppBar from '../../components/app-bar.vue'
import RichText from '../../components/rich-text.vue'
// 收藏夹详情 —— 对应 PiliNara lib/pages/fav_detail:
//   顶栏显示收藏夹名 + 收藏内容列表 (封面 / 标题 / UP / 播放量 / 时长), 支持分页.
// 与上游的差异 (笔屏约束): 卡片改成横向单列 —— 960 宽 222 高的屏上,
// 竖排卡片一屏只能看到半张, 横排才能一屏 2-3 条.
import { ui } from '../../design/ui.js'
import { favResources } from '../../services/api.js'
import { hasCookie } from '../../core/auth.js'
import { log } from '../../core/log.js'

// 行高 92: 封面 75 + 上下各 8 的留白, 再留 1px 给圆角不出血
const ROW_H = 92
const COV_W = 120
const COV_H = 75            // 16:10, 与 PiliNara SPEC.coverRatio 一致
const GAP = 6
const PAGE_SIZE = 20
const TIP_MS = 2000

// favlist_24_m 只有中性色一版 (浅/深主题通用), 不用按主题切换
const IC = { favlist: require('../../assets/mi/favlist_24_m.png') }

export default {
  components: { AppBar, RichText },
  name: 'fav',
  data() {
    return {
      // 世代守卫必须真的是数字: ++undefined = NaN, 而 NaN !== NaN 恒真,
      // 结果会被判成"过期"丢弃, 页面永远停在加载中 (项目历史踩过)
      genSeq: 0,
      U: ui(),
      IC: IC,
      mediaId: 0,
      titleText: '',
      items: [],
      page: 1,
      hasMore: false,
      loading: false,
      status: '',
      needLogin: false,
      tip: '',
      ROW_H: ROW_H,
      COV_W: COV_W,
      COV_H: COV_H
    }
  },
  computed: {
    // 参数里的夹名可能为空 (外部直接 navTo 过来), 给个兜底标题
    barTitle() {
      return this.titleText !== '' ? this.titleText : '收藏夹'
    },
    emptyText() {
      if (this.status !== '') return this.status
      return this.mediaId === 0 ? '缺少收藏夹参数' : '收藏夹是空的'
    },
    moreText() {
      if (this.loading) return '加载中…'
      return this.hasMore ? '加载更多' : '没有更多了'
    },
    rowStyle() {
      return {
        height: ROW_H + 'px',
        marginBottom: GAP + 'px',
        paddingLeft: '8px',
        paddingRight: '12px',
        backgroundColor: this.U.c.surfaceContainerLow,
        borderRadius: this.U.rad.card + 'px'
      }
    },
    covStyle() {
      return {
        width: COV_W + 'px',
        height: COV_H + 'px',
        borderRadius: this.U.rad.card + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest
      }
    },
    durStyle() {
      return {
        position: 'absolute',
        right: '4px',
        bottom: '4px',
        height: '18px',
        paddingLeft: '5px',
        paddingRight: '5px',
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: '6px'
      }
    },
    moreStyle() {
      return {
        height: '44px',
        paddingLeft: '24px',
        paddingRight: '24px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    loginBtnStyle() {
      return {
        width: '140px',
        height: '44px',
        marginTop: '10px',
        backgroundColor: this.U.c.primary,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    retryStyle() {
      return {
        height: '44px',
        paddingLeft: '20px',
        paddingRight: '20px',
        marginTop: '8px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    tipStyle() {
      return {
        position: 'absolute',
        left: '302px',
        bottom: '8px',
        width: '440px',
        height: '40px',
        backgroundColor: this.U.c.inverseSurface,
        borderRadius: this.U.rad.chip + 'px'
      }
    }
  },
  mounted() {
    this.genSeq = 0
    this.tipTimer = null
    // 参数在 mounted 里读: 框架只在这时把 options 挂到 $page 上
    const o = (this.$page && this.$page.options) || {}
    this.mediaId = Number(o.id || o.media_id || 0) || 0
    this.titleText = String(o.title || '')
    this.needLogin = !hasCookie()
    if (this.mediaId === 0) { this.status = '缺少收藏夹参数'; return }
    if (this.needLogin) return
    this.reload()
  },
  methods: {
    // 框架只转发 onShow / onPageUnload 这两个生命周期
    onShow() {
      this.U = ui()
      const logged = hasCookie()
      // 从登录页回来时登录态会翻转, 只有真的变了才重拉 —— 否则每次回前台都白发一次列表请求
      if (logged === !this.needLogin) return
      this.needLogin = !logged
      if (logged) this.reload()
    },
    onPageUnload() {
      this.genSeq++          // 作废在途请求, 页面销毁后不再 setData
      if (this.tipTimer) { clearTimeout(this.tipTimer); this.tipTimer = null }
    },

    onBack() {
      try { this.$page.finish() } catch (e) {
        try { $falcon.navTo('index', {}) } catch (e2) {}
      }
    },
    onAction(a) {
      if (a === 'refresh') this.reload()
    },

    // ---------------- 数据 ----------------
    reload() { this.load(true) },

    async load(reset) {
      if (this.needLogin || this.mediaId === 0) return
      if (reset) { this.page = 1; this.hasMore = false }
      const gen = ++this.genSeq
      this.loading = true
      if (reset) this.status = ''
      try {
        const r = await favResources(this.mediaId, this.page, PAGE_SIZE)
        if (gen !== this.genSeq) return
        const list = (r && r.list) || []
        this.items = reset ? list : this.items.concat(list)
        this.hasMore = !!(r && r.hasMore)
        log('收藏', '夹 ' + this.mediaId + ' 第 ' + this.page + ' 页 -> ' + this.items.length + ' 条')
      } catch (e) {
        if (gen !== this.genSeq) return
        if (reset) this.items = []
        this.status = '加载失败: ' + ((e && e.message) ? e.message : String(e))
        log('收藏', '失败: ' + this.status)
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },

    loadMore() {
      if (this.loading || !this.hasMore) return
      this.page++
      this.load(false)
    },

    onScroll(e) {
      const d = (e && e.detail) ? e.detail : {}
      // 到底部 80px 内就预取, 但必须还有下一页, 否则会反复打接口
      if (d.scrollBottom != null && d.scrollBottom < 80 && this.items.length > 0 && this.hasMore && !this.loading) {
        this.loadMore()
      }
    },

    // ---------------- 交互 ----------------
    openVideo(v) {
      if (!v) return
      // 失效稿件 / 非普通视频 (直播回放、番剧) 在笔上没有播放器, 别把用户送进空白页
      if (!v.openable || v.bvid === '') { this.showTip('该收藏内容已失效或不是普通视频'); return }
      log('收藏', '打开 ' + v.bvid)
      try { $falcon.navTo('play', { bvid: v.bvid, title: v.title }) } catch (e) {}
    },
    goLogin() {
      try { $falcon.navTo('login', {}) } catch (e) {}
    },

    // ---------------- 样式辅助 ----------------
    rowKey(v, i) { return String(v.bvid || v.aid || '') + '_' + i },
    statText(v) {
      const parts = []
      if (v.playText !== '') parts.push(v.playText + ' 播放')
      if (v.progressText) parts.push(v.progressText)
      return parts.join(' · ')
    },

    showTip(msg) {
      this.tip = String(msg || '')
      if (this.tipTimer) clearTimeout(this.tipTimer)
      const self = this
      this.tipTimer = setTimeout(function () {
        self.tip = ''
        self.tipTimer = null
      }, TIP_MS)
    }
  }
}
</script>

<style scoped>
/* 页面根: 绝对定位铺满 960x266, 纵向排列 (顶栏 + 滚动列表) */
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }

/* 列表容器: 吃掉顶栏剩下的 222px */
.body { flex: 1; width: 100%; }
.list { flex-direction: column; padding-left: 12px; padding-right: 12px; padding-top: 8px; }
.row { flex-direction: row; align-items: center; }
.cov { position: relative; overflow: hidden; }
.cimg { }
.dur { flex-direction: row; justify-content: center; align-items: center; }
.durt { }
.info { flex: 1; flex-direction: column; justify-content: center; padding-left: 10px; }
.title { }
.meta { flex-direction: row; align-items: center; margin-top: 4px; }
.author { }
.stat { }

/* 空态 / 错误态 / 加载态: 固定 140px 高, 在滚动容器里也能撑出可见区域 */
.hint { width: 100%; height: 140px; flex-direction: column; justify-content: center; align-items: center; }
.hintic { }
.hintt { margin-top: 6px; }
.loginbtn { justify-content: center; align-items: center; }
.loginbtt { }
.retry { justify-content: center; align-items: center; }
.retryt { }

/* 底部加载更多 */
.foot { width: 100%; flex-direction: row; justify-content: center; align-items: center; padding-top: 2px; padding-bottom: 10px; }
.more { flex-direction: row; justify-content: center; align-items: center; }
.moret { }

/* 轻提示 */
.tip { justify-content: center; align-items: center; }
.tipt { }
</style>
