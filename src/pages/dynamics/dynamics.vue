<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: 返回 + 标题. 动态流不需要搜索框, 44px 顶栏之外全部留给列表 -->
    <AppBar :title="'动态'" :back="true" @back="onBack"></AppBar>

    <!-- 内容区只有 222px: 加载态 / 错误态 / 空态都塞进同一个滚动区,
         页面骨架永远是"顶栏 + 一个滚动区", 状态切换时不会出现高度跳动 -->
    <scroller class="body" scroll-direction="vertical" :show-scrollbar="true" @scroll="onScroll">
      <div v-if="loading && items.length === 0" class="hint">
        <text class="hintt" :lines="1" :style="U.t.weak">加载中…</text>
      </div>

      <!-- dynamicFeed 未登录会抛错 (Web 接口要 SESSDATA), 这里同时给"去登录"和"重试":
           前者是没登录时的正解, 后者是网络抖动时的正解, 不判断具体原因就都留着 -->
      <div v-else-if="error !== ''" class="hint">
        <text class="hintt" :lines="2" :style="U.t.weak">{{ error }}</text>
        <div class="hbtns">
          <div class="actbtn" :style="primaryBtn" @click="goLogin">
            <text class="actbtnt" :lines="1" :style="primaryBtnText">去登录</text>
          </div>
          <div class="actbtn" :style="ghostBtn" @click="reload">
            <text class="actbtnt" :lines="1" :style="ghostBtnText">重试</text>
          </div>
        </div>
      </div>

      <div v-else-if="items.length === 0" class="hint">
        <text class="hintt" :lines="1" :style="U.t.weak">暂无动态</text>
      </div>

      <div v-else class="list">
        <!-- 一条动态 = 一张横向卡片: 左头像 + 中间文字列 + 右侧媒体列.
             媒体放右边而不是正文下方, 是因为纵向只有 222px:
             视频卡压到正文下面的话单条就 150px 高, 一屏连一条半都看不全 -->
        <div v-for="(it, i) in items" :key="it.id + '_' + i" class="row"
             :style="{ height: rowH(it) + 'px', backgroundColor: U.c.surfaceContainerLow, borderRadius: U.rad.card + 'px' }">
          <!-- 头像: 没头像时留一个同尺寸占位圆, 否则整行会往左缩 -->
          <div class="av" :style="{ backgroundColor: U.c.surfaceContainerHighest }">
            <image v-if="it.face !== ''" class="avimg" :src="it.face" resize="cover"></image>
          </div>

          <div class="main">
            <div class="head" :style="{ height: headH + 'px' }">
              <RichText class="name" :text="it.author" :size="U.f.subtitle" :color="U.c.onSurface" :lines="1" :style="{ flex: 1 }" :drop-emoji="false" />
              <text class="time" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ it.timeText }}</text>
            </div>

            <RichText v-if="it.text !== ''" class="text" :text="it.text" :size="U.f.body" :color="U.c.onSurface" :lines="2" :drop-emoji="false" />

            <!-- 转发: 浅色块里"转发自 @作者" + 原文 1 行, 颜色降一级表示不是本人的话 -->
            <div v-if="it.repost" class="repost" :style="{ backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.card + 'px' }">
              <RichText class="rlabel" :text="repostLabel(it.repost)" :size="U.f.caption" :color="U.c.primary" :lines="1" :drop-emoji="false" />
              <RichText v-if="it.repost.text !== ''" class="rtext" :text="it.repost.text" :size="U.f.caption" :color="U.c.onSurfaceVariant" :lines="1" :drop-emoji="false" />
            </div>

            <!-- 专栏条: 整条 44px 高, 满足触摸命中区下限 (笔屏上 24px 的条目经常点不中) -->
            <div v-if="it.article && it.article.id" class="art" :style="{ backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.chip + 'px' }" @click="openArticle(it.article)">
              <RichText class="artt" :text="articleLabel(it.article)" :size="U.f.caption" :color="U.c.onSurface" :lines="1" :drop-emoji="false" />
            </div>
          </div>

          <!-- 媒体列: 有视频就只放视频卡, 否则铺最多 3 张缩略图 (两个都放会挤掉正文) -->
          <div v-if="it.video" class="vcard" :style="videoBox" @click="openVideo(it.video)">
            <div class="vcover" :style="{ backgroundColor: U.c.surfaceContainerHighest }">
              <image v-if="it.video.cover !== ''" class="vcoverimg" :src="it.video.cover" resize="cover"></image>
            </div>
            <div class="vinfo">
              <RichText class="vtitle" :text="it.video.title" :size="U.f.caption" :color="U.c.onSurface" :lines="2" :drop-emoji="false" />
              <text class="vmeta" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ videoMeta(it.video) }}</text>
            </div>
          </div>
          <div v-else-if="hasPics(it)" class="pics" :style="picsBox">
            <div v-for="(p, pi) in threePics(it)" :key="pi" class="pic" :style="picBox">
              <image v-if="p !== ''" class="picimg" :src="p" resize="cover"></image>
            </div>
          </div>
        </div>

        <!-- 底部: 还有下一页给按钮, 到底了给一句文字 (点不动的死按钮比没有更糟) -->
        <div class="foot">
          <div v-if="hasMore || loading" class="more" :style="moreBox" @click="loadMore">
            <text class="moret" :lines="1" :style="moreTextStyle">{{ moreText }}</text>
          </div>
          <text v-else class="endt" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">没有更多了</text>
        </div>
      </div>
    </scroller>
  </div>
