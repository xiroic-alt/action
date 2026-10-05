<template>
  <div class="page" :class="entering ? 'page-enter' : ''">
    <div class="topbar">
      <div class="back" @click="goBack">
        <image class="back-ic" :src="MI.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="back-text">返回</text>
      </div>
      <text class="topbar-title">我的关注{{ total > 0 ? ' (' + total + ')' : '' }}</text>
      <text class="topbar-sub">{{ logged ? ('共 ' + items.length + ' 个已加载') : '' }}</text>
    </div>

    <!-- 分组筛选: 全部 / 特别关注 / 自定义分组 (分组列表来自 x/relation/tags) -->
    <scroller class="gtabs" scroll-direction="horizontal" :show-scrollbar="false">
      <!-- 「全部」用哨兵 TAG_ALL(-999): 不能拿 0 当全部 —— 0 是「默认分组」的真实 tagid -->
      <div :class="['gtab', tagFilter === TAG_ALL ? 'gtab-on' : '']" @click="setFilter(TAG_ALL)">
        <text :class="['gtab-t', tagFilter === TAG_ALL ? 'gtab-t-on' : '']">全部</text>
      </div>
      <!-- 特别关注(-10) 与 默认分组(0) 本来就由接口的分组列表给出 (x/relation/tags 里就有这两条),
           这里只在接口没给的情况下兜一个 —— 否则会出现两个「特别关注」tab (0.9.61 踩过) -->
      <div v-if="!hasSpecialTag" :class="['gtab', tagFilter === TAG_SPECIAL ? 'gtab-on' : '']" @click="setFilter(TAG_SPECIAL)">
        <text :class="['gtab-t', tagFilter === TAG_SPECIAL ? 'gtab-t-on' : '']">特别关注</text>
      </div>
      <div v-for="t in tags" :key="'t' + t.tagid" :class="['gtab', tagFilter === t.tagid ? 'gtab-on' : '']" @click="setFilter(t.tagid)">
        <text :class="['gtab-t', tagFilter === t.tagid ? 'gtab-t-on' : '']">{{ t.name + ' ' + t.count }}</text>
      </div>
    </scroller>

    <scroller class="list" scroll-direction="vertical" :show-scrollbar="true"
              :loadmoreoffset="100" @loadmore="loadMore">
      <text v-if="status !== ''" class="state" @click="retry">{{ status }}</text>
      <div v-if="!logged && loaded" class="gate">
        <text class="gate-text">关注列表需要登录后查看</text>
        <div class="gate-btn" @click="goLogin">
          <text class="gate-btn-text">去登录 (扫码 / 电脑同步)</text>
        </div>
      </div>
      <template v-else>
        <div v-for="u in shown" :key="'u' + u.mid" class="item" @click="openUp(u)">
          <div class="face-wrap">
            <image class="face" :src="u.face" resize="cover" :lazy-load="true"></image>
          </div>
          <div class="meta">
            <div class="namerow">
              <text class="name">{{ u.name }}</text>
              <div v-if="u.officialType >= 0" :class="['vbadge', badgeCls(u)]">
                <image class="vbadge-ic" :src="MI.bolt" :style="{ width: '11px', height: '11px' }"></image>
              </div>
              <text v-if="u.special" class="sptag">特别关注</text>
            </div>
            <text class="sign">{{ u.sign !== '' ? u.sign : '这个人很神秘，什么都没有写' }}</text>
          </div>
          <div class="manage" @click="openManage(u)">
            <text class="manage-t">管理</text>
          </div>
        </div>
        <text v-if="hasMore && items.length > 0" class="more" @click="loadMore">上滑加载更多…</text>
        <text v-if="shown.length === 0 && !loading && status === ''" class="empty">这个分组里还没有人</text>
      </template>
    </scroller>

    <!-- 管理菜单: 设置分组 / 取消关注 -->
    <div v-if="picker.on" class="mask">
      <div class="panel">
        <text class="panel-title">{{ picker.name }}</text>
        <div v-if="!picker.tagsOn" class="panel-row">
          <div class="panel-btn" @click="openTags">
            <image class="panel-ic" :src="MI.folder" :style="{ width: '20px', height: '20px' }"></image>
            <text class="panel-btn-t">设置分组</text>
          </div>
          <div class="panel-btn panel-danger" @click="doUnfollow">
            <text class="panel-btn-t">取消关注</text>
          </div>
        </div>
        <scroller v-else class="panel-list" scroll-direction="vertical" :show-scrollbar="true">
          <text v-if="tags.length === 0" class="panel-state">还没有分组 (可在官方 App 里创建)</text>
          <div v-for="t in tags" :key="'p' + t.tagid" class="panel-item" @click="toggleTag(t)">
            <text class="panel-item-t">{{ (tagSel.indexOf(t.tagid) >= 0 ? '☑ ' : '☐ ') + t.name }}</text>
            <text class="panel-item-s">{{ t.count }} 人</text>
          </div>
        </scroller>
        <div v-if="picker.tagsOn" class="panel-row">
          <div class="panel-btn" @click="saveTags">
            <text class="panel-btn-t">保存分组</text>
          </div>
        </div>
        <div class="panel-cancel" @click="closePicker">
          <text class="panel-cancel-t">取消</text>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { getMyInfo, getFollowings, getRelationTags, setUserTags, modifyRelation, TAG_SPECIAL, TAG_ALL, inTagGroup, badgeKind } from '../../services/bili.js'
