<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: PiliNara 视频页的 AppBar 语义 (elevation 0 / 标题 16 / 返回在左) -->
    <AppBar title="视频详情" :back="true" :actions="['cover', 'more']"
            @back="goBack" @action="onBarAction"></AppBar>

    <!-- 内容区: 左右双栏 (参考 PiliNara 详情页在宽屏上的分栏思路)
         左栏固定 520px: UP + 标题 + 数据 + 操作 + 简介
         右栏自适应:     评论 (排序 + 列表)
         960x266 是超宽屏, 上下堆叠会让评论区只剩一条; 分栏后两栏都能吃满 222px -->
    <div class="content" :style="{ height: S.content + 'px', flexDirection: 'row' }">
      <div class="pane" :style="{ width: '520px', height: S.content + 'px' }">
        <div class="uprow" :style="{ height: '44px' }" @click="openMember">
          <div class="avwrap" :style="{ width: '44px', height: '44px' }">
            <image v-if="faceUrl !== ''" class="avatar" :src="faceUrl"
                   :style="{ width: '32px', height: '32px', borderRadius: '16px' }"></image>
            <div v-else class="avatar ph" :style="{ width: '32px', height: '32px', borderRadius: '16px', backgroundColor: U.c.surfaceContainerHighest }"></div>
          </div>
          <div class="upmeta">
            <RichText class="upname" :text="upName" :size="U.f.subtitle" :color="U.c.onSurface" :lines="1" :drop-emoji="false" />
            <text class="upfans" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ fansLine }}</text>
          </div>
          <div class="followHit" :style="{ width: '84px', height: '44px' }" @click="toggleFollow">
            <div class="follow" :style="followStyle">
              <text class="followt" :lines="1" :style="followTextStyle">{{ followLabel }}</text>
            </div>
          </div>
        </div>

        <div class="titlerow" :style="{ height: titleRowH + 'px' }" @click="toggleTitle">
          <RichText class="title" :text="titleText" :size="U.f.subtitle" :color="U.c.onSurface" :lines="titleLines" :drop-emoji="false" />
          <image class="chev" :src="MI.chevron" :style="{ width: '16px', height: '16px' }"></image>
        </div>

        <!-- 数据行常显: 展开标题时也不隐藏 (用户明确要求) -->
        <div class="metarow" :style="{ height: '20px' }">
          <text class="meta" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ metaLine }}</text>
        </div>

        <div class="acts" :style="{ height: '52px' }">
          <div v-for="a in actions" :key="a.id" class="act" :style="actStyle(a)" @click="onAction(a.id)">
            <image class="actic" :src="iconOf(a)" :style="{ width: '22px', height: '22px' }"></image>
            <text class="actt" :lines="1" :style="actTextStyle(a)">{{ a.text }}</text>
          </div>
        </div>

        <div v-if="descText !== ''" class="descHit" :style="{ height: descH + 'px' }" @click="toggleDesc">
          <scroller v-if="descOpen" class="descScroll" scroll-direction="vertical" :show-scrollbar="true"
                    :style="{ height: (descH - 6) + 'px' }">
            <RichText class="desc" :text="descText" :size="U.f.tiny" :color="U.c.onSurfaceVariant" :lines="0" :drop-emoji="false" />
          </scroller>
          <RichText v-else class="desc" :text="descText" :size="U.f.tiny" :color="U.c.onSurfaceVariant" :lines="3" :drop-emoji="false" />
        </div>

        <!-- 播放按钮: 浮动在左栏右下, 不占布局高度 (双栏重排时漏掉过, 这里补回) -->
        <div class="playHit" :style="playHitStyle" @click="goPlay">
          <div class="play" :style="playStyle">
            <text class="playt" :lines="1" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">播放</text>
          </div>
        </div>
      </div>

      <div class="vsep" :style="{ width: '1px', height: S.content + 'px', backgroundColor: U.c.outlineVariant }"></div>

      <div class="cmts" :style="{ width: '439px', height: S.content + 'px' }">
        <div class="sortcol" :style="{ width: '92px' }">
          <text class="sortTitle" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ '评论 ' + replyTotalText }}</text>
          <div v-for="s in sorts" :key="s.id" class="sortHit" :style="{ height: '44px' }" @click="pickSort(s.id)">
            <div class="sortbtn" :style="sortStyle(s.id)">
              <text class="sortt" :lines="1" :style="sortTextStyle(s.id)">{{ s.label }}</text>
            </div>
          </div>
        </div>
        <scroller class="cscroll" scroll-direction="vertical" :show-scrollbar="true" @scroll="onCmtScroll"
                  :style="{ width: '347px', height: S.content + 'px' }">
          <div class="clist">
            <div v-if="comments.length === 0" class="chint">
              <text class="chintt" :style="U.t.weak">{{ cmtStatus !== '' ? cmtStatus : (loadingCmt ? '加载中…' : '暂无评论') }}</text>
            </div>
            <div v-for="(c, i) in comments" :key="c.rpid + '_' + i" class="crow">
              <image v-if="c.face !== ''" class="cav" :src="c.face" :style="{ width: '28px', height: '28px', borderRadius: '14px' }"></image>
              <div v-else class="cav ph" :style="{ width: '28px', height: '28px', borderRadius: '14px', backgroundColor: U.c.surfaceContainerHighest }"></div>
              <div class="cbody">
                <div class="chead">
                  <text class="cname" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ c.author }}</text>
                  <text v-if="c.timeText !== ''" class="ctime" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ c.timeText }}</text>
                </div>
                <RichText class="ctext" :text="c.text" :size="U.f.body" :color="U.c.onSurface" :lines="3" :drop-emoji="false" />
                <!-- 操作条: 点赞 / 回复 / 展开楼中楼 -->
                <div class="cops">
                  <div class="cop" :style="{ height: '30px' }" @click="likeComment(c)">
                    <image class="copic" :src="c.liked ? MI.likeOn : MI.like" :style="{ width: '15px', height: '15px' }"></image>
                    <text class="copt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: c.liked ? U.c.primary : U.c.onSurfaceVariant }">{{ c.likeText === '' ? '赞' : c.likeText }}</text>
                  </div>
                  <div class="cop" :style="{ height: '30px' }" @click="replyComment(c)">
                    <text class="copt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">回复</text>
                  </div>
                  <div v-if="c.replyCount > 0" class="cop" :style="{ height: '30px' }" @click="toggleSub(c)">
                    <text class="copt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.primary }">{{ c.subOpen ? '收起' : ('展开 ' + c.replyCount + ' 条回复') }}</text>
                  </div>
                </div>
                <!-- 楼中楼 -->
                <div v-if="c.subOpen" class="subs" :style="{ backgroundColor: U.c.surfaceContainerLow, borderRadius: U.rad.card + 'px' }">
                  <div v-if="c.subLoading" class="subhint">
                    <text class="subhintt" :lines="1" :style="U.t.weak">加载中…</text>
                  </div>
                  <div v-for="(s, j) in (c.subs || [])" :key="s.rpid + '_' + j" class="subrow">
                    <text class="subn" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.primary }">{{ s.author }}</text>
                    <RichText class="subt" :text="s.text" :size="U.f.tiny" :color="U.c.onSurfaceVariant" :lines="2" :drop-emoji="false" />
                  </div>
                </div>
              </div>
            </div>
            <div class="cwrite">
              <div class="cwbtn" :style="{ backgroundColor: U.c.primary, borderRadius: U.rad.chip + 'px', height: '34px' }" @click="writeComment">
                <text class="cwbtnt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onPrimary }">写评论</text>
              </div>
            </div>
            <div v-if="comments.length > 0" class="cfoot">
              <div class="cmore" :style="U.action" @click="loadComments(false)">
                <text class="cmoret" :style="U.t.caption">{{ loadingCmt ? '加载中…' : (hasMore ? '加载更多' : '没有更多了') }}</text>
              </div>
            </div>
          </div>
        </scroller>
      </div>
    </div>

    <!-- 封面浮层: 完整显示原图 (contain, 留白可接受), 点任意处关闭 -->
    <div v-if="coverOpen" class="coverMask" @click="hideCover">
      <image class="coverBig" :src="coverUrl" resize="contain"></image>
      <text class="coverTip" :lines="1">点击任意处关闭</text>
    </div>

    <!-- 轻提示 (无 toast 组件; 单行状态用页面内小条, 点一下收起) -->
    <div v-if="tip !== ''" class="tipHit" :style="{ width: '380px', height: '44px' }" @click="hideTip">
      <div class="tip" :style="{ backgroundColor: U.c.secondaryContainer, borderRadius: U.rad.chip + 'px' }">
        <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSecondaryContainer }">{{ tip }}</text>
      </div>
    </div>
  </div>
