<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: 返回 + 标题 (专栏详情没有自己的动作条, 全部动作都在正文里) -->
    <AppBar :title="'专栏'" :back="true" @back="onBack"></AppBar>

    <!-- 作者行: 拿到数据后才出现, 否则加载中会先闪一行空头像 + "阅读 0" -->
    <div v-if="art.id !== ''" class="head" :style="{ height: HEAD_H + 'px' }">
      <div class="av" :style="{ backgroundColor: U.c.surfaceContainerHighest }">
        <image v-if="art.face !== ''" class="avimg" :src="art.face" resize="cover"></image>
      </div>
      <div class="hinfo">
        <RichText class="hname" :text="art.author" :size="U.f.subtitle" :color="U.c.onSurface" :lines="1" :drop-emoji="false" />
        <text class="hpub" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ art.pubText }}</text>
      </div>
      <div class="hstats">
        <text class="hstat" :lines="1" :style="statStyle">阅读 {{ viewText }}</text>
        <text class="hstat" :lines="1" :style="statStyle">点赞 {{ likeText }}</text>
      </div>
    </div>

    <!-- 标题: 最多 2 行, 高度按字号算 (字号档位调大时不会把第二行裁掉) -->
    <div v-if="art.id !== ''" class="ttlwrap" :style="{ height: titleH + 'px' }">
      <RichText class="ttl" :text="art.title" :size="U.f.title" :color="U.c.onSurface" :lines="2" :drop-emoji="false" />
    </div>

    <div v-if="art.id !== ''" class="divider" :style="{ backgroundColor: U.c.outlineVariant }"></div>

    <!-- 正文: 几千字的专栏必须能滚 —— 固定头 + 只滚正文, 上滑时作者/标题不跑掉 -->
    <scroller class="body" scroll-direction="vertical" :show-scrollbar="true">
      <div v-if="loading" class="hint">
        <text class="hintt" :lines="1" :style="U.t.weak">加载中…</text>
      </div>

      <div v-else-if="error !== ''" class="hint">
        <text class="hintt" :lines="2" :style="U.t.weak">{{ error }}</text>
        <div class="retry" :style="retryBox" @click="load">
          <text class="retryt" :lines="1" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">重试</text>
        </div>
      </div>

      <div v-else-if="art.text === ''" class="hint">
        <text class="hintt" :lines="1" :style="U.t.weak">这篇专栏没有正文</text>
      </div>

      <!-- lines=0 = 不限制行数; emoji 交给 RichText 切分, 否则真机是豆腐块 -->
      <div v-else class="content">
        <RichText class="ctext" :text="art.text" :size="U.f.body" :color="U.c.onSurface" :lines="0" :drop-emoji="false" />
      </div>
    </scroller>
  </div>
</template>

<script>
import RichText from '../../components/rich-text.vue'
// 专栏详情 —— 对应 PiliNara lib/pages/article
// 参数: $page.options.cv (专栏号), 数据走 services/api.js 的 articleInfo(cv):
//   { id, title, author, face, pubText, banner, stats:{view,like,coin,fav}, text }
// 笔屏取舍:
//   1. 960x222 的可用区里, 作者行 + 标题固定在上方, 只有正文滚动 —— 读长文时不会失去定位
//   2. 正文 paragraphs 已经由 api.js 拼成带 \n 的纯文本, 这里 lines=0 全量渲染
//   3. 头像/正文/标题这些用户内容全部走 RichText, <text> 只放"阅读 12万"这类派生文案
import AppBar from '../../components/app-bar.vue'
import { ui } from '../../design/ui.js'
import { articleInfo } from '../../services/api.js'
import { log } from '../../core/log.js'

const HEAD_H = 48        // 作者行高: 40 头像 + 上下各 4
// 正文/标题的可用宽 = 960 - 左右各 12; 写法是"固定宽 + margin-left",
// 这样不管框架的盒模型是 content-box 还是 border-box, 都不会横向越界

/** 播放量/阅读量这类数字在笔屏上只需要一位小数 (12345 -> 1.2万) */
function countText(n) {
  const v = Number(n) || 0
  if (v >= 100000000) return (Math.round(v / 10000000) / 10) + '亿'
  if (v >= 10000) return (Math.round(v / 1000) / 10) + '万'
  return String(v)
}

