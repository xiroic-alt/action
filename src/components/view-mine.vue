<template>
  <!-- 我的 (视图组件): 只负责右侧内容, 侧栏由外壳 index.vue 持有 -->
  <!-- ★ 高度用 S.height (266) 而不是 S.content (222):
       content 是"扣掉 44px 顶栏"后的高度, 而本视图挂在没有顶栏的外壳里,
       用 222 会让底部空出 44px 黑边 (真机就是这个现象). -->
  <div class="vm" :style="{ width: (S.width - S.navRail + 20) + 'px', height: S.height + 'px' }">
    <div class="prow" :style="{ height: '58px' }">
      <div class="pav" @click="onAvatar">
        <image v-if="isLogin && face !== ''" class="pavimg" :src="face" resize="cover" :style="{ width: '44px', height: '44px', borderRadius: '22px' }"></image>
        <div v-else class="pavph" :style="{ width: '44px', height: '44px', borderRadius: '22px', backgroundColor: U.c.surfaceContainerHighest }"></div>
      </div>
      <div class="pinfo" :style="{ width: '640px' }">
        <text class="pname" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface }">{{ nameText }}</text>
        <text class="psub" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ subText }}</text>
      </div>
      <!-- 登录 / 退出 / 设置: 三个明确按钮 (用户要求"添加退出和登录按钮") -->
      <div v-if="!isLogin" class="pact actp" @click="goLogin">
        <text class="pactt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onPrimary }">登录</text>
      </div>
      <div v-else class="pact actn" @click="onLogout">
        <text class="pactt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurface }">退出</text>
      </div>
      <div class="pact actn ml8" @click="goSettings">
        <text class="pactt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurface }">设置</text>
      </div>
    </div>
    <div class="tabs" :style="{ height: '38px' }">
      <div v-for="t in tabs" :key="t.id" class="tab" :style="tabStyle(t.id)" @click="pickTab(t.id)">
        <text class="tabt" :lines="1" :style="tabTextStyle(t.id)">{{ t.label }}</text>
      </div>
    </div>
    <scroller class="list" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll" :style="{ width: (S.width - S.navRail + 20) + 'px', height: (S.height - 58 - 38) + 'px' }">
      <div class="rows">
        <div v-if="items.length === 0" class="hint">
          <text class="hintt" :lines="2" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ emptyText }}</text>
        </div>
        <div v-for="(v, i) in items" :key="v.key" class="row" @click="openItem(v)">
          <image v-if="v.cover !== ''" class="rimg" :src="v.cover" resize="cover" :style="{ width: '80px', height: '46px', borderRadius: '6px' }"></image>
          <!-- 收藏夹没有封面 (接口不给), 用首字占位而不是空灰块 -->
          <div v-else class="rimgfc" :style="{ width: '80px', height: '46px', borderRadius: '6px', backgroundColor: v.kind === 'folder' ? U.c.primaryContainer : U.c.surfaceContainerHigh }">
            <text class="rimgfct" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onPrimaryContainer }">{{ v.kind === 'folder' ? v.fchar : '' }}</text>
          </div>
          <div class="rmeta" :style="{ width: '770px' }">
            <RichText class="rtitle" :text="v.title" :size="U.f.body" :color="U.c.onSurface" :lines="1" :drop-emoji="false" />
            <text class="rsub" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ v.sub }}</text>
          </div>
        </div>
      </div>
    </scroller>
  </div>
</template>

<script>
import RichText from './rich-text.vue'
import { ui } from '../design/ui.js'
import { SCREEN } from '../design/tokens.js'
import { log } from '../core/log.js'
import { nav, favFoldersAll, favResources, historyCursor, toViewList } from '../services/api.js'
import { clearLogin } from '../core/auth.js'

const TABS = [
  { id: 'fav', label: '收藏' },
  { id: 'his', label: '历史' },
  { id: 'later', label: '稍后再看' }
]

function arrOf(x) { return Array.isArray(x) ? x : [] }
function mapVideo(v, i) {
  return {
    key: String((v && v.bvid) || 'v') + '_' + i,
    bvid: String((v && v.bvid) || ''),
    title: String((v && v.title) || ''),
    sub: String((v && v.author) || '') + ((v && v.progressText) ? ('  ' + v.progressText) : ''),
    // 接口字段名是 pic (不是 cover), 且已过 F.thumb 转 jpg
    cover: String((v && (v.pic || v.cover)) || ''),
    kind: 'video'
  }
}

