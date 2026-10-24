<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: PiliNara 视频页的 AppBar 语义 (elevation 0 / 标题 16 / 返回在左) -->
    <AppBar title="视频详情" :back="true" :actions="['more']"
            @back="goBack" @action="openDetail"></AppBar>

    <div class="content" :style="{ height: S.content + 'px' }">
      <!-- ===== 信息区 (约 118px): 左块 = UP + 标题 + 数据, 右块 = 操作栏 + 简介 ===== -->
      <div class="info" :style="{ height: INFO_H + 'px' }">
        <div class="ileft">
          <!-- UP 主行: 头像 + 昵称 + 粉丝数 + 关注按钮 (x/relation/modify) -->
          <div class="uprow" :style="{ height: '44px' }">
            <div class="avwrap" :style="{ width: '44px', height: '44px' }">
              <image v-if="faceUrl !== ''" class="avatar" :src="faceUrl"
                     :style="{ width: '32px', height: '32px', borderRadius: '16px' }"></image>
              <div v-else class="avatar ph" :style="{ width: '32px', height: '32px', borderRadius: '16px', backgroundColor: U.c.surfaceContainerHighest }"></div>
            </div>
            <div class="upmeta">
              <text class="upname" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface }">{{ upName }}</text>
              <text class="upfans" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ fansLine }}</text>
            </div>
            <div class="followHit" :style="{ width: '84px', height: '44px' }" @click="toggleFollow">
              <div class="follow" :style="followStyle">
                <text class="followt" :lines="1" :style="followTextStyle">{{ followLabel }}</text>
              </div>
            </div>
          </div>

          <!-- 标题: 2 行折叠, 点击就地展开 (展开时收起数据行, 用 118px 里的 68px 显示全文) -->
          <div class="titlerow" :style="{ height: titleRowH + 'px' }" @click="toggleTitle">
            <text class="title" :lines="titleLines" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface }">{{ titleText }}</text>
            <image class="chev" :src="MI.chevron" :style="{ width: '16px', height: '16px' }"></image>
          </div>

          <!-- 播放量 / 弹幕数 / 发布时间 -->
          <div v-if="!titleOpen" class="metarow" :style="{ height: '22px' }">
            <text class="meta" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ metaLine }}</text>
          </div>
        </div>

        <div class="iright">
          <!-- 操作栏: 顺序照 PiliNara action_item (点赞 / 投币 / 收藏 / 转发)
               选中态用 _p 版图标; 转发只显示数量, 不做分享 (用户约束) -->
          <div class="acts" :style="{ height: '48px' }">
            <div v-for="a in actions" :key="a.id" class="act" :style="actStyle(a)" @click="onAction(a.id)">
              <image class="actic" :src="iconOf(a)" :style="{ width: '22px', height: '22px' }"></image>
              <text class="actt" :lines="1" :style="actTextStyle(a)">{{ a.text }}</text>
            </div>
          </div>

          <!-- 简介: 3 行折叠, 点击就地展开 (展开态用定高 scroller 承载, 不挤压评论区) -->
          <div class="descHit" :style="{ height: descH + 'px' }" @click="toggleDesc">
            <scroller v-if="descOpen" class="descScroll" scroll-direction="vertical" :show-scrollbar="true"
                      :style="{ height: (descH - 6) + 'px' }">
              <text class="desc" :lines="0" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ descText }}</text>
            </scroller>
            <text v-else class="desc" :lines="3" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ descText }}</text>
          </div>
        </div>
      </div>

      <!-- ===== 评论区 (剩余 104px): 左侧排序 (热度/时间) + 右侧评论滚动区 ===== -->
      <div class="cmts" :style="{ height: CMT_H + 'px' }">
        <div class="sortcol" :style="{ width: '92px' }">
          <text class="sortTitle" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ '评论 ' + replyTotalText }}</text>
          <div v-for="s in sorts" :key="s.id" class="sortHit" :style="{ width: '92px', height: '44px' }" @click="pickSort(s.id)">
            <div class="sort" :style="sortStyle(s.id)">
              <text class="sortt" :lines="1" :style="sortTextStyle(s.id)">{{ s.label }}</text>
            </div>
          </div>
        </div>

        <scroller class="clist" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
          <div v-if="cmtIdle" class="cHintHit" :style="{ height: '44px' }" @click="startComments">
            <text class="cHint" :style="U.t.weak">点此加载评论</text>
          </div>
          <div v-else-if="loadingCmt && comments.length === 0" class="cHint">
            <text class="cHint" :style="U.t.weak">评论加载中…</text>
          </div>
          <div v-else-if="comments.length === 0" class="cHint">
            <text class="cHint" :style="U.t.weak">{{ cmtStatus || '还没有评论' }}</text>
          </div>
          <div v-for="(c, i) in comments" :key="c.rpid + '_' + i" class="crow">
            <image v-if="c.face !== ''" class="cav" :src="c.face"
                   :style="{ width: '26px', height: '26px', borderRadius: '13px' }"></image>
            <div v-else class="cav ph" :style="{ width: '26px', height: '26px', borderRadius: '13px', backgroundColor: U.c.surfaceContainerHighest }"></div>
            <div class="cbody">
              <div class="chead" :style="{ height: '18px' }">
                <text class="cname" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ c.author }}</text>
                <text v-if="c.timeText !== ''" class="ctime" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ c.timeText }}</text>
                <text v-if="c.likeText !== '0'" class="clike" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ '赞 ' + c.likeText }}</text>
              </div>
              <text class="ctext" :lines="2" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurface }">{{ c.text }}</text>
              <!-- 视频号快捷栏: 笔上 richtext 内部元素不触发点击, 所以号单独成排 (数据来自 splitByVideoIds) -->
              <div v-if="c.vids.length > 0" class="cids">
                <div v-for="v in c.vids" :key="v" class="cidHit" :style="{ height: '44px' }" @click="openBv(v)">
                  <div class="cid" :style="{ backgroundColor: U.c.primaryContainer, borderRadius: U.rad.chip + 'px' }">
                    <text class="cidt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onPrimaryContainer }">{{ v }}</text>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="comments.length > 0" class="cfoot">
            <text class="cHint" :style="U.t.tiny">{{ loadingCmt ? '加载中…' : (hasMore ? '上滑加载更多' : '没有更多了') }}</text>
          </div>
        </scroller>
      </div>
    </div>

    <!-- 播放按钮 (底部) -> 播放器页 -->
    <div class="playHit" :style="playHitStyle" @click="goPlay">
      <div class="play" :style="playStyle">
        <image class="plic" :src="MI.play" :style="{ width: '20px', height: '20px' }"></image>
        <text class="plt" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">播放</text>
      </div>
    </div>

    <!-- 详情浮层: 标题/简介的展开态 (完整标题 + 全文简介 + 分P + 字幕轨) -->
    <div v-if="detailOpen" class="sheet" :style="sheetStyle">
      <div class="sheetHead" :style="{ height: '44px' }">
        <text class="sheetT" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface }">视频信息</text>
        <div class="sheetClose" :style="{ width: '44px', height: '44px' }" @click="closeDetail">
          <image :src="MIc.close" :style="{ width: '22px', height: '22px' }"></image>
        </div>
      </div>
      <scroller class="sheetBody" scroll-direction="vertical" :show-scrollbar="true">
        <text class="sTitle" :lines="0" :style="{ fontSize: U.f.title + 'px', color: U.c.onSurface }">{{ titleText }}</text>
        <text class="sMeta" :lines="0" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ metaLine }}</text>
        <text class="sDesc" :lines="0" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurfaceVariant }">{{ descText }}</text>
        <div v-if="pageRows.length > 0" class="sSec">
          <text class="sSecT" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.primary }">{{ '分P (' + pageRows.length + ')' }}</text>
          <div v-for="p in pageRows" :key="p.cid" class="sRow">
            <text class="sRowT" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ pageRowText(p) }}</text>
          </div>
        </div>
        <div v-if="subRows.length > 0" class="sSec">
          <text class="sSecT" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.primary }">{{ '字幕轨 (' + subRows.length + ')' }}</text>
          <div v-for="s in subRows" :key="s.id" class="sRow">
            <text class="sRowT" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ subRowText(s) }}</text>
          </div>
        </div>
      </scroller>
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
import { ui } from '../../design/ui.js'
import { SCREEN } from '../../design/tokens.js'
import { videoDetail, userCard, relationModify, favFolders, fav, like, coin, replies } from '../../services/api.js'
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
const INFO_H = 118
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
  components: { AppBar },
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
    titleRowH() { return this.titleOpen ? 68 : 44 },
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
    const o = (this.$page && this.$page.options) || {}
    this.bvid = String(o.bvid || '')
    this.load()
  },
  methods: {
    // 框架只转发这两个生命周期
    onShow() { this.U = ui() },
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
      try { $falcon.navTo('play', { bvid: bvid }) } catch (e) {}
    },
    toggleTitle() { this.titleOpen = !this.titleOpen },
    toggleDesc() { this.descOpen = !this.descOpen },
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
.content { width: 960px; }

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
.cmts { flex-direction: row; width: 936px; margin-left: 12px; }
.sortcol { flex-direction: column; justify-content: center; }
.sortTitle { width: 92px; height: 18px; padding-left: 8px; }
.sortHit { justify-content: center; align-items: center; }
.sort { justify-content: center; align-items: center; }
.sortt { }
.clist { flex: 1; margin-left: 8px; margin-right: 118px; }
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
</style>