export default {
  components: { AppBar, RichText },
  name: 'article',
  data() {
    return {
      U: ui(),
      cv: '',
      // 全部字段先声明: Vue2 只有声明过的键才是响应式的
      art: { id: '', title: '', author: '', face: '', pubText: '', stats: { view: 0, like: 0, coin: 0, fav: 0 }, text: '' },
      loading: false,
      error: '',
      genSeq: 0,
      paramKey: '',
      HEAD_H: HEAD_H
    }
  },
  computed: {
    titleH() { return Math.round(this.U.f.title * 1.45) * 2 },
    viewText() { return countText(this.art.stats ? this.art.stats.view : 0) },
    likeText() { return countText(this.art.stats ? this.art.stats.like : 0) },
    statStyle() {
      return { fontSize: this.U.f.caption + 'px', color: this.U.c.onSurfaceVariant }
    },
    retryBox() {
      return {
        height: '44px',
        paddingLeft: '26px',
        paddingRight: '26px',
        backgroundColor: this.U.c.primary,
        borderRadius: this.U.rad.btn + 'px'
      }
    }
  },
  mounted() {
    // ★ 参数统一走 readOptions(): mounted 在设备上不一定被调用
    this.readOptions()
  },
  methods: {
    // 框架只转发 onShow / onPageUnload 两个生命周期
    onShow() { this.U = ui() },
    /** 读取页面参数 (mounted 不保证触发, onShow 也要读; 同参数幂等) */
    readOptions() {
      const o = (this.$page && this.$page.options) || {}
      const cv = String(o.cv || '')
      if (this.paramKey === cv && cv !== '') return
      this.paramKey = cv
      this.cv = cv
      if (!cv) { this.status = '缺少专栏参数'; return }
      this.load()
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

    async load() {
      if (this._unloaded) return
      if (this.cv === '') { this.error = '缺少专栏参数'; return }
      const gen = ++this.genSeq
      this.loading = true
      this.error = ''
      try {
        const d = await articleInfo(this.cv)
        if (gen !== this.genSeq) return
        this.art = {
          id: String(d.id || this.cv),
          title: d.title || '',
          author: d.author || '',
          face: d.face || '',
          pubText: d.pubText || '',
          stats: d.stats || { view: 0, like: 0, coin: 0, fav: 0 },
          text: d.text || ''
        }
        log('专栏', 'cv=' + this.cv + ' 正文 ' + this.art.text.length + ' 字')
      } catch (e) {
        if (gen !== this.genSeq) return
        this.error = e && e.message ? e.message : String(e)
        log('专栏', '加载失败: ' + this.error)
      } finally {
        if (gen === this.genSeq) this.loading = false
      }
    }
  }
}
</script>

<style scoped>
/* 页面根: 960x266, 竖向排列 (顶栏 44 + 作者行 48 + 标题 2 行 + 1px 分隔 + 正文滚动区) */
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
.head { flex-direction: row; align-items: center; padding-left: 12px; padding-right: 12px; }
.av { width: 40px; height: 40px; border-radius: 20px; overflow: hidden; justify-content: center; align-items: center; }
.avimg { width: 40px; height: 40px; }
.hinfo { flex: 1; flex-direction: column; margin-left: 10px; }
.hname { width: 100%; }
.hpub { margin-top: 2px; }
.hstats { flex-direction: row; align-items: center; }
.hstat { margin-left: 14px; }

/* 标题与正文用"固定宽 + 左边距"而不是左右内边距:
   框架的盒模型不确定是 content-box 还是 border-box, 固定宽 + margin 在两种模型下都不会越界 */
.ttlwrap { flex-direction: column; justify-content: center; }
.ttl { width: 936px; margin-left: 12px; }
.divider { width: 960px; height: 1px; }

/* 正文滚动区: flex:1 吃掉剩下的高度, 长文在里面滚 */
.body { flex: 1; width: 100%; }
.content { flex-direction: column; padding-top: 6px; padding-bottom: 16px; }
.ctext { width: 936px; margin-left: 12px; }

/* 加载 / 错误 / 空态 */
.hint { width: 100%; height: 160px; flex-direction: column; justify-content: center; align-items: center; }
.hintt { width: 640px; }
.retry { flex-direction: row; justify-content: center; align-items: center; margin-top: 12px; }
.retryt { }
</style>
