<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <div class="head" :style="{ height: '44px', flexDirection: 'row', alignItems: 'center' }">
      <div class="hit" :style="{ width: '44px', height: '44px' }" @click="goBack">
        <image class="hic" :src="MIc.back" :style="{ width: '24px', height: '24px' }"></image>
      </div>
      <text class="ttl" :lines="1" :style="{ fontSize: U.f.title + 'px', color: U.c.onSurface, flex: 1 }">我的</text>
      <div class="sbtn" @click="goSettings">
        <text class="sbtt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurface }">设置</text>
      </div>
    </div>
    <div class="main" :style="{ height: S.content + 'px', flexDirection: 'row' }">
      <NavRail :current="'mine'" :face="face" @select="onNav" @search="onSearch" @avatar="noop"></NavRail>
      <div class="right" :style="{ width: '896px' }">
        <div class="prow" @click="onUserTap">
          <div class="pav">
            <image v-if="isLogin && face !== ''" class="pavimg" :src="face" resize="cover" :style="{ width: '44px', height: '44px', borderRadius: '22px' }"></image>
            <div v-else class="pavph" :style="{ width: '44px', height: '44px', borderRadius: '22px', backgroundColor: U.c.surfaceContainerHighest }"></div>
          </div>
          <div class="pinfo">
            <text class="pname" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface }">{{ nameText }}</text>
            <text class="psub" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ subText }}</text>
          </div>
          <div class="pact" :style="{ backgroundColor: isLogin ? U.c.surfaceContainerHighest : U.c.primary }" @click="onUserTap">
            <text class="pactt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: isLogin ? U.c.onSurfaceVariant : U.c.onPrimary }">{{ isLogin ? '已登录' : '去登录' }}</text>
          </div>
        </div>
        <div class="tabs">
          <div v-for="t in tabs" :key="t.id" class="tab" :style="tabStyle(t.id)" @click="pickTab(t.id)">
            <text class="tabt" :lines="1" :style="tabTextStyle(t.id)">{{ t.label }}</text>
          </div>
        </div>
        <scroller class="list" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
          <div class="rows">
            <div v-if="loading && items.length === 0" class="hint">
              <text class="hintt" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">加载中…</text>
            </div>
            <div v-else-if="items.length === 0" class="hint" @click="onUserTap">
              <text class="hintt" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ emptyText }}</text>
            </div>
            <div v-for="(v, i) in items" :key="(v.bvid || v.id || i) + 'k'" class="row" @click="openItem(v)">
              <image v-if="v.cover !== ''" class="rimg" :src="v.cover" resize="cover" :style="{ width: '80px', height: '46px', borderRadius: '6px' }"></image>
              <div v-else class="rimgph" :style="{ width: '80px', height: '46px', borderRadius: '6px', backgroundColor: U.c.surfaceContainerHighest }"></div>
              <div class="rmeta">
                <RichText class="rtitle" :text="v.title" :size="U.f.body" :color="U.c.onSurface" :lines="1" :drop-emoji="false" />
                <text class="rsub" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ v.sub }}</text>
              </div>
            </div>
            <div v-if="items.length > 0" class="foot" @click="loadMore">
              <text class="foott" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ footText }}</text>
            </div>
          </div>
        </scroller>
      </div>
    </div>
    <div v-if="tip !== ''" class="tip" @click="hideTip">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
import NavRail from '../../components/nav-rail.vue'
import RichText from '../../components/rich-text.vue'
import { ui } from '../../design/ui.js'
import { SCREEN } from '../../design/tokens.js'
import { log } from '../../core/log.js'
import { nav, favFoldersAll, favResources, historyCursor, toViewList } from '../../services/api.js'

const MI_W = { back: require("../../assets/mi/back_26_w.png") }
const MI_D = { back: require("../../assets/mi/back_26_d.png") }
const TABS = [
  { id: 'fav', label: '收藏' },
  { id: 'his', label: '历史' },
  { id: 'later', label: '稍后再看' }
]

function mapFav(v) {
  return {
    id: 0,
    bvid: String((v && v.bvid) || ''),
    title: String((v && v.title) || ''),
    sub: String((v && v.author) || ''),
    cover: String((v && v.cover) || ''),
    kind: 'video'
  }
}
function mapHis(v) {
  return {
    id: 0,
    bvid: String((v && v.bvid) || ''),
    title: String((v && v.title) || ''),
    sub: String((v && v.author) || '') + ((v && v.progressText) ? ('  ' + v.progressText) : ''),
    cover: String((v && v.cover) || ''),
    kind: 'video'
  }
}