</template>

<script>
// 视频详情页 —— 对齐 PiliNara lib/pages/video/introduction/ugc/view.dart
//
// 上游结构 (行号出处):
//   _buildOwnerInfo 714-772 : 头像 + 昵称/粉丝 + 关注按钮
//   _buildTitle     249-266 / _buildVideoTitle 336-433 : 标题 2 行折叠 (maxLines: 2)
//   _buildInfo      972-1009: 播放量 / 弹幕数 / 发布时间 一行
//   actionGrid      467-557 : 操作栏顺序 点赞 / 投币 / 收藏 / 转发 (ActionItem 图标 + 数字)
//   followButton    435-465 : 关注按钮文案按 attribute 变化
//
// 笔屏落地: 内容区 222 = 信息区 118 (左: UP+标题+数据 / 右: 操作栏+简介) + 评论滚动区 104。
// 展开态 (标题/简介) 放不进 118px, 用详情浮层承载 —— 这是与上游唯一的结构性覆盖。
import AppBar from '../../components/app-bar.vue'
import { createIME } from '../../services/ime.js'
import RichText from '../../components/rich-text.vue'
import { ui } from '../../design/ui.js'
import { SCREEN } from '../../design/tokens.js'
import { videoDetail, userCard, relationModify, favFolders, fav, like, coin, replies, commentLike, commentAdd, subReplies } from '../../services/api.js'
import { splitByVideoIds } from '../../services/bv.js'
import { playCount } from '../../services/format.js'
import { hasCookie } from '../../core/auth.js'
import { getCfg } from '../../core/config.js'
import { log } from '../../core/log.js'

