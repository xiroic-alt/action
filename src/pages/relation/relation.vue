<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏 44px: 标题按 kind 区分 (关注 / 粉丝), 右上角刷新当前列表 -->
    <AppBar :title="barTitle" :back="true" :actions="['refresh']" @back="onBack" @action="onAction"></AppBar>

    <div class="main">
      <scroller class="body" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
        <div v-if="loading && users.length === 0" class="hint">
          <text class="hintt" :style="U.t.weak">加载中…</text>
        </div>
        <div v-else-if="users.length === 0" class="hint">
          <text class="hintt" :style="U.t.weak">{{ status }}</text>
        </div>

        <!-- 横向卡片: 40px 圆头像 + (昵称 + 粉丝数) + 签名 1 行.
             为什么一行 68px: 222px 内容区正好露出 3 行, 一屏能看到 3 个人而不是 1.5 个 -->
        <div v-else class="rows">
          <div v-for="(u, i) in users" :key="u.mid + '_' + i" class="urow" :style="rowStyle" @click="openUser(u)">
            <div class="uav" :style="avBox">
              <image v-if="u.face !== ''" class="uavimg" :src="u.face" resize="cover" :style="avBox"></image>
            </div>
            <div class="uinfo">
              <div class="uhead">
                <RichText class="uname" :text="u.name" :size="U.f.body" :color="U.c.onSurface" :lines="1" weight="bold" :style="{ flex: 1 }" :drop-emoji="false" />
                <text v-if="u.fansText !== ''" class="ufans" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">粉丝 {{ u.fansText }}</text>
              </div>
              <RichText class="usign" :text="signOf(u)" :size="U.f.caption" :color="U.c.onSurfaceVariant" :lines="1" :drop-emoji="false" />
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

    <!-- 轻提示 (框架没有 toast): 翻页失败的反馈 -->
    <div v-if="tip !== ''" class="tip" :style="tipStyle">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
import RichText from '../../components/rich-text.vue'
// 关注 / 粉丝列表 —— 对应 PiliNara lib/pages/follow + fan:
// 两个页面在上游结构一致 (同一套用户行), 这里合并成一页, 用 kind 区分接口与标题.
//   横向卡片: 40px 圆头像 + 昵称 + 粉丝数 + 签名 1 行; 点击进入该用户的 UP 空间.
import AppBar from '../../components/app-bar.vue'
import { ui } from '../../design/ui.js'
import { log } from '../../core/log.js'
import { relationList } from '../../services/api.js'

// ---- 笔屏几何: 数字只在这里出现 ----
const AV = 40
const ROW_H = 68                                  // 222 / 68 约等于 3.2 行, 一屏看 3 个人
const PAGE_PS = 20                                // relationList 内部固定 ps=20: 不足一页即到底
const TIP_MS = 2000