export default {
  name: 'mine',
  components: { NavRail, RichText },
  data() {
    return {
      U: ui(), S: SCREEN, MIc: MI_W,
      genSeq: 0,
      tab: 'fav', tabs: TABS,
      isLogin: false, uname: "", face: "",
      items: [], loading: false, status: "", tip: "",
      folders: [], folderId: 0, folderTitle: "",
      cursor: { max: 0, view_at: 0 }, hasMore: false, page: 1
    }
  },
  computed: {
    nameText() { return this.isLogin ? (this.uname || '已登录') : '点击登录' },
    subText() {
      if (!this.isLogin) return '登录后同步收藏 / 历史 / 稍后再看'
      return this.folderTitle !== '' ? ('收藏夹: ' + this.folderTitle) : '已登录'
    },
    emptyText() {
      if (!this.isLogin) return '登录后同步收藏 / 历史 / 稍后再看'
      if (this.status !== '') return this.status
      return this.folderId ? '这个收藏夹是空的' : '暂无内容'
    },
    footText() {
      if (this.loading) return '加载中…'
      return this.hasMore ? '加载更多' : '没有更多了'
    }
  },
  // 三个入口都挂加载并打日志: 真机现象是 mounted / onShow 都没触发,
  // 谁先到谁加载, genSeq 保证重复调用不互相覆盖.
  created() {
    log('我的', 'created 触发')
    this.kick("created")
  },
  mounted() {
    log('我的', 'mounted 触发')
    this.kick("mounted")
  },
  onShow() {
    log('我的', 'onShow 触发')
    this.U = ui()
    this.kick("onShow")
  },
  onLoad() {
    log('我的', 'onLoad 触发')
    this.kick("onLoad")
  },
  onPageUnload() {
    this.genSeq++
    if (this.tipTimer) { clearTimeout(this.tipTimer); this.tipTimer = null }
  },
  methods: {
    kick(from) {
      if (this.loading) { log('我的', from + ' 时已在加载, 跳过'); return }
      log('我的', from + ' -> 开始加载')
      this.refresh()
    },
    async refresh() {
      const gen = ++this.genSeq
      this.loading = true
      this.status = ""
      log('我的', 'refresh 开始 gen=' + gen)
      try {
        const me = await nav()
        log('我的', 'nav 返回 gen=' + gen + ' 当前=' + this.genSeq + ' isLogin=' + (me && me.isLogin))
        if (gen !== this.genSeq) { log('我的', '世代过期, 丢弃'); return }
        this.isLogin = !!(me && me.isLogin)
        this.uname = (me && me.uname) || ''
        this.face = (me && me.face) || ''
        log('我的', '头像 URL: ' + (this.face === '' ? '(空)' : this.face.slice(0, 60)))
        log('我的', '状态已写入 isLogin=' + this.isLogin + ' uname=' + this.uname)
        if (!this.isLogin) { this.items = []; return }
        await this.loadTab(gen)
      } catch (e) {
        log('我的', 'refresh 异常: ' + (e && e.message ? e.message : e))
        if (gen === this.genSeq) this.status = (e && e.message ? e.message : String(e))
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },
    async loadTab(gen) {
      // 防御式: 接口可能返回非数组 (风控/未登录/结构变了), 直接 .map 会报
      // 'not a function' 并把整页状态带崩. 这里每步都判 Array.isArray, 并打点.
      const arr = function (x) { return Array.isArray(x) ? x : [] }
      try {
        if (this.tab === 'fav') {
          if (this.folderId) {
            log('我的', '取收藏夹内容 id=' + this.folderId + ' p' + this.page)
            const fr = await favResources(this.folderId, this.page)
            if (gen !== this.genSeq) return
            const fl = arr(fr && fr.list)
            const mapped = fl.map(mapFav)
            this.items = this.page === 1 ? mapped : this.items.concat(mapped)
            this.hasMore = !!(fr && fr.hasMore)
          } else {
            log('我的', '取收藏夹列表')
            const fr2 = await favFoldersAll()
            if (gen !== this.genSeq) return
            // ★ favFoldersAll 返回的是 { count, list } 对象, 不是数组!
            //   (之前直接 Array.isArray 判定 -> 恒 false -> 列表永远 0 条)
            const listArr = arr(fr2 && fr2.list)
            this.folders = listArr
            this.items = listArr.map(function (fo) {
              return { id: fo && fo.id, bvid: '', title: (fo && fo.title) || '', sub: ((fo && fo.count) || 0) + ' 个内容', cover: (fo && fo.cover) || '', kind: 'folder' }
            })
            this.hasMore = false
          }
        } else if (this.tab === 'his') {
          log('我的', '取观看历史')
          const hr = await historyCursor(this.cursor.max, this.cursor.view_at)
          if (gen !== this.genSeq) return
          const hl = arr(hr && hr.list)
          const hc = (hr && hr.cursor) || {}
          this.cursor = { max: hc.max || 0, view_at: hc.view_at || 0 }
          const hm = hl.map(mapHis)
          this.items = this.page === 1 ? hm : this.items.concat(hm)
          this.hasMore = !!hc.max
        } else {
          log('我的', '取稍后再看')
          const list = await toViewList()
          if (gen !== this.genSeq) return
          this.items = arr(list).map(mapHis)
          this.hasMore = false
        }
      } catch (e) {
        log('我的', 'loadTab 异常 (tab=' + this.tab + '): ' + (e && e.message ? e.message : e))
        this.items = []
        this.status = '列表加载失败: ' + (e && e.message ? e.message : e)
      }
      log('我的', '列表装载 ' + this.items.length + ' 条 (tab=' + this.tab + ')')
    },
    pickTab(id) {
      if (this.tab === id) return
      this.tab = id
      this.items = []
      this.page = 1
      this.folderId = 0
      this.cursor = { max: 0, view_at: 0 }
      if (this.isLogin) this.refresh()
    },
    loadMore() {
      if (this.loading || !this.hasMore) return
      this.page = this.page + 1
      this.refresh()
    },
    onScroll(e) {
      const bottom = (e && e.scrollBottom != null) ? Number(e.scrollBottom) : 0
      if (bottom > 0 && bottom < 60 && this.hasMore && !this.loading) this.loadMore()
    },
    onUserTap() {
      if (this.isLogin) { this.showTip("已登录: " + this.uname); return }
      try { $falcon.navTo('login', {}) } catch (e) {}
    },
    goSettings() { try { $falcon.navTo('settings', {}) } catch (e) {} },
    onSearch() { try { $falcon.navTo('search', {}) } catch (e) {} },
    // ★ 跳转由 nav-rail 负责, 这里不再重复 navTo
    onNav(id) { log('我的', '侧栏切到 ' + id) },
    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('index', {}) } catch (e2) {} } },
    noop() {},
    openItem(v) {
      if (v.kind === 'folder') { this.folderId = v.id; this.folderTitle = v.title; this.items = []; this.page = 1; this.refresh(); return }
      if (!v.bvid) { this.showTip('这条没有视频号'); return }
      try { $falcon.navTo('video', { bvid: v.bvid, title: v.title }) } catch (e) {}
    },
    hideTip() { this.tip = '' },
    showTip(s) {
      const self = this
      this.tip = String(s || '')
      if (this.tipTimer) { clearTimeout(this.tipTimer) }
      this.tipTimer = setTimeout(function () { self.tip = '' }, 2200)
    },
    tabStyle(id) {
      return {
        height: '32px',
        paddingLeft: '16px',
        paddingRight: '16px',
        marginRight: '8px',
        borderRadius: this.U.rad.chip + 'px',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: id === this.tab ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest
      }
    },
    tabTextStyle(id) {
      return {
        fontSize: this.U.f.caption + 'px',
        color: id === this.tab ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    }
  }
}
</script>

