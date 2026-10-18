<template>
  <div class="page" :class="entering ? 'page-enter' : ''" :style="T.page" :style="{ backgroundColor: T.c.surface }">
    <div class="topbar" :style="T.bar" :style="{ backgroundColor: T.c.surfaceContainerLow }">
      <div class="back" @click="goBack" :style="T.inset" :style="{ backgroundColor: T.c.surfaceContainerHighest, borderRadius: T.rad.chip }">
        <image class="back-ic" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="back-text" :style="T.t.body" :style="{ color: T.c.onSurface }">返回</text>
      </div>
      <text class="topbar-title" :style="T.t.title" :style="{ color: T.c.onSurface }">本机记录{{ items.length > 0 ? ' (' + items.length + ')' : '' }}</text>
      <div v-if="items.length > 0" class="clear" @click="askClear" :style="T.inset" :style="{ backgroundColor: T.c.surfaceContainerHighest, borderRadius: T.rad.chip }">
        <text class="clear-text" :style="T.t.label">清空</text>
      </div>
    </div>

    <!-- 本机记录页: 数据只来自 /userdisk/xiro/progress.json, **不联网**, 与「历史记录」(b 站云端) 是两个页面 -->
    <div v-if="items.length === 0" class="empty-box">
      <image class="empty-ic" :src="MIc.history" :style="{ width: '54px', height: '54px' }"></image>
      <text class="empty-t" :style="T.t.subtitleVar">还没有本机观看记录</text>
      <text class="empty-d" :style="T.t.caption">看过的视频会记在这台设备上, 不会上传到 b 站</text>
    </div>

    <scroller v-else class="list" scroll-direction="vertical" :show-scrollbar="true"
              :loadmoreoffset="100" @scroll="onReturnScroll($event, 'returnTop0')">
      <div ref="returnTop0" class="return-anchor"></div>
      <div v-for="(item, i) in items" :key="item.bvid || ('h' + i)" class="item" :style="T.card" @click="openVideo(item)">
        <div class="cover-box">
          <image v-if="item.pic" class="cover" :src="item.pic" resize="cover" :lazy-load="true"></image>
          <div v-else class="cover-ph" :style="T.inset"></div>
          <text v-if="item.posText" class="cover-tag">{{ item.posText }}</text>
        </div>
        <div class="meta">
          <!-- 老记录(0.9.73 之前只存了 bvid)没有标题: 显示成"未记录标题"而不是把 bvid 当标题,
               一旦重新看过一次就会自动补全 (播放页会把标题/UP/封面写回去) -->
          <text class="title" :style="T.t.title" :style="{ color: T.c.onSurface }">{{ item.title || item.bvid }}</text>
          <text v-if="item.author" class="up" :style="T.t.accent">{{ item.author }}</text>
          <text v-else class="up" :style="T.t.caption">{{ item.stale ? '旧记录 · 再看一次可补全' : '' }}</text>
          <text class="stat" :style="T.t.caption">{{ item.durText || '' }}{{ item.durText ? '  ' : '' }}{{ item.atText }}</text>
        </div>
        <div class="del" @click.stop="del(item)" :style="T.inset">
          <text class="del-text" :style="T.t.label">删除</text>
        </div>
      </div>
      <div class="foot"></div>
    </scroller>

    <BackTop :visible="topShown" :T="T" @activate="goTop" />
  </div>
</template>

<script>
import BackTop from '../../components/back-top.vue'
import { scrollTopMixin } from '../../services/scroll-top.js'
import { nextDetailName } from '../../services/detail-ring.js'
import { listHistory, delHistory, clearHistory } from '../../services/progress.js'
import { tokens } from '../../services/theme.js'
import { afterPaint } from '../../base-page.js'
import { log } from '../../services/log.js'

// 图标: material-icons-svg 的光栅化产物 (生成器 tools/make-icons.mjs)
const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  history: require('../../assets/mi/my_history_w.png')
}
const MI_D = {
  back: require('../../assets/mi/back_26_d.png'),
  history: require('../../assets/mi/my_history_d.png')
}

function two(n) { return n < 10 ? '0' + n : '' + n }

/** 相对时间: 刚刚 / N 分钟前 / N 小时前 / 昨天 / M-D */
function relTime(ms) {
  if (!ms) return ''
  const d = Date.now() - ms
  if (d < 60000) return '刚刚'
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前'
  if (d < 172800000) return '昨天'
  const t = new Date(ms)
  return (t.getMonth() + 1) + '-' + two(t.getDate())
}

function mmss(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return Math.floor(s / 60) + ':' + two(s % 60)
}