export default {
  components: { AppBar, RichText },
  name: 'relation',
  data() {
    return {
      U: ui(),
      // ★ 世代守卫必须是 data 里的普通数字键: Vue2 不代理 _ 开头的键, ++undefined = NaN,
      //   而 NaN !== NaN 恒真 -> 响应永远被判"过期"丢弃, 页面卡在加载中 (项目历史踩过)
      genSeq: 0,
      paramKey: '',
      mid: '',
      kind: 'follow',      // follow = 关注列表 / fans = 粉丝列表
      users: [],
      page: 0,             // 已加载到第几页 (relationList 的 pn 从 1 开始)
      hasMore: true,
      loading: false,
      status: '',
      tip: '',
      AV: AV,
      ROW_H: ROW_H
    }
  },
  computed: {
    barTitle() { return this.kind === 'fans' ? '粉丝' : '关注' },
    emptyText() { return this.kind === 'fans' ? '还没有粉丝' : '还没有关注任何人' },
    moreText() {
      if (this.loading) return '加载中…'
      return this.hasMore ? '加载更多' : '没有更多了'
    },

    // ---- 样式 ----
    rowStyle() {
      return {
        backgroundColor: this.U.c.surfaceContainerLow,
        borderRadius: this.U.rad.card + 'px'
      }
    },
    avBox() {
      return {
        width: AV + 'px',
        height: AV + 'px',
        borderRadius: (AV / 2) + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest
      }
    },
    moreStyle() {
      return {
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    tipStyle() {
      return {
        backgroundColor: this.U.c.inverseSurface,
        borderRadius: this.U.rad.chip + 'px'
      }
    }
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
    /** 读取页面参数 (mounted 不保证触发, onShow 也要读; 同参数幂等) */
    readOptions() {
      const o = (this.$page && this.$page.options) || {}
      const mid = String(o.mid == null ? '' : o.mid)
      const kind = o.kind === 'fans' ? 'fans' : 'follow'
      const key = mid + '|' + kind
      if (this.paramKey === key && mid !== '') return
      this.paramKey = key
      this.mid = mid
      this.kind = kind
      if (this.mid === '') {
        this.status = '缺少 mid 参数'
        log('关系', '缺少 mid 参数')
        return
      }
      log('关系', '载入 ' + this.barTitle + ' mid=' + this.mid)
      this.load(true)
    },
    onPageUnload() {
      this.genSeq++
      if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null }
    },

    // ---------------- 数据 ----------------
    async load(reset) {
      if (this.mid === '') return
      const gen = ++this.genSeq
      if (reset) {
        this.users = []
        this.page = 0
        this.hasMore = true
        this.status = ''
      }
      this.loading = true
      try {
        const pn = this.page + 1
        const list = await relationList(this.mid, this.kind, pn)
        if (gen !== this.genSeq) return
        this.page = pn
        this.users = reset ? list : this.users.concat(list)
        // 接口不给总页数: 返回不足一页就是到底了
        this.hasMore = list.length >= PAGE_PS
        if (this.users.length === 0) this.status = this.emptyText
        else this.status = this.hasMore ? '' : '没有更多了'
        log('关系', this.barTitle + ' 第 ' + pn + ' 页 -> 累计 ' + this.users.length + ' 人')
      } catch (e) {
        if (gen !== this.genSeq) return
        const msg = e && e.message ? e.message : String(e)
        this.hasMore = false
        this.status = '加载失败: ' + msg
        this.showTip('加载失败: ' + msg)
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },

    // ---------------- 交互 ----------------
    loadMore() {
      if (this.mid === '') return
      if (this.loading) return
      if (!this.hasMore) return
      this.load(false)
    },
    onScroll(e) {
      // 快到底时提前触发下一页, 用户不用去点按钮
      const d = (e && e.detail) ? e.detail : {}
      if (d.scrollBottom != null && d.scrollBottom < 80) this.loadMore()
    },
    onAction(a) {
      if (a !== 'refresh') return
      if (this.loading) return
      this.load(true)
    },
    openUser(u) {
      if (!u || !u.mid) return
      log('关系', '打开空间 mid=' + u.mid)
      try { $falcon.navTo('member', { mid: u.mid, name: u.name }) } catch (e) {}
    },
    // 空签名给一句占位: 否则第二行是空白, 卡片看起来像少了一块
    signOf(u) {
      return u && u.sign ? u.sign : '这个人很懒, 什么都没写'
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
.main { flex: 1; width: 100%; flex-direction: column; }
.body { flex: 1; width: 100%; }
.hint { width: 100%; height: 140px; justify-content: center; align-items: center; }
.hintt { }
.rows { flex-direction: column; padding-left: 12px; padding-right: 12px; padding-top: 2px; }
.urow { width: 100%; height: 68px; flex-direction: row; align-items: center; padding-left: 8px; padding-right: 8px; margin-bottom: 6px; }
.uav { overflow: hidden; }
.uavimg { }
.uinfo { flex: 1; flex-direction: column; justify-content: center; margin-left: 10px; }
.uhead { width: 100%; height: 20px; flex-direction: row; align-items: center; }
.uname { flex: 1; }
.ufans { margin-left: 8px; }
.usign { width: 100%; margin-top: 4px; }
.foot { width: 100%; flex-direction: row; justify-content: center; align-items: center; padding-top: 2px; padding-bottom: 12px; }
.more { height: 44px; padding-left: 22px; padding-right: 22px; justify-content: center; align-items: center; }
.moret { }
.tip { position: absolute; left: 260px; bottom: 8px; width: 440px; height: 40px; justify-content: center; align-items: center; }
.tipt { }
</style>