import { hasCookie } from '../../services/auth.js'
import { afterPaint } from '../../base-page.js'
import { log } from '../../services/log.js'

// 图标: material-icons-svg 的光栅化产物 (生成器 tools/make-icons.mjs)
const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  bolt: require('../../assets/mi/bolt_16_w.png'),
  folder: require('../../assets/mi/folder_20_m.png')
}

export default {
  name: 'follow',
  data() {
    return {
      MI: MI,
      entering: true,      // 起始态在屏幕右侧外 (见 .page-enter), 挂载后 60ms 置 false 滑入
      logged: false,
      loaded: false,
      me: 0,
      items: [],
      tags: [],
      tagFilter: TAG_ALL,   // -999 全部 / -10 特别关注 / 0 默认分组 / 其它 = 自定义分组 id
      total: 0,
      pn: 0,
      hasMore: false,
      loading: false,
      status: '加载中…',
      generation: 0,
      picker: { on: false, name: '', mid: 0, tagsOn: false },
      tagSel: [],
      busy: false
    }
  },
  computed: {
    // 分组筛选走客户端过滤: 关注列表每一项都带 tags[] 与 special (接口实测字段),
    // 所以「全部」以外不需要再发一次请求 —— 代价是每页 20 条, 翻页前只筛已加载部分.
    // 判定口径统一在 bili.js 的 inTagGroup (全部=-999 / 特别关注=-10 / 默认分组=0 / 自定义=正整数)
    shown() {
      const out = []
      for (let i = 0; i < this.items.length; i++) {
        if (inTagGroup(this.items[i], this.tagFilter)) out.push(this.items[i])
      }
      return out
    }
  },
  methods: {
    onShow() {
      this.logged = hasCookie()
      // 进入动画: 首帧后把 entering 翻成 false 滑入 (与 toview/up 同一套约定;
      // 0.9.61 踩过: 把 .page-enter 写成 translate(0,0) 且 entering 永远为 true,
      // 动画状态机卡住 -> 任何 navTo 都只放出「关闭动画」, 目标页打不开)
      if (this.entering) {
        const self = this
        try {
          const p = this.$page
          if (p && p.setTimeout) p.setTimeout(function () { self.entering = false }, 60)
          else setTimeout(function () { self.entering = false }, 60)
        } catch (e) { this.entering = false }
      }
      try { log('关注页', 'onShow 到达 started=' + (this._started === true)) } catch (e0) {}
      if (this._started) return
      this._started = true
      this.load(true)
    },
    goBack() { try { this.$page.finish() } catch (e) {} },
    goLogin() { try { $falcon.navTo('login', {}) } catch (e) {} },
    retry() { this.generation++; this.loading = false; this.status = '加载中…'; this.load(true) },
    badgeCls(u) { return badgeKind(u && u.officialType, u && u.officialRole) === 'org' ? 'vbadge-org' : 'vbadge-per' },
    // 接口的分组列表里是否已经带了「特别关注」(-10): 带了就不再渲染兜底那个
    hasSpecialTag() {
      for (let i = 0; i < this.tags.length; i++) { if (this.tags[i].tagid === TAG_SPECIAL) return true }
      return false
    },
    setFilter(id) {
      if (this.tagFilter === id) return
      this.tagFilter = id
      const n = this.shown.length
      try { log('关注页', '筛选分组 ' + id + ' -> ' + n + ' 人') } catch (e) {}
    },
    async load(reset) {
      if (this.loading) return
      if (!reset && !this.hasMore) return
      this.logged = hasCookie()
      if (!this.logged) { this.status = ''; this.loaded = true; return }
      const self = this
      this.loading = true
      if (reset) this.status = '加载中…'
      const gen = ++this.generation
      const pn = reset ? 1 : this.pn + 1
      afterPaint(async function () {
        try {
          if (reset) {
            const info = await getMyInfo()
            if (gen !== self.generation) return
            self.me = Number((info && info.mid) || 0)
            if (!self.me) { self.status = '登录已过期, 请重新登录'; self.loaded = true; return }
            if (self.tags.length === 0) {
              try {
                const tl = await getRelationTags()
                if (gen !== self.generation) return
                self.tags = tl
                try { log('关注页', '分组 ' + tl.length + ' 个') } catch (e1) {}
              } catch (e2) {
                try { log('关注页', '分组失败 ' + (e2 && e2.message ? e2.message : e2)) } catch (e3) {}
              }
            }
          }
          const r = await getFollowings(self.me, pn, 20)
          if (gen !== self.generation) return
          if (reset) self.items = []
          for (let i = 0; i < r.list.length; i++) self.items.push(r.list[i])
          self.total = r.total || 0
          self.pn = pn
          self.hasMore = r.list.length >= 20
          self.status = self.items.length === 0 ? '还没有关注任何人' : ''
          self.loaded = true
          try { log('关注页', '加载 ' + self.items.length + ' 条 (total=' + self.total + ' pn=' + pn + ')') } catch (e4) {}
        } catch (err) {
          if (gen !== self.generation) return
          self.status = (err && err.message) ? err.message : String(err)
          self.loaded = true
          try { log('关注页', '加载失败 ' + self.status) } catch (e5) {}
        } finally {
          if (gen === self.generation) self.loading = false
        }
      })
    },
    loadMore() { if (this.loading || !this.hasMore) return; this.load(false) },
    openUp(u) {
      if (!u || !u.mid) { this.status = '这条没有 UID'; return }
      try {
        log('关注页', '打开主页 mid=' + u.mid + ' name=' + u.name)
        $falcon.navTo('up', { mid: String(u.mid), name: u.name })
      } catch (e) { this.status = '打开主页失败: ' + (e && e.message ? e.message : e) }
    },
    openManage(u) {
      this.picker = { on: true, name: u.name, mid: u.mid, tagsOn: false }
      this.tagSel = (u.tags || []).slice()
    },
    closePicker() { this.picker = { on: false, name: '', mid: 0, tagsOn: false } },
    openTags() {
      this.picker.tagsOn = true
      if (this.tags.length > 0) return
      const self = this
      getRelationTags().then(function (l) { self.tags = l }).catch(function (e) { self.status = '分组加载失败' })
    },
    toggleTag(t) {
      const i = this.tagSel.indexOf(t.tagid)
      if (i >= 0) this.tagSel.splice(i, 1)
      else this.tagSel.push(t.tagid)
      this.tagSel = this.tagSel.slice()
    },
    async saveTags() {
      if (this.busy) return
      const mid = this.picker.mid
      const after = this.tagSel.slice()
      const before = []
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].mid === mid) {
          const t = this.items[i].tags || []
          for (let j = 0; j < t.length; j++) before.push(t[j])
          break
        }
      }
      this.busy = true
      this.status = '保存中…'
      try {
        await setUserTags(mid, before, after)
        for (let i = 0; i < this.items.length; i++) {
          if (this.items[i].mid === mid) {
            this.items[i].tags = after
            this.items[i].special = after.indexOf(TAG_SPECIAL) >= 0
          }
        }
        this.status = '分组已保存'
        try { log('关注页', '分组 ' + mid + ' ' + before.join('/') + ' -> ' + after.join('/')) } catch (e0) {}
        this.closePicker()
      } catch (err) {
        this.status = (err && err.message) ? err.message : '保存分组失败'
      } finally {
        this.busy = false
      }
    },
    async doUnfollow() {
      if (this.busy) return
      const mid = this.picker.mid
      this.busy = true
      this.status = '取消中…'
      try {
        await modifyRelation(mid, 2)
        const keep = []
        for (let i = 0; i < this.items.length; i++) { if (this.items[i].mid !== mid) keep.push(this.items[i]) }
        this.items = keep
        if (this.total > 0) this.total--
        this.status = '已取消关注'
        try { log('关注页', '取关 ' + mid) } catch (e0) {}
        this.closePicker()
      } catch (err) {
        this.status = (err && err.message) ? err.message : '取关失败'
      } finally {
        this.busy = false
      }
    }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: #000000; transition-property: transform; transition-duration: 260ms; transition-timing-function: ease-out; }