</template>

<script>
import RichText from '../../components/rich-text.vue'
// 动态流 —— 对应 PiliNara lib/pages/dynamics (关注/推荐动态)
// 数据走 services/api.js 的 dynamicFeed(offset): { items, offset, hasMore }
// 笔屏约束带来的三个取舍:
//   1. 媒体 (视频卡 / 图片) 放在正文右侧而不是下方, 单条压到 78~126px, 一屏能看 2~3 条
//   2. 所有用户内容 (作者名/正文/转发原文/标题) 一律走 RichText, 否则 emoji 变豆腐块
//   3. 卡片高度按内容算出来 (rowH), 不写死: 字号档位变了也不会把正文裁掉
import AppBar from '../../components/app-bar.vue'
import { ui } from '../../design/ui.js'
import { dynamicFeed } from '../../services/api.js'
import { log } from '../../core/log.js'

const PAD = 8                              // 卡片四周内边距
const AV = 40                              // 头像直径
const VCARD_W = 320                        // 视频小卡宽 = 120 封面 + 右侧文字
const VCARD_H = 75                         // 视频小卡高 = 封面 120x75 (与 .vcover 保持一致)
const PIC = 60                             // 图片缩略图边长
const PIC_GAP = 6                          // 缩略图间距
const PICS_W = PIC * 3 + PIC_GAP * 3       // 三张缩略图 + 三个间距 = 198
const ART_H = 44                           // 专栏条高 (与 .art 保持一致, 44 = 触摸下限)
const PAD_TOP = 4                          // 正文/转发块/专栏条之间的竖向间距