export default {
  name: 'view-mine',
  // 把头像/昵称广播给外壳, 让侧栏的头像与"我的"页保持同步
  emits: ['user'],
  components: { RichText },
  data() {
    return {
      U: ui(),
      S: SCREEN,
      genSeq: 0,
      tab: 'fav', tabs: TABS,
      isLogin: false, uname: "", face: "",
      items: [], loading: false, status: "",
      folders: [], folderId: 0, folderTitle: "",
      cursor: { max: 0, view_at: 0 }, hasMore: false, page: 1
    }
  },
  computed: {
    nameText() { return this.isLogin ? (this.uname || '已登录') : '点击登录' },
    subText() { return this.isLogin ? (this.folderTitle !== '' ? ('收藏夹: ' + this.folderTitle) : (this.cntText || '已登录')) : '登录后同步收藏 / 历史 / 稍后再看' },
    cntText() {
      if (this.items.length === 0) return ''
      return this.items.length + ' 项'
    },
    emptyText() {
      if (!this.isLogin) return '登录后同步收藏 / 历史 / 稍后再看'
      if (this.status !== '') return this.status
      return '暂无内容'
    }
  },
  created() {
    log('视图我的', 'created')
    this.refresh()
  },
  methods: {
    async refresh() {
      const gen = ++this.genSeq
      this.loading = true
      this.status = ""
      try {
        const me = await nav()
        if (gen !== this.genSeq) return
        this.isLogin = !!(me && me.isLogin)
        this.uname = (me && me.uname) || ''
        this.face = (me && me.face) || ''
        log('视图我的', 'isLogin=' + this.isLogin + ' uname=' + this.uname + ' face=' + (this.face ? '有' : '空'))
        // ★ 同步给外壳 (侧栏头像)
        this.$emit('user', { face: this.face, uname: this.uname, isLogin: this.isLogin })
        await this.loadTab(gen)
      } catch (e) {
        log('视图我的', '异常: ' + (e && e.message ? e.message : e))
        if (gen === this.genSeq) this.status = String((e && e.message) || e)
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },
    async loadTab(gen) {
      try {
        if (!this.isLogin) { this.items = []; return }
        if (this.tab === 'fav') {
          if (this.folderId) {
            const fr = await favResources(this.folderId, this.page)
            if (gen !== this.genSeq) return
            const mapped = arrOf(fr && fr.list).map(mapVideo)
            this.items = this.page === 1 ? mapped : this.items.concat(mapped)
            this.hasMore = !!(fr && fr.hasMore)
          } else {
            const fr2 = await favFoldersAll()
            if (gen !== this.genSeq) return
            this.items = arrOf(fr2 && fr2.list).map(function (fo, i) {
              return {
                key: 'f' + String(fo && fo.id) + '_' + i,
                id: fo && fo.id,
                bvid: '',
                title: (fo && fo.title) || '',
                sub: ((fo && fo.count) || 0) + ' 个内容',
                // list-all 接口**不返回 cover**, 所以用首字占位 (见模板的 fchar 分支)
                cover: (fo && fo.cover) || '',
                fchar: ((fo && fo.title) || '?').charAt(0),
                kind: 'folder'
              }
            })
            this.hasMore = false
          }
        } else if (this.tab === 'his') {
          const hr = await historyCursor(this.cursor.max, this.cursor.view_at)
          if (gen !== this.genSeq) return
          const hc = (hr && hr.cursor) || {}
          this.cursor = { max: hc.max || 0, view_at: hc.view_at || 0 }
          const hm = arrOf(hr && hr.list).map(mapVideo)
          this.items = this.page === 1 ? hm : this.items.concat(hm)
          this.hasMore = !!hc.max
        } else {
          const list = await toViewList()
          if (gen !== this.genSeq) return
          this.items = arrOf(list).map(mapVideo)
          this.hasMore = false
        }
        log('视图我的', 'tab=' + this.tab + ' 装载 ' + this.items.length + ' 条')
      } catch (e) {
        log('视图我的', 'loadTab 异常 (tab=' + this.tab + '): ' + (e && e.message ? e.message : e))
        this.items = []
        this.status = '加载失败: ' + String((e && e.message) || e)
      }
    },
    pickTab(id) {
      if (this.tab === id) return
      this.tab = id
      this.items = []
      this.page = 1
      this.folderId = 0
      this.folderTitle = ""
      this.cursor = { max: 0, view_at: 0 }
      this.refresh()
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
    goLogin() { try { $falcon.navTo('login', {}) } catch (e) {} },
    async onLogout() {
      log('视图我的', '退出登录')
      try {
        await clearLogin()
        this.isLogin = false
        this.uname = ""
        this.face = ""
        this.items = []
        this.folderId = 0
        this.folderTitle = ""
        this.$emit('user', { face: '', uname: '', isLogin: false })
        this.showTip('已退出登录')
      } catch (e) {
        log('视图我的', '退出失败: ' + (e && e.message ? e.message : e))
      }
    },
    showTip(s) {
      const self = this
      this.status = String(s || '')
      if (this._stT) { try { clearTimeout(this._stT) } catch (e) {} }
      this._stT = setTimeout(function () { self.status = '' }, 2000)
    },
    goSettings() { try { $falcon.navTo('settings', {}) } catch (e) {} },
    onAvatar() {
      if (this.isLogin) return
      try { $falcon.navTo('login', {}) } catch (e) {}
    },
    onLoginTap() {
      if (!this.isLogin) { try { $falcon.navTo("login", {}) } catch (e) {} return }
      this.refresh()
    },
    openItem(v) {
      if (v.kind === 'folder') {
        this.folderId = v.id
        this.folderTitle = v.title
        this.items = []
        this.page = 1
        this.refresh()
        return
      }
      if (!v.bvid) return
      try { $falcon.navTo('video', { bvid: v.bvid, title: v.title }) } catch (e) {}
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
.vm { flex-direction: column; }
.prow { flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; }
.pav { width: 44px; height: 44px; justify-content: center; align-items: center; margin-right: 10px; }
.pavimg { }
.pavph { }
.pinfo { flex-direction: column; justify-content: center; }
.pname { }
.psub { }
.pact { width: 76px; height: 36px; justify-content: center; align-items: center; border-radius: 16px; }
.pactt { }
.tabs { flex-direction: row; align-items: center; padding-left: 12px; }
.tab { }
.tabt { }
.list { }
.rows { flex-direction: column; padding-left: 12px; padding-right: 12px; }
.hint { height: 80px; justify-content: center; align-items: center; }
.hintt { text-align: center; }
.row { height: 56px; flex-direction: row; align-items: center; }
.rimg { margin-right: 10px; }
.rimgph { margin-right: 10px; }
.rmeta { flex-direction: column; justify-content: center; }
.rtitle { }
.rsub { }
.rimgfc { margin-right: 10px; justify-content: center; align-items: center; }
.rimgfct { }
.actp { background-color: #FB7299; }
.actn { background-color: transparent; }
.ml8 { margin-left: 8px; }
</style>
