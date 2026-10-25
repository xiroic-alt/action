<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: 标题 + 返回 + 刷新 (消息是时效性内容, 给一个显式重载入口) -->
    <AppBar title="消息" :back="true" :actions="['refresh']" @back="onBack" @action="onAction"></AppBar>

    <div class="content">
      <!-- 三个 tab 做成 44px 高的分段条: 命中区正好压在触摸下限上;
           右侧留白显示当前分栏的条数/未读概要, 不浪费 960 的横向空间 -->
      <div class="tabbar">
        <div v-for="t in tabs" :key="t.id" class="tab" :style="tabStyle(t)" @click="pickTab(t)">
          <text class="tabt" :style="tabText(t)">{{ t.label }}</text>
          <div v-if="t.id === 'unread' && unreadTotal > 0" class="tabdot" :style="dotStyle"></div>
        </div>
        <div class="tabspacer"></div>
        <text v-if="hintText !== ''" class="tabhint" :lines="1" :style="U.t.tiny">{{ hintText }}</text>
      </div>

      <!-- 未登录: msgfeed / session_svr 三个接口都要 Cookie.
           接口层用了 noError, 未登录不会抛错而是回空数据 —— 光靠 catch 会把它
           显示成"暂无消息", 所以先本地判 Cookie, 直接给登录入口 -->
      <div v-if="needLogin" class="gate">
        <image class="hintic" :src="MIc.empty" :style="{ width: '30px', height: '30px' }"></image>
        <text class="hintt" :style="U.t.weak">请先登录</text>
        <div class="loginbtn" :style="loginBtnStyle" @click="goLogin">
          <text class="loginbtt" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">去登录</text>
        </div>
      </div>

      <div v-else class="pane">
        <!-- 未读汇总: 四个号码块横排, 块高 156 让数字足够大, 隔着一米也看得清 -->
        <div v-if="tab === 'unread'" class="blocks">
          <div v-for="(b, i) in blocks" :key="b.key" class="ublock" :style="blockStyle(i)" @click="openBlock(b)">
            <text class="ubnum" :style="{ fontSize: BIG_NUM + 'px', color: b.color }">{{ b.value }}</text>
            <text class="ublabel" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ b.label }}</text>
          </div>
        </div>

        <!-- 回复我的: 头像 + 昵称 + 内容两行 + 时间.
             行不可点 —— msgfeed/reply 只回了 source_content, 没有 oid/bvid, 点了没有落点 -->
        <scroller v-else-if="tab === 'reply'" class="body" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
          <div v-if="loading && replies.length === 0" class="hint">
            <text class="hintt" :style="U.t.weak">加载中…</text>
          </div>
          <div v-else-if="replies.length === 0" class="hint">
            <image class="hintic" :src="MIc.empty" :style="{ width: '30px', height: '30px' }"></image>
            <text class="hintt" :style="U.t.weak">{{ emptyText }}</text>
          </div>
          <div v-else class="list">
            <div v-for="(r, i) in replies" :key="rowKey(r, i)" class="rrow" :style="rowStyle">
              <div class="rav" :style="avStyle">
                <image v-if="r.face !== ''" class="avimg" :src="r.face" :style="avStyle" resize="cover"></image>
                <image v-else class="avic" :src="MIc.user" :style="{ width: '24px', height: '24px' }"></image>
              </div>
              <div class="rcol">
                <div class="rhead">
                  <RichText class="rname" :text="r.author" :size="U.f.caption" :color="U.c.onSurface" :lines="1" :drop-emoji="false" />
                  <text class="rtime" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ r.timeText }}</text>
                </div>
                <RichText class="rtext" :text="r.text" :size="U.f.body" :color="U.c.onSurfaceVariant" :lines="2" :drop-emoji="false" />
              </div>
            </div>

            <div class="foot">
              <div class="more" :style="moreStyle" @click="loadMore">
                <text class="moret" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ moreText }}</text>
              </div>
            </div>
          </div>
        </scroller>

        <!-- 私信: session_svr 只回了 talker_id / unread_count / session_ts, 没有昵称头像,
             这里先退化成"用户 + uid"+ 通用头像; 接口补齐 name/face 后自动生效 (下面 pmRow 已经优先取它们) -->
        <scroller v-else class="body" scroll-direction="vertical" :show-scrollbar="true">
          <div v-if="loading && sessions.length === 0" class="hint">
            <text class="hintt" :style="U.t.weak">加载中…</text>
          </div>
          <div v-else-if="sessions.length === 0" class="hint">
            <image class="hintic" :src="MIc.empty" :style="{ width: '30px', height: '30px' }"></image>
            <text class="hintt" :style="U.t.weak">{{ emptyText }}</text>
          </div>
          <div v-else class="list">
            <div v-for="(s, i) in sessions" :key="rowKey(s, i)" class="prow" :style="pmRowStyle">
              <div class="rav" :style="avStyle">
                <image v-if="s.face !== ''" class="avimg" :src="s.face" :style="avStyle" resize="cover"></image>
                <image v-else class="avic" :src="MIc.user" :style="{ width: '24px', height: '24px' }"></image>
              </div>
              <div class="pcol">
                <RichText class="pname" :text="s.name" :size="U.f.body" :color="U.c.onSurface" :lines="1" :drop-emoji="false" />
                <!-- 会话摘要属于用户内容 (可能带 emoji), 必须走 RichText -->
                <RichText v-if="s.preview !== ''" class="pprev" :text="s.preview" :size="U.f.tiny" :color="U.c.onSurfaceVariant" :lines="1" :drop-emoji="false" />
              </div>
              <div class="pright">
                <text class="ptime" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ s.timeText }}</text>
                <div v-if="s.unread > 0" class="pbadge" :style="badgeStyle">
                  <text class="pbadget" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onError }">{{ s.unreadText }}</text>
                </div>
              </div>
            </div>
          </div>
        </scroller>
      </div>
    </div>

    <!-- 轻提示: 框架没有 toast -->
    <div v-if="tip !== ''" class="tip" :style="tipStyle">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