export default {
  components: { AppBar, RichText },
  name: 'dynamics',
  data() {
    return {
      U: ui(),
      items: [],
      offset: '',
      hasMore: false,
      loading: false,
      error: '',
      status: '',           // 翻页失败时的短提示 (显示在"加载更多"按钮里)
      genSeq: 0             // 世代号: 丢弃过期响应, 防止翻页乱序把旧数据拼到新列表后面
    }
  },
  computed: {
    // RichText 内部行高 = round(size * 1.45), 这里必须用同一个公式算行高, 否则卡片会裁字
    bodyLine() { return Math.round(this.U.f.body * 1.45) },
    capLine() { return Math.round(this.U.f.caption * 1.45) },
    headH() { return Math.round(this.U.f.subtitle * 1.45) },
    repostH() { return 10 + this.capLine * 2 },
    moreText() {
      if (this.loading) return '加载中…'
      if (this.status !== '') return this.status
      return '加载更多'
    },
    videoBox() {
      return {
        width: VCARD_W + 'px',
        height: VCARD_H + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.card + 'px'
      }
    },
    picsBox() {
      return { width: PICS_W + 'px', height: PIC + 'px' }
    },
    picBox() {
      return {
        width: PIC + 'px',
        height: PIC + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.card + 'px'
      }
    },
    primaryBtn() {
      return {
        height: '44px',
        paddingLeft: '22px',
        paddingRight: '22px',
        backgroundColor: this.U.c.primary,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    primaryBtnText() {
      return { fontSize: this.U.f.body + 'px', color: this.U.c.onPrimary }
    },
    ghostBtn() {
      return {
        height: '44px',
        paddingLeft: '22px',
        paddingRight: '22px',
        marginLeft: '12px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    ghostBtnText() {
      return { fontSize: this.U.f.body + 'px', color: this.U.c.onSurface }
    },
    moreBox() {
      return {
        height: '44px',
        paddingLeft: '24px',
        paddingRight: '24px',
        backgroundColor: this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.btn + 'px'
      }
    },
    moreTextStyle() {
      return { fontSize: this.U.f.caption + 'px', color: this.U.c.onSurfaceVariant }
    }
  },
  mounted() {
    // 私有标记不进 data: Vue2 不代理 _ 开头的键, 这里显式初始化只是为了读起来明确
    this._unloaded = false
    this.load(true)
  },
  methods: {
    // 框架只转发 onShow / onPageUnload 两个生命周期
    onShow() {
      this.U = ui()
      // 从登录页返回时, 之前是失败态就自动重试一次, 省掉用户再点一下"重试"
      if (!this.loading && this.items.length === 0 && this.error !== '') this.load(true)
    },
    onPageUnload() {
      this._unloaded = true
      this.genSeq++
    },

    onBack() {
      try { this.$page.finish() } catch (e) {
        try { $falcon.navTo('index') } catch (e2) {}
      }
    },

    // ---------------- 数据 ----------------
    async load(reset) {
      if (this._unloaded) return
      const gen = ++this.genSeq
      if (reset) { this.error = ''; this.status = '' }
      this.loading = true
      try {
        const r = await dynamicFeed(reset ? '' : this.offset)
        if (gen !== this.genSeq) return
        const list = (r && r.items) || []
        this.items = reset ? list : this.items.concat(list)
        this.offset = (r && r.offset) || ''
        // offset 为空时即使 has_more 也不能继续翻页, 否则会拿同一个 offset 原地死循环
        this.hasMore = !!(r && r.hasMore) && this.offset !== ''
        log('动态', (reset ? '首屏' : '下一页') + ' ' + list.length + ' 条, 累计 ' + this.items.length)
      } catch (e) {
        if (gen !== this.genSeq) return
        const msg = e && e.message ? e.message : String(e)
        if (reset || this.items.length === 0) this.error = msg
        else this.status = '加载失败, 点此重试'
        log('动态', '加载失败: ' + msg)
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    },

    loadMore() {
      if (this.loading || !this.hasMore) return
      this.load(false)
    },

    reload() {
      if (this.loading) return
      this.items = []
      this.offset = ''
      this.hasMore = false
      this.status = ''
      this.error = ''
      this.load(true)
    },

    // 滚到底部前 80px 就预取: 222px 高的屏幕等真的到底再拉, 用户会先看到一片空白
    onScroll(e) {
      const d = (e && e.detail) ? e.detail : {}
      if (d.scrollBottom != null && d.scrollBottom < 80 && this.items.length > 0 && this.hasMore && !this.loading) {
        this.load(false)
      }
    },

    // ---------------- 跳转 ----------------
    goLogin() { try { $falcon.navTo('login') } catch (e) {} },

    openVideo(v) {
      if (!v || !v.bvid) return
      try { $falcon.navTo('play', { bvid: v.bvid, title: v.title }) } catch (e) {}
    },

    openArticle(a) {
      if (!a || !a.id) return
      try { $falcon.navTo('article', { cv: a.id }) } catch (e) {}
    },

    // ---------------- 行高与文案 ----------------
    // 卡片高度 = 内边距 + max(文字列, 媒体列, 头像). 文字列按"作者行 + 正文 2 行 + 可选块"累加.
    rowH(it) {
      let textCol = this.headH
      if (it.text !== '') textCol += PAD_TOP + this.bodyLine * 2
      if (it.repost) textCol += PAD_TOP + this.repostH
      if (it.article && it.article.id) textCol += PAD_TOP + ART_H
      const media = it.video ? VCARD_H : (this.hasPics(it) ? PIC : 0)
      return PAD * 2 + Math.max(textCol, media, AV)
    },

    hasPics(it) { return !!(it.pics && it.pics.length > 0) },
    threePics(it) { return (it.pics || []).slice(0, 3) },

    repostLabel(r) {
      const name = (r && r.author) || ''
      return name === '' ? '转发' : ('转发自 @' + name)
    },

    articleLabel(a) {
      const t = (a && a.title) || ''
      return t === '' ? '专栏' : ('专栏 · ' + t)
    },

    videoMeta(v) {
      const parts = []
      if (v && v.playText) parts.push(v.playText + '播放')
      if (v && v.durationText) parts.push(v.durationText)
      return parts.join(' · ')
    }
  }
}
</script>

<style scoped>
/* 页面根: 960x266 绝对定位, 竖向排列 (顶栏 44 + 滚动区 222) */
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
.body { flex: 1; width: 100%; }

/* 状态区 (加载/错误/空): 高度撑满一屏, 内容垂直居中 */
.hint { width: 100%; height: 180px; flex-direction: column; justify-content: center; align-items: center; }
.hintt { width: 640px; }
.hbtns { flex-direction: row; align-items: center; margin-top: 12px; }
.actbtn { flex-direction: row; justify-content: center; align-items: center; }
.actbtnt { }

/* 列表 */
.list { flex-direction: column; padding-left: 12px; padding-right: 12px; padding-top: 2px; }
.row { flex-direction: row; margin-bottom: 8px; padding: 8px; }
.av { width: 40px; height: 40px; border-radius: 20px; overflow: hidden; justify-content: center; align-items: center; }
.avimg { width: 40px; height: 40px; }
.main { flex: 1; flex-direction: column; margin-left: 10px; }
.head { flex-direction: row; align-items: center; width: 100%; }
.name { }
.time { margin-left: 8px; }
.text { width: 100%; margin-top: 4px; }

/* 转发块 */
.repost { width: 100%; margin-top: 4px; padding-left: 8px; padding-right: 8px; padding-top: 4px; padding-bottom: 4px; flex-direction: column; }
.rlabel { width: 100%; }
.rtext { width: 100%; margin-top: 2px; }

/* 专栏条: 44px 高, 整条可点 */
.art { width: 100%; height: 44px; margin-top: 4px; flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; }
.artt { width: 100%; }

/* 视频小卡: 左 120x75 封面 + 右侧标题/播放量 */
.vcard { flex-direction: row; margin-left: 10px; overflow: hidden; }
.vcover { width: 120px; height: 75px; overflow: hidden; }
.vcoverimg { width: 120px; height: 75px; }
.vinfo { flex: 1; flex-direction: column; justify-content: center; padding-left: 8px; padding-right: 8px; }
.vtitle { width: 100%; }
.vmeta { margin-top: 4px; }

/* 图片缩略图: 最多 3 张 60x60 横向排列 */
.pics { flex-direction: row; margin-left: 10px; }
.pic { overflow: hidden; margin-right: 6px; }
.picimg { width: 60px; height: 60px; }

/* 底部加载更多 */
.foot { flex-direction: row; justify-content: center; align-items: center; padding-top: 2px; padding-bottom: 12px; }
.more { flex-direction: row; justify-content: center; align-items: center; }
.moret { }
.endt { }
</style>