<style scoped>
.page { width: 960px; height: 266px; flex-direction: column; }
.head { width: 960px; flex-direction: row; align-items: center; }
.hit { width: 44px; height: 44px; justify-content: center; align-items: center; }
.hic { }
.ttl { }
.sbtn { width: 64px; height: 36px; justify-content: center; align-items: center; margin-right: 12px; }
.sbtt { }
.main { flex-direction: row; }
.right { flex-direction: column; }
.prow { height: 58px; flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; }
.pav { width: 44px; height: 44px; justify-content: center; align-items: center; margin-right: 10px; }
.pavimg { }
.pavph { }
.pinfo { flex: 1; flex-direction: column; justify-content: center; }
.pname { }
.psub { }
.pact { width: 88px; height: 36px; justify-content: center; align-items: center; margin-left: 8px; border-radius: 16px; }
.pactt { }
.tabs { height: 38px; flex-direction: row; align-items: center; padding-left: 12px; }
.tab { }
.tabt { }
.list { width: 896px; height: 126px; }
.rows { flex-direction: column; padding-left: 12px; padding-right: 12px; }
.hint { height: 90px; justify-content: center; align-items: center; }
.hintt { }
.row { height: 56px; flex-direction: row; align-items: center; }
.rimg { margin-right: 10px; }
.rimgph { margin-right: 10px; }
.rmeta { flex: 1; flex-direction: column; justify-content: center; }
.rtitle { }
.rsub { }
.foot { height: 36px; justify-content: center; align-items: center; padding-bottom: 8px; }
.foott { }
.tip { position: absolute; left: 300px; bottom: 24px; height: 36px; padding-left: 16px; padding-right: 16px; justify-content: center; align-items: center; }
.tipt { }
</style>