export default {
  components: { BackTop },
  mixins: [scrollTopMixin],
  name: 'localhistory',
  data() {
    return {
      T: tokens(),
      items: [],
      topShown: false,
      entering: true
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D }
  },
  methods: {
    onShow() {
      this.load()
    },
    onUnload() {},
    goBack() {
      // 事件挂在有尺寸的 div 上 (本机固件 text 上的 @click 不触发)
      try { $falcon.navigateBack({}) } catch (e) { try { $falcon.navTo('index', {}) } catch (e2) {} }
    },
    load() {
      // 纯本地读取: 没有网络请求, 没有登录要求, 所以不需要 loading 态
      let rows = []
      try { rows = listHistory(200) } catch (e) {
        try { log('本机记录', '读取失败: ' + (e && e.message ? e.message : e)) } catch (e0) {}
      }
      const out = []
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        out.push({
          bvid: r.bvid,
          title: r.title,
          author: r.author,
          pic: r.pic,
          mid: r.mid,
          durText: r.durText || (r.dur > 0 ? mmss(r.dur) : ''),
          posText: r.pos > 0 ? ('看到 ' + mmss(r.pos)) : '',
          atText: relTime(r.at),
          // 0.9.73 之前的记录只有 bvid/进度, 没有标题与封面 —— 标出来, 别让人以为是加载失败
          stale: !r.title && !r.pic
        })
      }
      this.items = out
      try { log('本机记录', '载入 ' + out.length + ' 条 (本地, 不联网)') } catch (e1) {}
    },
    openVideo(item) {
      if (!item || !item.bvid) return
      // 与其它入口同一套游标: 避免同名页 navTo 让旧详情实例上浮 (见 detail-ring.js)
      try { $falcon.navTo(nextDetailName(), { bvid: item.bvid, title: item.title }) } catch (e) {}
    },
    del(item) {
      if (!item || !item.bvid) return
      try { delHistory(item.bvid) } catch (e) {}
      this.load()
    },
    askClear() {
      var self = this
      if (this._clearing) return
      this._clearing = true
      try {
        var ime = null
        // 复用系统输入法做二次确认太重, 这里用页内二段确认: 第一次点变文案, 3s 内再点才真清
        this.clearHint = true
        setTimeout(function () {
          if (self.clearArmed) {
            try { clearHistory() } catch (e) {}
            self.clearArmed = false
            self.load()
            try { log('本机记录', '已清空本机记录') } catch (e2) {}
          }
          self.clearHint = false
          self._clearing = false
        }, 3000)
        if (!this.clearArmed) { this.clearArmed = true; return }
      } catch (e) {
        this._clearing = false
      }
    },
    // scroller 的 @scroll 回调: 复用 scroll-top 混入 (它只决定"要不要显示回顶按钮").
    // ★ 不要在这里再定义 goTop —— 混入已经提供了 goTop(它靠 trackTop 记下的 topTarget 回顶),
    //   覆盖它反而会调到一个不存在的 scrollTop。
    onReturnScroll(e, target) { this.trackTop(e, target) }
  }
}
</script>

<style>
.page { width: 960px; height: 266px; flex-direction: column; }
.page-enter { opacity: 0.6; }
.topbar { height: 36px; flex-direction: row; align-items: center; padding-left: 10px; padding-right: 10px; }
.back { height: 28px; flex-direction: row; align-items: center; padding-left: 8px; padding-right: 12px; }
.back-ic { margin-right: 4px; }
.back-text { font-size: 17px; }
.topbar-title { flex: 1; font-size: 19px; margin-left: 10px; }
.clear { height: 28px; padding-left: 12px; padding-right: 12px; flex-direction: row; align-items: center; }
.clear-text { font-size: 17px; }
.list { flex: 1; }
.return-anchor { height: 1px; }
.item { flex-direction: row; align-items: center; margin-left: 12px; margin-right: 12px; margin-top: 8px; padding: 8px; }
.cover-box { width: 132px; height: 82px; border-radius: 8px; }
.cover { width: 132px; height: 82px; border-radius: 8px; }
.cover-ph { width: 132px; height: 82px; border-radius: 8px; }
.cover-tag { position: absolute; left: 4px; bottom: 4px; font-size: 15px; color: #ffffff; background-color: rgba(0,0,0,0.62); padding-left: 6px; padding-right: 6px; border-radius: 8px; }
.meta { flex: 1; flex-direction: column; margin-left: 12px; }
.title { font-size: 18px; lines: 2; }
.up { font-size: 15px; margin-top: 4px; }
.stat { font-size: 15px; margin-top: 2px; }
.del { width: 76px; height: 40px; flex-direction: row; align-items: center; justify-content: center; border-radius: 12px; }
.del-text { font-size: 16px; }
.empty-box { flex: 1; flex-direction: column; align-items: center; justify-content: center; }
.empty-ic { margin-bottom: 8px; }
.empty-t { font-size: 19px; }
.empty-d { font-size: 15px; margin-top: 6px; }
.foot { height: 20px; }
</style>