.topbar { position: absolute; left: 0px; top: 0px; width: 960px; height: 44px; flex-direction: row; align-items: center; background-color: #0b0b0d; }
.back { padding-left: 16px; padding-right: 14px; height: 40px; flex-direction: row; align-items: center; justify-content: center;
  width: 132px;
  border-radius: 20px;
  background-color: #141416;
}
.back-ic { margin-right: 4px; }
.back-text { font-size: 22px; color: #ffffff; }
.topbar-title { font-size: 22px; color: #ffffff; }
.topbar-sub { font-size: 15px; color: #7c8592; margin-left: 12px; }
.gtabs { position: absolute; left: 0px; top: 44px; width: 960px; height: 40px; flex-direction: row; background-color: #16181d; }
.gtab { height: 28px; justify-content: center; align-items: center; padding-left: 14px; padding-right: 14px; margin-left: 8px; margin-top: 6px; border-radius: 14px; background-color: #141416; }
.gtab-on { background-color: #fb7299; }
.gtab-t { font-size: 16px; color: #cfd5de; }
.gtab-t-on { color: #ffffff; }
.list { position: absolute; left: 0px; top: 84px; width: 960px; height: 182px; flex-direction: column; }
.state { font-size: 17px; color: #8a93a0; text-align: center; padding-top: 14px; padding-bottom: 14px; }
.gate { flex-direction: column; justify-content: center; align-items: center; padding-top: 40px; }
.gate-text { font-size: 18px; color: #8a93a0; }
.gate-btn { margin-top: 16px; height: 48px; padding-left: 24px; padding-right: 24px; border-radius: 24px; background-color: #fb7299; justify-content: center; align-items: center; }
.gate-btn-text { font-size: 19px; color: #ffffff; }
.item { width: 928px; margin-left: 16px; margin-top: 8px; padding-left: 12px; padding-right: 12px; padding-top: 10px; padding-bottom: 10px; flex-direction: row; align-items: center; background-color: #0b0b0d; border-radius: 12px; }
.face-wrap { position: relative; width: 64px; height: 64px; margin-right: 14px; }
.face { width: 64px; height: 64px; border-radius: 32px; background-color: #141416; }
.meta { flex: 1; flex-direction: column; }
.namerow { flex-direction: row; align-items: center; }
.name { font-size: 20px; color: #ffffff; }
.vbadge { width: 18px; height: 18px; border-radius: 9px; margin-left: 6px; justify-content: center; align-items: center; }
.vbadge-per { background-color: #ffac2c; }
.vbadge-org { background-color: #3ca5ec; }
.sptag { font-size: 14px; color: #ffffff; background-color: #fb7299; padding-left: 8px; padding-right: 8px; padding-top: 2px; padding-bottom: 2px; border-radius: 6px; margin-left: 8px; }
.sign { font-size: 16px; color: #a8a8b0; margin-top: 4px; lines: 1; text-overflow: ellipsis; overflow: hidden; }
.manage { width: 96px; height: 48px; border-radius: 24px; background-color: #141416; justify-content: center; align-items: center; }
.manage-t { font-size: 18px; color: #cfd5de; }
.more { font-size: 17px; color: #3ca5ec; text-align: center; padding-top: 12px; padding-bottom: 12px; }
.empty { font-size: 17px; color: #8a93a0; text-align: center; margin-top: 24px; }
.mask { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; background-color: rgba(0,0,0,0.55); flex-direction: column; justify-content: center; align-items: center; z-index: 150; }
.panel { width: 560px; padding: 16px; background-color: #141416; border-radius: 16px; flex-direction: column; }
.panel-title { font-size: 20px; color: #ffffff; text-align: center; margin-bottom: 12px; }
.panel-row { flex-direction: row; justify-content: center; margin-bottom: 10px; }
.panel-btn { height: 48px; padding-left: 20px; padding-right: 20px; margin-left: 6px; margin-right: 6px; border-radius: 24px; background-color: #141416; flex-direction: row; justify-content: center; align-items: center; }
.panel-ic { margin-right: 6px; }
.panel-btn-t { font-size: 19px; color: #ffffff; }
.panel-danger { background-color: #3a2733; }
.panel-list { max-height: 120px; height: 120px; flex-direction: column; }
.panel-state { font-size: 16px; color: #8a94a6; text-align: center; padding-top: 10px; }
.panel-item { flex-direction: row; align-items: center; justify-content: space-between; padding-top: 10px; padding-bottom: 10px; padding-left: 12px; padding-right: 12px; border-bottom-width: 1px; border-bottom-color: #141416; }
.panel-item-t { font-size: 18px; color: #e8edf3; }
.panel-item-s { font-size: 15px; color: #8a94a6; }
.panel-cancel { height: 44px; margin-top: 4px; border-radius: 22px; background-color: #0b0b0d; justify-content: center; align-items: center; }
.panel-cancel-t { font-size: 19px; color: #cfd5de; }
/* 起始态: 页面在屏幕右侧外 (与 toview/up 一致), 去掉这个类即滑入 */
.page-enter { transform: translateX(960px); }
</style>