import AppBar from '../../components/app-bar.vue'
import RichText from '../../components/rich-text.vue'
// 消息中心 —— 对应 PiliNara lib/pages/msg_feed_top:
//   未读汇总 (回复 / at / 点赞 / 系统) + 回复我的 + 私信会话, 三个分栏.
// 数据来源: services/api.js 的 msgUnread / msgReplies / pmSessions (全部 Web 链路).
import { ui } from '../../design/ui.js'
import { msgUnread, msgReplies, pmSessions } from '../../services/api.js'
import { hasCookie } from '../../core/auth.js'
import { log } from '../../core/log.js'

// 分栏顺序按需求给: 回复我的 / 未读汇总 / 私信
const TABS = [
  { id: 'reply', label: '回复我的' },
  { id: 'unread', label: '未读汇总' },
  { id: 'pm', label: '私信' }
]
const REPLY_PAGE_SIZE = 20      // 与 api.js 里 msgReplies 的 ps=20 对齐 (用它推断还有没有下一页)
const REPLY_ROW_H = 78
const PM_ROW_H = 68
const BIG_NUM = 40              // 号码块里的数字: 比 U.f.title 大一倍多, 一眼能读
const BLOCK_W = Math.floor((960 - 24 - 30) / 4)   // 四块 + 三处 10px 间隙 + 左右各 12 内边距
const BLOCK_H = 156
const TIP_MS = 2000

// nav_mine_26 有明暗两版 (浅色主题用深色图标), comment_24_m 是中性色不分主题
const MI = {
  user: require('../../assets/mi/nav_mine_26_w.png'),
  empty: require('../../assets/mi/comment_24_m.png')
}
const MI_D = {
  user: require('../../assets/mi/nav_mine_26_d.png'),
  empty: require('../../assets/mi/comment_24_m.png')
}

function emptyUnread() { return { reply: 0, at: 0, like: 0, sys: 0 } }

