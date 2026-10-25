<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <AppBar title="清除" :back="true" @back="onBack"></AppBar>

    <div class="body" :style="{ flexDirection: 'row', height: S.content + 'px' }">
      <!-- 左: 占用概览 (一眼看清哪里占地方) -->
      <div class="side" :style="{ backgroundColor: U.c.surfaceContainerLow, borderRadius: U.rad.card + 'px' }">
        <text class="stitle" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface }">占用</text>
        <div v-for="(s, i) in stats" :key="i" class="srow">
          <text class="slabel" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ s.label }}</text>
          <text class="sval" :lines="1" :style="{ fontSize: U.f.body + 'px', color: U.c.onSurface }">{{ s.value }}</text>
        </div>
        <div class="sbtns">
          <div class="sbtn" :style="U.action" @click="refresh">
            <text class="sbtnt" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurface }">刷新</text>
          </div>
        </div>
      </div>

      <div class="sep" :style="{ width: '1px', backgroundColor: U.c.outlineVariant }"></div>

      <!-- 右: 各项清理 (危险操作需要点两次确认) -->
      <scroller class="rows" scroll-direction="vertical" :show-scrollbar="true">
        <div class="rl">
          <div v-for="(r, i) in rows" :key="r.k" class="row" :style="rowStyle(r)" @click="onRow(r)">
            <div class="rtext">
              <text class="rlabel" :lines="1" :style="{ fontSize: U.f.body + 'px', color: r.danger ? U.c.error : U.c.onSurface }">{{ r.label }}</text>
              <text class="rdesc" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">{{ confirmKey === r.k ? '再点一次确认' : r.desc }}</text>
            </div>
            <div class="ctl" :style="pillStyle(r)">
              <text class="ct" :style="{ fontSize: U.f.caption + 'px', color: r.danger ? U.c.error : U.c.onSurface }">{{ confirmKey === r.k ? '确认' : '清除' }}</text>
            </div>
          </div>
        </div>
      </scroller>
    </div>

    <div v-if="tip !== ''" class="tip"
         :style="{ position: 'absolute', left: '250px', bottom: '8px', width: '460px', height: '40px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.inverseSurface, borderRadius: U.rad.chip + 'px' }">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
// 清除页 —— 数据与缓存清理
//
// 为什么要单独一页: 笔上存储很小 (/userdata 只有 123MB), 日志和播放记录会慢慢堆积.
// 放在设置里当一行不够用 (要显示占用 + 多项清理 + 二次确认).
//
// 安全约定:
//   - 默认只清"可再生的数据" (日志/搜索历史/播放进度/缩略图目录)
//   - 「清空全部」会保留登录态 (Cookie 不删, 否则用户要重新登录)
//   - 危险项都要点两次 (第一次变成"确认", 3 秒后自动复原), 笔上没有弹窗组件
import AppBar from '../../components/app-bar.vue'
import { ui } from '../../design/ui.js'
import { SCREEN } from '../../design/tokens.js'
import { logPathOf, logPrevPathOf, dataDirFn } from '../../core/paths.js'
import { clearSearchHistory, getSearchHistory, storeStatus } from '../../core/store.js'
import { allCfg, resetConfig } from '../../core/config.js'
import { log, flushLog } from '../../core/log.js'
import { bilinet } from '../../services/native.js'

const MI = {
  back: require('../../assets/mi/back_26_w.png')
}
const MI_D = {
  back: require('../../assets/mi/back_26_d.png')
}

/** 格式化字节 */
function fmtSize(n) {
  const b = Number(n) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(2) + ' MB'
}

/** 文件大小 (不存在返回 0) */
function sizeOf(p) {
  try {
    if (typeof bilinet.fileSize === 'function') return Number(bilinet.fileSize(p)) || 0
  } catch (e) {}
  try {
    // 退路: 用 shell 拿大小 (busybox stat)
    const out = bilinet.exec('stat -c %s "' + p + '" 2>/dev/null')
    return parseInt(String(out || '0'), 10) || 0
  } catch (e) {}
  return 0
}