const MI = {
  like: require('../../assets/mi/like_24_m.png'),
  likeOn: require('../../assets/mi/like_24_p.png'),
  coin: require('../../assets/mi/coin_24_m.png'),
  coinOn: require('../../assets/mi/coin_24_p.png'),
  fav: require('../../assets/mi/fav_24_m.png'),
  favOn: require('../../assets/mi/fav_24_p.png'),
  share: require('../../assets/mi/share_24_m.png'),
  play: require('../../assets/mi/play_28_w.png'),
  chevron: require('../../assets/mi/chevron_20_m.png'),
  closeW: require('../../assets/mi/close_24_w.png'),
  closeD: require('../../assets/mi/close_24_d.png')
}

// 信息区高度: 44 (UP 行) + 44 (标题 2 行) + 22 (数据行) + 余量 —— 评论区吃剩下的
const INFO_H = 106
const CMT_H = SCREEN.content - INFO_H

/** 评论行预处理: 先算好视频号, 模板里只负责渲染 (避免在模板里跑正则) */
function prepReply(r) {
  const parts = splitByVideoIds(r.text || '')
  const vids = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.kind && vids.indexOf(p.bvid) < 0) vids.push(p.bvid)
  }
  r.vids = vids
  return r
}

export default {
  components: { AppBar, RichText },
  name: 'video',
  data() {
    return {
      U: ui(),
      S: SCREEN,
      MI: MI,
      INFO_H: INFO_H,
      CMT_H: CMT_H,
      bvid: '',
      // 详情 (来自 api.videoDetail)
      titleText: '',
      descText: '',
      faceUrl: '',
      upName: '',
      metaLine: '',
      aid: 0,
      mid: 0,
      pageRows: [],
      subRows: [],
      // 交互状态 (接口 action 字段是权威值, 本地只做乐观显示)
      liked: false,
      coined: false,
      faved: false,
      cnt: { like: 0, coin: 0, fav: 0, share: 0 },
      // UP 主名片
      up: { fansRaw: 0, fansText: '' },
      following: false,
      // 收藏夹
      favFolderId: 0,
      // 评论
      comments: [],
      sorts: [{ id: 'hot', label: '热度' }, { id: 'time', label: '时间' }],
      sort: 'hot',
      page: 1,
      hasMore: true,
      loadingCmt: false,
      cmtIdle: false,
      cmtStatus: '',
      replyTotal: 0,
      // 浮层 / 提示
      titleOpen: false,
      descOpen: false,
      detailOpen: false,
      tip: '',
      // 世代守卫: 页面级装载用 ++this.genSeq, 动作类请求只读当前值做过期判断
      genSeq: 0,
      coverOpen: false,
      coverUrl: '',
      paramKey: '',
      cmtGen: 0,
      tipTimer: null,
      busyLock: { like: false, coin: false, fav: false, follow: false }
    }
  },
  computed: {
    MIc() {
      return { close: this.U.dark ? MI.closeW : MI.closeD }
    },
    titleLines() { return this.titleOpen ? 0 : 2 },
    titleRowH() { return this.titleOpen ? 62 : 40 },
    descH() { return this.descOpen ? 64 : 58 },
    replyTotalText() { return this.replyTotal > 0 ? playCount(this.replyTotal) : '--' },
    fansLine() {
      const t = this.up.fansText
      return t === '' ? '粉丝 --' : (t + ' 粉丝')
    },
    followLabel() {
      return this.following ? '已关注' : '关注'
    },
    followStyle() {
      return {
        height: '30px',
        paddingLeft: '14px',
        paddingRight: '14px',
        borderRadius: this.U.rad.btn + 'px',
        backgroundColor: this.following ? this.U.c.surfaceContainerHighest : this.U.c.secondaryContainer
      }
    },
    followTextStyle() {
      return {
        fontSize: this.U.f.caption + 'px',
        color: this.following ? this.U.c.onSurfaceVariant : this.U.c.onSecondaryContainer
      }
    },
    actions() {
      // 顺序对齐 PiliNara action_item: 点赞 / 投币 / 收藏 / 转发
      return [
        { id: 'like', on: this.liked, text: playCount(this.cnt.like) },
        { id: 'coin', on: this.coined, text: playCount(this.cnt.coin) },
        { id: 'fav', on: this.faved, text: playCount(this.cnt.fav) },
        { id: 'share', on: false, text: playCount(this.cnt.share) }
      ]
    },
    playHitStyle() { return { width: '96px', height: '44px' } },
    playStyle() {
      return {
        width: '96px', height: '40px',
        borderRadius: this.U.rad.btn + 'px',
        backgroundColor: this.U.c.primary
      }
    },
    sheetStyle() {
      return {
        left: '12px', top: '46px', width: '936px', height: '212px',
        backgroundColor: this.U.c.surfaceContainerLow,
        borderRadius: this.U.rad.sheet + 'px'
      }
    }
  },
  mounted() {
    // ★ 参数统一走 readOptions(): mounted 在设备上不一定被调用
    this.readOptions()
  },
  methods: {
    // 框架只转发这两个生命周期
    onShow() {
      this.U = ui()
      this.readOptions()
    },
    /**
     * 读取页面参数并加载.
     * ★ 设备框架只转发 onShow, mounted 不保证触发 —— 参数必须两边都读,
     *   否则详情页永远"缺少视频参数". 幂等: 同一 bvid 只加载一次.
     */
    readOptions() {
      const o = (this.$page && this.$page.options) || {}
      const bvid = String(o.bvid || '')
      if (this.paramKey === bvid && this.paramKey !== '') return
      this.paramKey = bvid
      this.bvid = bvid
      if (!bvid) {
        this.status = '缺少视频参数'
        log('详情', '缺少 bvid 参数 (options=' + JSON.stringify(o) + ')')
        return
      }
      this.load()
    },
    onPageUnload() {
      this.genSeq++
      this.cmtGen++
      if (this.tipTimer != null) { clearTimeout(this.tipTimer); this.tipTimer = null }
    },

    // ---------------- 装载 ----------------
    async load() {
      const gen = ++this.genSeq
      log('详情', '开始加载 gen=' + gen)
      if (this.bvid === '') { this.titleText = '缺少视频参数'; return }
      try {
        const d = await videoDetail(this.bvid)
        if (gen !== this.genSeq) return
        this.aid = d.aid
        this.titleText = d.title
        this.descText = d.desc
        this.faceUrl = d.face
        this.coverUrl = d.pic || ''
        this.upName = d.author
        this.mid = d.mid
        this.pageRows = d.pages || []
        this.subRows = d.subtitles || []
        this.liked = !!d.liked
        this.coined = !!d.coined
        this.faved = !!d.faved
        this.cnt = {
          like: d.statRaw.like,
          coin: d.statRaw.coin,
          fav: d.statRaw.fav,
          share: d.statRaw.share
        }
        this.replyTotal = d.statRaw.reply
        this.metaLine = d.playText + ' 播放 · ' + d.danmakuText + ' 弹幕 · ' + d.replyText + ' 评论 · ' + d.pubText
        log('详情', '装载 ' + d.bvid + ' aid=' + d.aid + ' P' + (this.pageRows.length || 1))
        this.loadUp(gen)
        this.loadFolder(gen)
        if (getCfg('autoLoadComments') === false) this.cmtIdle = true
        else this.loadComments(true)
      } catch (e) {
        if (gen !== this.genSeq) return
        this.titleText = '加载失败'
        this.descText = (e && e.message ? e.message : String(e))
        log('详情', '加载失败: ' + this.descText)
      }
    },

    /** UP 主名片 (粉丝数 + 关注态) */
    async loadUp(gen) {
      if (!this.mid) return
      try {
        const u = await userCard(this.mid)
        if (gen !== this.genSeq) return
        this.up = { fansRaw: u.fansRaw, fansText: u.fansText }
        this.following = !!u.following
        if (u.name !== '') this.upName = u.name
        if (u.face !== '') this.faceUrl = u.face
      } catch (e) {
        if (gen !== this.genSeq) return
        log('详情', 'UP 名片失败: ' + (e && e.message ? e.message : e))
      }
    },

    /** 收藏夹 (判断是否已收藏 + 取消收藏时要用 media_id) */
    async loadFolder(gen) {
      if (!this.aid || !hasCookie()) return
      try {
        const list = await favFolders(this.aid)
        if (gen !== this.genSeq) return
        let def = 0
        for (let i = 0; i < list.length; i++) {
          if (def === 0) def = list[i].id
          if (list[i].favState === 1) { this.favFolderId = list[i].id; this.faved = true; return }
        }
        this.favFolderId = def
      } catch (e) {
        if (gen !== this.genSeq) return
        log('详情', '收藏夹失败: ' + (e && e.message ? e.message : e))
      }
    },

    // ---------------- 互动 (乐观更新 + 失败回滚) ----------------
    /** 评论滚动到底自动加载下一页 (上滑自动刷新) */
    onCmtScroll(e) {
      const bottom = (e && e.scrollBottom != null) ? Number(e.scrollBottom) : 0
      const left = (e && e.scrollHeight != null && e.scrollTop != null)
        ? Number(e.scrollHeight) - Number(e.scrollTop) : 9999
      const near = bottom > 0 ? bottom < 80 : left < 300
      if (near && this.hasMore && !this.loadingCmt && this.comments.length > 0) this.loadComments(false)
    },

    /** 评论点赞 / 取消 */
    async likeComment(c) {
      const want = !c.liked
      try {
        await commentLike(this.aid, c.rpid, want ? 1 : 0, 1)
        c.liked = want
        // 本地先动数字, 失败也不至于显示反了
        const n = Number(String(c.likeText).replace(/[^\d.]/g, '')) || 0
        c.likeText = n === 0 ? (want ? '1' : '') : String(want ? n + 1 : Math.max(0, n - 1))
        this.showTip(want ? '已点赞' : '已取消')
      } catch (e) {
        this.showTip(e && /登录/.test(e.message || '') ? '请先登录' : ('操作失败: ' + (e && e.message ? e.message : e)))
      }
    },

    /** 回复某条评论 (唤起系统输入法) */
    async replyComment(c) {
      const text = await this.askText('回复 @' + c.author)
      if (text == null || text === '') return
      try {
        await commentAdd(this.aid, text, c.rpid, c.rpid, 1)
        this.showTip('回复已发送')
        // 回复后展开该条的楼中楼并刷新
        c.subs = []
        c.subOpen = true
        await this.loadSub(c)
        this.replyTotal = this.replyTotal + 1
      } catch (e) {
        this.showTip(e && /登录/.test(e.message || '') ? '请先登录' : ('发送失败: ' + (e && e.message ? e.message : e)))
      }
    },

    /** 发表主楼评论 */
    async writeComment() {
      const text = await this.askText('写评论')
      if (text == null || text === '') return
      try {
        await commentAdd(this.aid, text, 0, 0, 1)
        this.showTip('评论已发送')
        await this.loadComments(true)
      } catch (e) {
        this.showTip(e && /登录/.test(e.message || '') ? '请先登录' : ('发送失败: ' + (e && e.message ? e.message : e)))
      }
    },

    /** 统一走系统输入法取一段文本; 取消返回 null */
    async askText(placeholder) {
      if (!this.imeSession) this.imeSession = createIME()
      try {
        const t = await this.imeSession.open({ text: '', placeholder: placeholder || '说点什么', maxlength: 500, enterButtonText: '发送' })
        return t
      } catch (e) {
        this.showTip('系统输入法唤不起来')
        return null
      }
    },

    /** 展开 / 收起楼中楼 */
    async toggleSub(c) {
      if (c.subOpen) { c.subOpen = false; return }
      c.subOpen = true
      if (c.subs && c.subs.length) return
      await this.loadSub(c)
    },
    async loadSub(c) {
      c.subLoading = true
      try {
        const r = await subReplies(this.aid, c.rpid, 1, 1)
        c.subs = r.list || []
      } catch (e) {
        c.subs = []
      } finally {
        c.subLoading = false
      }
    },

    onAction(id) {
      if (id === 'like') this.doLike()
      else if (id === 'coin') this.doCoin()
      else if (id === 'fav') this.doFav()
      // share: 只显示数量, 不做分享 (用户约束), 不挂动作
    },

    async doLike() {
      if (this.busyLock.like || !this.aid) return
      if (!hasCookie()) { this.showTip('请先登录再点赞'); return }
      this.busyLock.like = true
      const gen = this.genSeq
      const was = this.liked
      const prev = this.cnt.like
      this.liked = !was
      this.cnt.like = Math.max(0, prev + (this.liked ? 1 : -1))
      try {
        const r = await like(this.aid, this.liked)
        if (gen !== this.genSeq) return
        // 接口的 action 字段是权威状态 (1 已赞 / 0 未赞), 有就按它收敛
        const act = (r && r.data && r.data.action != null) ? Number(r.data.action) : null
        if (act !== null) {
          const now = act === 1
          this.cnt.like = Math.max(0, prev + (now ? 1 : 0) - (was ? 1 : 0))
          this.liked = now
        }
      } catch (e) {
        if (gen !== this.genSeq) return
        this.liked = was
        this.cnt.like = prev
        this.showTip(e && e.message ? e.message : '点赞失败')
      } finally {
        if (gen === this.genSeq) this.busyLock.like = false
      }
    },

    async doCoin() {
      if (this.busyLock.coin || !this.aid) return
      if (!hasCookie()) { this.showTip('请先登录再投币'); return }
      if (this.coined) { this.showTip('已投过币'); return }
      this.busyLock.coin = true
      const gen = this.genSeq
      const prev = this.cnt.coin
      this.coined = true
      this.cnt.coin = prev + 1
      try {
        await coin(this.aid, 1, false)
        if (gen !== this.genSeq) return
      } catch (e) {
        if (gen !== this.genSeq) return
        this.coined = false
        this.cnt.coin = prev
        this.showTip(e && e.message ? e.message : '投币失败')
      } finally {
        if (gen === this.genSeq) this.busyLock.coin = false
      }
    },

    async doFav() {
      if (this.busyLock.fav || !this.aid) return
      if (!hasCookie()) { this.showTip('请先登录再收藏'); return }
      if (!this.favFolderId) { this.showTip('没有可用收藏夹'); return }
      this.busyLock.fav = true
      const gen = this.genSeq
      const was = this.faved
      const prev = this.cnt.fav
      const fid = this.favFolderId
      this.faved = !was
      this.cnt.fav = Math.max(0, prev + (this.faved ? 1 : -1))
      try {
        if (was) await fav(this.aid, '', fid)
        else await fav(this.aid, fid, '')
        if (gen !== this.genSeq) return
      } catch (e) {
        if (gen !== this.genSeq) return
        this.faved = was
        this.cnt.fav = prev
        this.showTip(e && e.message ? e.message : '收藏失败')
      } finally {
        if (gen === this.genSeq) this.busyLock.fav = false
      }
    },

    async toggleFollow() {
      if (this.busyLock.follow || !this.mid) return
      if (!hasCookie()) { this.showTip('请先登录再关注'); return }
      this.busyLock.follow = true
      const gen = this.genSeq
      const was = this.following
      const prevFans = this.up.fansRaw
      this.following = !was
      this.up.fansRaw = Math.max(0, prevFans + (this.following ? 1 : -1))
      this.up.fansText = playCount(this.up.fansRaw)
      try {
        await relationModify(this.mid, this.following ? 1 : 2)
        if (gen !== this.genSeq) return
        log('详情', (this.following ? '关注' : '取关') + ' mid=' + this.mid)
      } catch (e) {
        if (gen !== this.genSeq) return
        this.following = was
        this.up.fansRaw = prevFans
        this.up.fansText = playCount(prevFans)
        this.showTip(e && e.message ? e.message : '关注失败')
      } finally {
        if (gen === this.genSeq) this.busyLock.follow = false
      }
    },

    // ---------------- 评论 ----------------
    startComments() {
      this.cmtIdle = false
      this.loadComments(true)
    },
    pickSort(id) {
      if (this.sort === id) { this.loadComments(true); return }
      this.sort = id
      this.comments = []
      this.loadComments(true)
    },
    async loadComments(reset) {
      if (!this.aid) return
      if (this.loadingCmt && !reset) return
      const gen = ++this.cmtGen
      this.loadingCmt = true
      if (reset) { this.page = 1; this.hasMore = true; this.cmtStatus = '' }
      try {
        const r = await replies(this.aid, this.page, this.sort, 1)
        if (gen !== this.cmtGen) return
        const list = (r.list || []).map(prepReply)
        this.comments = reset ? list : this.comments.concat(list)
        if (r.total > 0) this.replyTotal = r.total
        this.hasMore = list.length > 0
        if (!this.hasMore && this.comments.length === 0) this.cmtStatus = '还没有评论'
        log('详情', '评论 ' + this.comments.length + '/' + r.total + ' (' + this.sort + ' p' + this.page + ')')
      } catch (e) {
        if (gen !== this.cmtGen) return
        this.cmtStatus = (e && e.message ? e.message : String(e))
        log('详情', '评论失败: ' + this.cmtStatus)
      } finally {
        if (gen === this.cmtGen) this.loadingCmt = false
      }
    },
    onScroll(e) {
      const d = e && e.detail ? e.detail : {}
      if (d && d.scrollBottom != null && d.scrollBottom < 80 && this.hasMore && !this.loadingCmt && !this.cmtIdle) {
        this.page++
        this.loadComments(false)
      }
    },

    // ---------------- 样式工厂 ----------------
    iconOf(a) {
      if (a.id === 'share') return MI.share
      return a.on ? MI[a.id + 'On'] : MI[a.id]
    },
    actStyle(a) {
      const s = {
        width: '72px',
        height: '48px',
        borderRadius: this.U.rad.card + 'px'
      }
      // 常态透明 (对齐 PiliNara ActionItem 的 Material type: transparency), 选中才给浅底
      if (a.on) s.backgroundColor = this.U.c.surfaceContainerHighest
      return s
    },
    actTextStyle(a) {
      const on = a.id !== 'share' && a.on
      return {
        fontSize: this.U.f.tiny + 'px',
        color: on ? this.U.c.primary : this.U.c.onSurfaceVariant
      }
    },
    sortStyle(id) {
      const on = this.sort === id
      return {
        width: '76px',
        height: '30px',
        borderRadius: this.U.rad.chip + 'px',
        backgroundColor: on ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest
      }
    },
    sortTextStyle(id) {
      return {
        fontSize: this.U.f.caption + 'px',
        color: this.sort === id ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    },
    pageRowText(p) {
      return 'P' + p.page + '  ' + p.part + '  ·  ' + p.durationText
    },
    subRowText(s) {
      return (s.lanDoc || s.lan || '字幕') + (s.ai ? ' (自动)' : '')
    },

    // ---------------- 跳转 / 提示 ----------------
    goBack() {
      try { this.$page.finish() } catch (e) { try { $falcon.navTo('index', {}) } catch (e2) {} }
    },
    goPlay() {
      if (!this.bvid) { this.showTip('缺少视频号'); return }
      try { $falcon.navTo('play', { bvid: this.bvid, title: this.titleText }) } catch (e) {}
    },
    openBv(bvid) {
      if (!bvid) return
      try { $falcon.navTo('video', { bvid: bvid }) } catch (e) {}
    },
    toggleTitle() { this.titleOpen = !this.titleOpen },
    toggleDesc() { this.descOpen = !this.descOpen },
    onBarAction(a) {
      if (a === 'cover') { this.showCover(); return }
      this.openDetail()
    },

    hideCover() { this.coverOpen = false },

    /** 显示封面浮层 (原图, 等比缩放) */
    showCover() {
      if (!this.coverUrl) { this.showTip('还没有封面'); return }
      this.coverOpen = true
    },

    /** 进入 UP 主主页 */
    openMember() {
      if (!this.mid) { this.showTip('未取到 UP 主 mid'); return }
      try { $falcon.navTo('member', { mid: this.mid, name: this.upName }) } catch (e) {}
    },

    openDetail() { this.detailOpen = true },
    closeDetail() { this.detailOpen = false },
    showTip(msg) {
      this.tip = String(msg || '').substring(0, 40)
      if (this.tipTimer != null) clearTimeout(this.tipTimer)
      const self = this
      this.tipTimer = setTimeout(function () {
        self.tipTimer = null
        self.tip = ''
      }, 1800)
    },
    hideTip() {
      this.tip = ''
      if (this.tipTimer != null) { clearTimeout(this.tipTimer); this.tipTimer = null }
    }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
.content { width: 960px; flex-direction: row; }

/* ---- 信息区 ---- */
.info { flex-direction: row; width: 936px; margin-left: 12px; }
.ileft { flex: 1; flex-direction: column; padding-top: 4px; }
.uprow { flex-direction: row; align-items: center; }
.avwrap { justify-content: center; align-items: center; }
.avatar { }
.ph { }
.upmeta { flex: 1; flex-direction: column; justify-content: center; padding-left: 8px; }
.upname { }
.upfans { margin-top: 2px; }
.followHit { justify-content: center; align-items: center; }
.follow { justify-content: center; align-items: center; }
.followt { }
.titlerow { flex-direction: row; align-items: center; justify-content: center; }
.title { flex: 1; }
.chev { margin-left: 6px; }
.metarow { flex-direction: row; align-items: center; }
.meta { flex: 1; }

/* ---- 右块: 操作栏 + 简介 ---- */
.iright { width: 330px; flex-direction: column; padding-top: 4px; }
.acts { flex-direction: row; align-items: center; }
.act { justify-content: center; align-items: center; margin-right: 4px; }
.actic { }
.actt { margin-top: 2px; }
.descHit { padding-left: 4px; padding-top: 4px; }
.descScroll { width: 100%; height: 100%; }
.desc { }

/* ---- 评论区 ---- */
.cmts { flex-direction: row; width: 439px; }
.sortcol { flex-direction: column; padding-left: 10px; padding-top: 6px; }
.sortTitle { width: 92px; height: 18px; padding-left: 8px; }
.sortHit { justify-content: center; align-items: center; }
.sort { justify-content: center; align-items: center; }
.sortt { }
.cHint { }
.cHintHit { justify-content: center; align-items: center; }
.crow { flex-direction: row; padding-top: 6px; padding-bottom: 6px; }
.cav { margin-right: 8px; margin-top: 2px; }
.ph { }
.cbody { flex: 1; flex-direction: column; }
.chead { flex-direction: row; align-items: center; }
.cname { }
.ctime { margin-left: 8px; }
.clike { margin-left: 8px; }
.ctext { margin-top: 2px; }
.cids { flex-direction: row; align-items: center; margin-top: 2px; }
.cidHit { justify-content: center; align-items: center; margin-right: 8px; }
.cid { height: 26px; justify-content: center; align-items: center; padding-left: 10px; padding-right: 10px; }
.cidt { }
.cfoot { width: 100%; justify-content: center; align-items: center; padding-top: 4px; padding-bottom: 8px; }

/* ---- 底部播放按钮 ---- */
.playHit { position: absolute; right: 12px; bottom: 6px; justify-content: center; align-items: center; }
.play { flex-direction: row; justify-content: center; align-items: center; }
.plic { margin-right: 6px; }
.plt { }

/* ---- 详情浮层 ---- */
.sheet { position: absolute; flex-direction: column; overflow: hidden; }
.sheetHead { flex-direction: row; align-items: center; padding-left: 14px; }
.sheetT { flex: 1; }
.sheetClose { justify-content: center; align-items: center; }
.sheetBody { width: 100%; padding-left: 14px; padding-right: 14px; }
.sTitle { margin-top: 4px; }
.sMeta { margin-top: 6px; }
.sDesc { margin-top: 8px; }
.sSec { margin-top: 12px; flex-direction: column; }
.sSecT { }
.sRow { margin-top: 4px; }
.sRowT { }

/* ---- 轻提示 ---- */
.tipHit { position: absolute; left: 12px; bottom: 8px; justify-content: center; align-items: center; }
.tip { height: 34px; justify-content: center; align-items: center; padding-left: 14px; padding-right: 14px; }
.tipt { }
.pane { flex-direction: column; padding-left: 12px; padding-right: 10px; }
.vsep { width: 1px; }
.sortbtn { height: 34px; justify-content: center; align-items: center; border-radius: 8px; }
.cscroll { width: 347px; height: 222px; }
.clist { flex-direction: column; padding-right: 10px; }
.chint { height: 90px; justify-content: center; align-items: center; }
.chintt { font-size: 13px; }
.cmore { height: 36px; padding-left: 16px; padding-right: 16px; justify-content: center; align-items: center; }
.cmoret { font-size: 13px; }
/* 封面浮层: 等比缩放显示原图 (不裁剪), 点任意处关闭 */
.coverMask { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px;
             background-color: rgba(0,0,0,0.86); justify-content: center; align-items: center; }
.coverBig { width: 900px; height: 236px; }
.coverTip { position: absolute; bottom: 6px; left: 0px; width: 960px; text-align: center;
            font-size: 12px; color: #ffffff; }
.pane { position: relative; }
.playHit { position: absolute; right: 14px; bottom: 10px; }
.play { flex-direction: row; justify-content: center; align-items: center; }
.playt { font-size: 15px; font-weight: bold; }
.cops { flex-direction: row; align-items: center; margin-top: 2px; }
.cop { flex-direction: row; align-items: center; margin-right: 14px; padding-left: 2px; padding-right: 2px; }
.copic { width: 15px; height: 15px; margin-right: 3px; }
.copt { font-size: 11px; }
.subs { flex-direction: column; margin-top: 4px; padding: 6px; }
.subhint { height: 22px; justify-content: center; align-items: center; }
.subhintt { font-size: 11px; }
.subrow { flex-direction: column; margin-bottom: 4px; }
.subn { font-size: 11px; }
.subt { font-size: 11px; }
.cwrite { flex-direction: row; justify-content: center; align-items: center; padding-top: 6px; padding-bottom: 6px; }
.cwbtn { padding-left: 18px; padding-right: 18px; justify-content: center; align-items: center; }
.cwbtnt { font-size: 13px; }
</style>