export default {
  components: { AppBar, RichText },
  name: 'msg',
  data() {
    return {
      // 两个世代: 未读汇总和当前分栏是并行加载的, 共用一个计数器会互相作废
      genSeq: 0,
      uGen: 0,
      U: ui(),
      tab: 'reply',
      unread: emptyUnread(),
      replies: [],
      replyPage: 1,
      replyHasMore: false,
      sessions: [],
      loading: false,
      uloading: false,
      status: '',
      needLogin: false,
      tip: '',
      BIG_NUM: BIG_NUM
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    tabs() { return TABS },
    unreadTotal() {
      const u = this.unread
      return (Number(u.reply) || 0) + (Number(u.at) || 0) + (Number(u.like) || 0) + (Number(u.sys) || 0)
    },
    // 号码块: 颜色按语义挑 —— 回复用主色, at 用第三色, 点赞用 error(红), 系统通知降到次要文字色
    blocks() {
      const c = this.U.c
      const u = this.unread
      return [
        { key: 'reply', label: '回复我的', value: String(Number(u.reply) || 0), color: c.primary },
        { key: 'at', label: '@我的', value: String(Number(u.at) || 0), color: c.tertiary },
        { key: 'like', label: '收到的赞', value: String(Number(u.like) || 0), color: c.error },
        { key: 'sys', label: '系统通知', value: String(Number(u.sys) || 0), color: c.onSurfaceVariant }
      ]
    },
    // 顶栏右侧的概要: 未登录/出错时把 status 顶出来, 否则给条数
    hintText() {
      if (this.needLogin) return '未登录'
      if (this.status !== '') return this.status
      if (this.tab === 'reply') return this.replies.length > 0 ? '已加载 ' + this.replies.length + ' 条' : ''
      if (this.tab === 'pm') return this.sessions.length > 0 ? '共 ' + this.sessions.length + ' 个会话' : ''
      return this.unreadTotal > 0 ? '共 ' + this.unreadTotal + ' 条未读' : '暂无未读'
    },
    emptyText() {
      if (this.status !== '') return this.status
      if (this.tab === 'pm') return '还没有私信'
      return '还没有人回复你'
    },
    moreText() {
      if (this.loading) return '加载中…'
      return this.replyHasMore ? '加载更多' : '没有更多了'
    },

    dotStyle() {
      return { backgroundColor: this.U.c.error }
    },
    blockStyle(i) {
      return {
        width: BLOCK_W + 'px',
        height: BLOCK_H + 'px',
        marginRight: i < 3 ? '10px' : '0px',
        backgroundColor: this.U.c.surfaceContainerLow,
        borderRadius: this.U.rad.card + 'px'
      }
    },
    avStyle() {
      return {
        width: '44px',
        height: '44px',
        borderRadius: '22px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden'
      }
    },
    rowStyle() {
      return {
        height: REPLY_ROW_H + 'px',
        marginBottom: '6px',
        paddingLeft: '8px',
        paddingRight: '12px',
        backgroundColor: this.U.c.surfaceContainerLow,
        borderRadius: this.U.rad.card + 'px'
      }
    },
    pmRowStyle() {
      return {
        height: PM_ROW_H + 'px',
        marginBottom: '6px',
        paddingLeft: '8px',
        paddingRight: '12px',
        backgroundColor: this.U.c.surfaceContainerLow,
        borderRadius: this.U.rad.card + 'px'
      }
    },
    badgeStyle() {
      return {
        minWidth: '18px',
        height: '18px',
        paddingLeft: '5px',
        paddingRight: '5px',
        marginTop: '4px',
        backgroundColor: this.U.c.error,
        borderRadius: '9px'
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
    this.uGen = 0
    this.tipTimer = null
    this.needLogin = !hasCookie()
    if (this.needLogin) return
    // 未读汇总先拉: 顶栏的未读小红点要靠它, 与当前分栏并行
    this.loadUnread()
    this.loadCurrent(true)
  },
  methods: {
    // 框架只转发 onShow / onPageUnload 这两个生命周期
    onShow() {
      this.U = ui()
      const logged = hasCookie()
      // 从登录页回来时登录态翻转才重拉, 否则每次回前台都白发一轮请求
      if (logged === !this.needLogin) return
      this.needLogin = !logged
      if (logged) { this.status = ''; this.loadUnread(); this.loadCurrent(true) }
    },
    onPageUnload() {
      this.genSeq++
      this.uGen++
      if (this.tipTimer) { clearTimeout(this.tipTimer); this.tipTimer = null }
    },

    onBack() {
      try { this.$page.finish() } catch (e) {
        try { $falcon.navTo('index', {}) } catch (e2) {}
      }
    },
    onAction(a) {
      if (a !== 'refresh') return
      this.status = ''
      this.loadUnread()
      this.loadCurrent(true)
    },

    // ---------------- 分栏 ----------------
    pickTab(t) {
      if (!t) return
      // 再点当前 tab = 重载当前分栏 (与「我的」页的 reselect 行为一致)
      if (t.id === this.tab) { this.loadCurrent(true); return }
      this.tab = t.id
      this.status = ''
      this.loadCurrent(true)
    },
    openBlock(b) {
      if (!b) return
      // 只有"回复我的"有对应列表; 其余三类上游这一屏没有列表页, 给个明确提示而不是静默
      if (b.key === 'reply') { this.tab = 'reply'; this.status = ''; this.loadCurrent(true); return }
      this.showTip('「' + b.label + '」列表下一批接入')
    },

    loadCurrent(reset) {
      if (this.needLogin) return
      if (this.tab === 'unread') { this.loadUnread(); return }
      if (this.tab === 'reply') { this.loadReply(reset); return }
      this.loadPm(reset)
    },

    // ---------------- 数据 ----------------
    /** 未读汇总: 独立世代, 切分栏时不被作废 */
    async loadUnread() {
      if (this.needLogin) return
      const g = ++this.uGen
      this.uloading = true
      try {
        const u = await msgUnread()
        if (g !== this.uGen) return
        this.unread = {
          reply: Number(u && u.reply) || 0,
          at: Number(u && u.at) || 0,
          like: Number(u && u.like) || 0,
          sys: Number(u && u.sys) || 0
        }
        log('消息', '未读汇总 ' + this.unreadTotal)
      } catch (e) {
        if (g !== this.uGen) return
        this.unread = emptyUnread()
        this.handleErr(e)
      } finally {
        if (g === this.uGen) this.uloading = false
      }
    },

    async loadReply(reset) {
      if (this.needLogin) return
      if (reset) { this.replyPage = 1; this.replyHasMore = false }
      const gen = ++this.genSeq
      this.loading = true
      if (reset) this.status = ''
      try {
        const r = await msgReplies(this.replyPage)
        if (gen !== this.genSeq) return
        const list = (r && r.list) || []
        this.replies = reset ? list : this.replies.concat(list)
        // 接口没给 has_more: 一次给满 20 条就认为还有下一页
        this.replyHasMore = list.length >= REPLY_PAGE_SIZE
        log('消息', '回复第 ' + this.replyPage + ' 页 -> ' + this.replies.length + ' 条')
      } catch (e) {
        if (gen !== this.genSeq) return
        if (reset) this.replies = []
        this.handleErr(e)
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },

    async loadPm(reset) {
      if (this.needLogin) return
      // 会话列表一次拉全 (接口没有分页参数), 只有显式重置才重拉
      if (this.sessions.length > 0 && !reset) return
      const gen = ++this.genSeq
      this.loading = true
      if (reset) this.status = ''
      try {
        const list = await pmSessions()
        if (gen !== this.genSeq) return
        const rows = (list || []).map(this.pmRow)
        this.sessions = rows
        log('消息', '私信会话 ' + rows.length + ' 个')
      } catch (e) {
        if (gen !== this.genSeq) return
        this.sessions = []
        this.handleErr(e)
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },

    /** 会话行: 接口目前只有 talker_id, 昵称/头像先兜底, 将来补了字段这里自动接上 */
    pmRow(s) {
      const id = Number(s && s.talkerId) || 0
      const unread = Number(s && s.unread) || 0
      return {
        talkerId: id,
        name: String((s && (s.name || s.nickname || s.uname)) || '') || ('用户 ' + id),
        face: String((s && (s.face || s.avatar)) || ''),
        preview: String((s && s.preview) || ''),
        timeText: String((s && s.timeText) || ''),
        unread: unread,
        unreadText: unread > 99 ? '99+' : String(unread)
      }
    },

    loadMore() {
      if (this.loading || !this.replyHasMore) return
      this.replyPage++
      this.loadReply(false)
    },
    onScroll(e) {
      const d = (e && e.detail) ? e.detail : {}
      if (this.tab !== 'reply') return
      if (d.scrollBottom != null && d.scrollBottom < 80 && this.replies.length > 0 && this.replyHasMore && !this.loading) {
        this.loadMore()
      }
    },

    /** 统一的错误出口: 先看是不是登录态没了, 否则把接口原话显示出来 */
    handleErr(e) {
      if (!hasCookie()) { this.needLogin = true; return }
      this.status = (e && e.message) ? e.message : String(e)
      log('消息', '失败: ' + this.status)
    },

    // ---------------- 交互 ----------------
    goLogin() {
      try { $falcon.navTo('login', {}) } catch (e) {}
    },

    // ---------------- 样式辅助 ----------------
    tabStyle(t) {
      const on = t.id === this.tab
      return {
        height: '44px',
        paddingLeft: '16px',
        paddingRight: '16px',
        marginRight: '8px',
        backgroundColor: on ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.chip + 'px'
      }
    },
    tabText(t) {
      const on = t.id === this.tab
      return {
        fontSize: this.U.f.body + 'px',
        color: on ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    },
    rowKey(it, i) { return String(it.id || it.talkerId || '') + '_' + i },

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
/* 页面根: 绝对定位铺满 960x266, 纵向排列 (顶栏 + 内容区) */
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
/* 内容区: 顶栏 44 之后剩下的 222px */
.content { flex: 1; width: 100%; flex-direction: column; }

/* 分段条: 44px 高, chip 也是 44 高 —— 触摸命中区正好卡在下限上 */
.tabbar { height: 44px; flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; }
.tab { flex-direction: row; align-items: center; justify-content: center; }
.tabt { }
.tabdot { width: 8px; height: 8px; border-radius: 4px; margin-left: 5px; }
.tabspacer { flex: 1; }
.tabhint { }

/* 登录闸门 / 空态 / 加载态 */
.gate { flex: 1; width: 100%; flex-direction: column; justify-content: center; align-items: center; }
.hint { width: 100%; height: 140px; flex-direction: column; justify-content: center; align-items: center; }
.hintic { }
.hintt { margin-top: 6px; }
.loginbtn { justify-content: center; align-items: center; }
.loginbtt { }

/* 分栏容器: 三个分栏各自铺满 */
.pane { flex: 1; width: 100%; flex-direction: column; }

/* 未读汇总: 四个号码块横排 */
.blocks { flex-direction: row; padding-left: 12px; padding-right: 12px; padding-top: 8px; }
.ublock { flex-direction: column; justify-content: center; align-items: center; }
.ubnum { }
.ublabel { margin-top: 6px; }

/* 列表通用 (回复我的 / 私信) */
.body { flex: 1; width: 100%; }
.list { flex-direction: column; padding-left: 12px; padding-right: 12px; padding-top: 6px; }

/* 回复我的: 头像 + (昵称/时间 + 内容两行) */
.rrow { flex-direction: row; align-items: center; }
.rcol { flex: 1; flex-direction: column; justify-content: center; padding-left: 10px; }
.rhead { flex-direction: row; align-items: center; }
.rname { flex: 1; }
.rtime { margin-left: 8px; }
.rtext { margin-top: 3px; }

/* 私信: 头像 + 昵称 + 右侧时间/未读红点 */
.prow { flex-direction: row; align-items: center; }
.pcol { flex: 1; flex-direction: column; justify-content: center; padding-left: 10px; }
.pname { }
.pprev { margin-top: 2px; }
.pright { flex-direction: column; align-items: flex-end; justify-content: center; }
.ptime { }
.pbadge { justify-content: center; align-items: center; }
.pbadget { }

/* 头像: 圆形裁剪, 图缺失时退化成通用图标 */
.rav { }
.avimg { }
.avic { }

/* 底部加载更多 */
.foot { width: 100%; flex-direction: row; justify-content: center; align-items: center; padding-top: 2px; padding-bottom: 10px; }
.more { flex-direction: row; justify-content: center; align-items: center; }
.moret { }

/* 轻提示 */
.tip { justify-content: center; align-items: center; }
.tipt { }
</style>