export default {
  name: 'clean',
  components: { AppBar },
  data() {
    return {
      U: ui(),
      MI: MI,
      S: SCREEN,
      tip: '',
      confirmKey: '',
      tipTimer: null,
      confirmTimer: null,
      stats: []
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    rows() {
      return [
        { k: 'log', label: '清除运行日志', desc: 'pilipro.log 与上一次的备份', danger: false },
        { k: 'search', label: '清除搜索历史', desc: '搜索页的"搜索历史"列表', danger: false },
        { k: 'progress', label: '清除播放记录', desc: '每个视频的续播位置', danger: false },
        { k: 'imgcache', label: '清除图片缓存', desc: '框架的缩略图缓存 (重新联网时会再拉)', danger: false },
        { k: 'config', label: '恢复默认设置', desc: '所有设置项回到出厂值 (登录态保留)', danger: true },
        { k: 'all', label: '清空全部数据', desc: '日志/历史/进度/设置全清, 登录态保留', danger: true }
      ]
    }
  },
  mounted() { this.readOptions(); this.refresh() },
  onShow() { this.U = ui(); this.refresh() },
  onPageUnload() {
    if (this.tipTimer) { clearTimeout(this.tipTimer); this.tipTimer = null }
    if (this.confirmTimer) { clearTimeout(this.confirmTimer); this.confirmTimer = null }
  },
  methods: {
    readOptions() { /* 本页不需要参数, 但保留统一入口 */ },
    onBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('settings') } catch (e2) {} } },

    rowStyle(r) {
      return { flexDirection: 'row', alignItems: 'center', height: '52px' }
    },
    pillStyle(r) {
      return {
        width: '88px', height: '44px', flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
        borderRadius: this.U.rad.btn + 'px',
        backgroundColor: r.danger ? this.U.c.errorContainer : this.U.c.surfaceContainerHighest
      }
    },

    showTip(t) {
      this.tip = t
      if (this.tipTimer) clearTimeout(this.tipTimer)
      this.tipTimer = setTimeout(() => { this.tip = ''; this.tipTimer = null }, 2600)
    },

    /** 占用统计 */
    refresh() {
      const out = []
      try { out.push({ label: '运行日志', value: fmtSize(sizeOf(logPathOf())) }) } catch (e) {}
      try { out.push({ label: '日志备份', value: fmtSize(sizeOf(logPrevPathOf())) }) } catch (e) {}
      try {
        const n = getSearchHistory(999).length
        out.push({ label: '搜索历史', value: n + ' 条' })
      } catch (e) {}
      try {
        const c = allCfg()
        let n = 0
        for (const k in c) if (c.hasOwnProperty(k)) n++
        out.push({ label: '设置项', value: n + ' 项' })
      } catch (e) {}
      try { out.push({ label: '存储', value: storeStatus() }) } catch (e) {}
      this.stats = out
    },

    onRow(r) {
      // 危险操作: 第一次点只进入确认态
      if (r.danger && this.confirmKey !== r.k) {
        this.confirmKey = r.k
        if (this.confirmTimer) clearTimeout(this.confirmTimer)
        this.confirmTimer = setTimeout(() => { this.confirmKey = ''; this.confirmTimer = null }, 3000)
        return
      }
      this.confirmKey = ''
      if (this.confirmTimer) { clearTimeout(this.confirmTimer); this.confirmTimer = null }
      if (r.k === 'log') this.cleanLog()
      else if (r.k === 'search') this.cleanSearch()
      else if (r.k === 'progress') this.cleanProgress()
      else if (r.k === 'imgcache') this.cleanImgCache()
      else if (r.k === 'config') this.cleanConfig()
      else if (r.k === 'all') this.cleanAll()
    },

    cleanLog() {
      try {
        bilinet.writeFile(logPathOf(), '', false)
        bilinet.writeFile(logPrevPathOf(), '', false)
        log('清除', '日志已清空')
        this.showTip('日志已清空')
      } catch (e) { this.showTip('清空失败: ' + (e && e.message ? e.message : e)) }
      this.refresh()
    },

    cleanSearch() {
      try { clearSearchHistory(); this.showTip('搜索历史已清空') } catch (e) { this.showTip('清空失败: ' + e) }
      this.refresh()
    },

    cleanProgress() {
      try {
        const ok = bilinet.dbExec('DELETE FROM progress')
        this.showTip(ok === false ? '清空失败' : '播放记录已清空')
      } catch (e) { this.showTip('清空失败: ' + (e && e.message ? e.message : e)) }
      this.refresh()
    },

    cleanImgCache() {
      // 框架自带缩略图缓存目录, 删掉即可 (会重建)
      try {
        bilinet.exec('rm -rf ' + dataDirFn() + '/image_cache 2>/dev/null')
        this.showTip('图片缓存已清除')
      } catch (e) { this.showTip('清除失败: ' + (e && e.message ? e.message : e)) }
      this.refresh()
    },

    cleanConfig() {
      try {
        resetConfig()
        this.U = ui()
        log('清除', '设置已恢复默认')
        this.showTip('已恢复默认设置')
      } catch (e) { this.showTip('恢复失败: ' + (e && e.message ? e.message : e)) }
      this.refresh()
    },

    cleanAll() {
      try { bilinet.writeFile(logPathOf(), '', false) } catch (e) {}
      try { bilinet.writeFile(logPrevPathOf(), '', false) } catch (e) {}
      try { clearSearchHistory() } catch (e) {}
      try { bilinet.dbExec('DELETE FROM progress') } catch (e) {}
      try { bilinet.exec('rm -rf ' + dataDirFn() + '/image_cache 2>/dev/null') } catch (e) {}
      try { resetConfig(); this.U = ui() } catch (e) {}
      // 注意: 不动 auth.json —— 登录态保留
      try { log('清除', '全部数据已清空 (登录态保留)') } catch (e) {}
      this.showTip('已清空全部数据 (登录态保留)')
      this.refresh()
    }
  }
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
.body { flex-direction: row; padding-left: 12px; padding-right: 12px; padding-bottom: 8px; }
.side { width: 300px; flex-direction: column; padding: 10px; margin-right: 10px; }
.stitle { font-size: 16px; font-weight: bold; margin-bottom: 6px; }
.srow { flex-direction: row; align-items: center; justify-content: space-between; height: 24px; }
.slabel { font-size: 13px; }
.sval { font-size: 14px; }
.sbtns { flex-direction: row; margin-top: 8px; }
.sbtn { height: 44px; justify-content: center; align-items: center; padding-left: 16px; padding-right: 16px; }
.sbtnt { font-size: 13px; }
.sep { width: 1px; }
.rows { flex: 1; }
.rl { flex-direction: column; }
.row { flex-direction: row; align-items: center; height: 52px; padding-left: 12px; }
.rtext { flex: 1; flex-direction: column; }
.rlabel { font-size: 15px; }
.rdesc { font-size: 11px; margin-top: 2px; }
.ctl { width: 88px; height: 44px; flex-direction: row; justify-content: center; align-items: center; }
.ct { font-size: 13px; }
.tip { }
.tipt { font-size: 13px; }
</style>
