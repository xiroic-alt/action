<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="bac" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="bat" :style="T.t.body">返回</text>
      </div>
      <text class="ttl" :style="T.t.title">播放线路</text>
      <div class="act" :style="testing ? T.insetR : T.accentR" @click="testAll">
        <image class="actic" :src="MIc.speed" :style="{ width: '22px', height: '22px' }"></image>
        <text class="actt" :style="testing ? T.t.label : T.t.onAccent">{{ testing ? '停止' : '测速' }}</text>
      </div>
      <text v-if="hint !== ''" class="hint" :style="T.t.label">{{ hint }}</text>
    </div>

    <scroller class="list" scroll-direction="vertical" :show-scrollbar="true">
      <text class="sec" :style="T.t.label">取流口</text>
      <div class="chips">
        <div v-for="s in sources" :key="s[0]" class="chip"
             :style="cfg.playSource === s[0] ? T.accentChip : T.insetR" @click="pickSource(s[0])">
          <text class="chipt" :style="cfg.playSource === s[0] ? T.t.onAccentC : T.t.label">{{ s[1] }}</text>
        </div>
      </div>
      <text class="note" :style="T.t.weak">{{ sourceDesc }}</text>

      <text class="sec" :style="T.t.label">CDN 节点 · 换 host 不换签名, 测速实拉 512KB</text>
      <div v-for="n in nodes" :key="n[0]" class="row" :style="isCur(n) ? T.accentChip : T.cardR" @click="pickNode(n)">
        <image class="ric" :src="isCur(n) ? MIc.optOn : MIc.optOff" :style="{ width: '20px', height: '20px' }"></image>
        <div class="rmain">
          <text class="rname" :style="isCur(n) ? T.t.onAccentC : T.t.labelOn">{{ n[1] }}</text>
          <text class="rhost" :style="T.t.weak">{{ n[2] || '(用接口返回的 host, 不替换)' }}</text>
        </div>
        <text class="rres" :style="resStyle(n)">{{ resultOf(n) }}</text>
      </div>

      <text class="sec" :style="T.t.label">自定义 host</text>
      <div class="row" :style="T.cardR">
        <div class="rmain">
          <text class="rname" :style="T.t.labelOn">{{ cfg.customHost || '(未设置)' }}</text>
          <text class="rhost" :style="T.t.weak">只接受 *.bilivideo.com / .cn / akamaized.net</text>
        </div>
        <div class="cbtn" :style="T.actionR" @click="editCustom"><text class="cbt" :style="T.t.labelOn">编辑</text></div>
        <div v-if="cfg.customHost" class="cbtn" :style="T.errActionR" @click="clearCustom"><text class="cbt" :style="T.t.err">清除</text></div>
      </div>

      <text class="foot" :style="T.t.tiny">{{ footNote }}</text>
    </scroller>
  </div>
</template>

<script>
// 播放线路页 —— 参考 Starfallan/PiliNara 的「CDN 设置」重做, 按本机约束落地:
//
//   它的做法是"候选 CDN host 单选 + 对真实视频流做限时下载取吞吐". 我们这边:
//   - <image>/<video> 都吃不了自定义请求头, 所以**只能换 host 不能换签名**
//     (签名是按原始 URL 的 path+query 算的; 实测换 host 后 206 正常, 见 HANDOVER);
//   - 没有 fetch/AbortController/流式进度, 只有 bilinet.execAsync(popen curl),
//     于是直接借 curl 的 -r(范围) + -w(状态码/首字节/吞吐/字节数) 一次拿全指标 ——
//     比"累计进度算速率"更准, 而且天然是"限时 512KB"的采样;
//   - 测速串行 + 可中断: QuickJS 单线程, 并发只会互相饿死 (PiliNara 内置列表也是串行).
//
// 关键实测 (2026-10-05, 10 组 A/B): CDN 防盗链的真门槛是 **User-Agent**,
// Referer 完全不影响 (无 header 403 / 浏览器 UA 206 / GStreamer UA 206 / curl UA 403 /
// 只有 Referer 仍然 403). 所以框架内置 <video> 的 souphttpsrc 天然过闸, 换 host 可行.
import { bilinet } from '../../services/native.js'
import { loadConfig, setCfg } from '../../services/config.js'
import { tokens } from '../../services/theme.js'
import { SOURCES, CDN_NODES, probe, fmtProbe, currentHost, isValidHost, applyHost, UA, REFERER } from '../../services/lines.js'
import { getVideoDetail, getPlayUrlRaw } from '../../services/bili.js'
import { log } from '../../services/log.js'

const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  speed: require('../../assets/mi/set_speed_w.png'),
  optOn: require('../../assets/mi/opt_on_w.png'),
  optOff: require('../../assets/mi/opt_off_w.png')
}
const MI_D = {
  back: require('../../assets/mi/back_26_d.png'),
  speed: require('../../assets/mi/set_speed_d.png'),
  optOn: require('../../assets/mi/opt_on_d.png'),
  optOff: require('../../assets/mi/opt_off_d.png')
}

// 测速样本: 用一支稳定的官方演示片 (4K120 技术演示片, 常年在线).
// 取它的 html5 口 mp4 直链当"待测资源", 再逐个换 host 去量.
const SAMPLE_BVID = 'BV1fK4y1t7hj'

export default {
  name: 'lines',
  data() {
    return {
      cfg: loadConfig(),
      T: tokens(),
      sources: SOURCES,
      nodes: CDN_NODES,
      results: {},
      testing: false,
      hint: '',
      footNote: '测速样本: ' + SAMPLE_BVID + ' 的 html5 口直链',
      runId: 0,
      sampleUrl: ''
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D },
    sourceDesc() {
      for (let i = 0; i < SOURCES.length; i++) if (SOURCES[i][0] === this.cfg.playSource) return SOURCES[i][2]
      return ''
    }
  },
  methods: {
    onShow() { this.cfg = loadConfig(); this.T = tokens() },
    onUnload() { this.runId++ },   // 停掉在途测速的回写

    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('settings') } catch (e2) {} } },
    isCur(n) {
      if (n[0] === 'default') return !this.cfg.customHost && this.cfg.cdnNode === 'default'
      return !this.cfg.customHost && this.cfg.cdnNode === n[0]
    },
    pickSource(k) { this.cfg = setCfg('playSource', k); this.tip('取流口 = ' + k) },
    pickNode(n) {
      if (n[0] === 'default') this.cfg = setCfg('cdnNode', 'default')
      else this.cfg = setCfg('cdnNode', n[0])
      this.cfg = setCfg('customHost', '')
      log('线路', '选择节点 ' + n[1] + ' host=' + (n[2] || '不替换'))
      this.tip('已选 ' + n[1])
    },
    resultOf(n) { const r = this.results[n[0]]; return r === undefined ? '未测' : fmtProbe(r) },
    resStyle(n) {
      const r = this.results[n[0]]
      if (r === undefined) return this.T.t.weak
      return r.ok ? this.T.t.accentSm : this.T.t.err
    },

    tip(msg) {
      const self = this
      this.hint = msg
      if (this.hintTimer) clearTimeout(this.hintTimer)
      this.hintTimer = setTimeout(function () { self.hint = '' }, 3000)
    },

    // 取一支样本视频的直链 (只取一次, 全部节点复用)
    ensureSample() {
      if (this.sampleUrl) return Promise.resolve(this.sampleUrl)
      const self = this
      return getVideoDetail(SAMPLE_BVID).then(function (d) {
        const cid = d && d.pages && d.pages[0] ? d.pages[0].cid : 0
        if (!cid) throw new Error('样本视频没有 cid')
        return getPlayUrlRaw(SAMPLE_BVID, cid, { source: self.cfg.playSource, noCache: true })
      }).then(function (p) {
        self.sampleUrl = p.url
        self.footNote = '测速样本: ' + SAMPLE_BVID + ' @ ' + (p.quality || '') + ' · ' + Math.round(p.size / 1024) + 'KB'
        return p.url
      })
    },

    testAll() {
      if (this.testing) { this.runId++; this.testing = false; this.tip('已停止测速'); return }
      const self = this
      const id = ++this.runId
      this.testing = true
      this.results = {}
      this.tip('正在取测速样本…')
      const kb = this.cfg.probeBytesKb
      const to = this.cfg.probeTimeoutSec
      this.ensureSample().then(function (url) {
        if (id !== self.runId) return
        self.tip('测速中 (串行, 每项 ≤' + to + 's)…')
        return self.runQueue(url, id, kb, to)
      }).catch(function (e) {
        if (id !== self.runId) return
        self.testing = false
        self.tip('测速失败: ' + (e && e.message ? e.message : e))
      })
    },

    // 严格串行: 逐项 await, 每项完成立刻写回界面 (可视化进度, 也让"停止"有意义)
    runQueue(url, id, kb, to) {
      const self = this
      const list = CDN_NODES
      let i = 0
      function next() {
        if (id !== self.runId) return Promise.resolve()
        if (i >= list.length) {
          self.testing = false
          self.tip('测速完成')
          return Promise.resolve()
        }
        const n = list[i++]
        const u = n[2] ? applyHost(url, n[2]) : url
        return probe(u, { bytes: kb * 1024, timeoutSec: to }).then(function (r) {
          // Vue2 对新增键不做响应式: 整体换代
          const m = {}
          for (const k in self.results) m[k] = self.results[k]
          m[n[0]] = r
          self.results = m
          return next()
        })
      }
      return next()
    },

    // 自定义 host: 用系统输入法 (services/ime) 太绕, 这里只做"粘贴式"编辑 ——
    // 输入法入口复用 login 页的 startTextEdit 方案代价高, 而在 266px 屏上敲 host
    // 并不现实. 折中: 提供几个已知可用的候选, 让用户循环挑选, 非法值直接拒绝.
    editCustom() {
      const pool = ['', 'upos-sz-mirrorali.bilivideo.com', 'upos-sz-mirrorcos.bilivideo.com',
        'upos-sz-mirrorhw.bilivideo.com', 'upos-sz-mirror08c.bilivideo.com']
      const cur = String(this.cfg.customHost || '')
      let idx = 0
      for (let i = 0; i < pool.length; i++) if (pool[i] === cur) idx = i
      const nextHost = pool[(idx + 1) % pool.length]
      if (nextHost && !isValidHost(nextHost)) { this.tip('非法 host, 已忽略'); return }
      this.cfg = setCfg('customHost', nextHost)
      this.tip(nextHost ? ('自定义 host = ' + nextHost) : '已清除自定义 host')
    },
    clearCustom() { this.cfg = setCfg('customHost', ''); this.tip('已清除自定义 host') }
  }
}
</script>

<style scoped>
.page { width: 960px; height: 266px; flex-direction: column; }
.topbar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { flex-direction: row; align-items: center; height: 40px; width: 132px; margin-left: 12px; justify-content: center; }
.bac { margin-right: 4px; }
.ttl { margin-left: 12px; flex: 1; }
.act { flex-direction: row; align-items: center; justify-content: center; height: 34px; min-width: 84px; padding-left: 12px; padding-right: 14px; margin-right: 16px; }
.actic { margin-right: 4px; }
.hint { margin-right: 12px; }
.list { width: 100%; flex: 1; flex-direction: column; }
.sec { margin-left: 20px; margin-top: 10px; margin-bottom: 6px; }
.chips { flex-direction: row; margin-left: 20px; }
/* ★ 同 live.vue: 只挂 padding 的 div 在本机命中区为 0, 必须给显式高度 */
.chip { height: 32px; padding-left: 14px; padding-right: 14px; margin-right: 8px;
        flex-direction: row; align-items: center; }
.chipt { }
.note { margin-left: 20px; margin-top: 6px; margin-right: 20px; }
.row { width: 100%; flex-direction: row; align-items: center; margin-bottom: 6px;
       padding-left: 16px; padding-right: 16px; padding-top: 6px; padding-bottom: 6px; }
.ric { margin-right: 10px; }
.rmain { flex: 1; flex-direction: column; }
.rhost { margin-top: 2px; }
.rres { min-width: 150px; text-align: right; }
.cbtn { height: 30px; padding-left: 12px; padding-right: 12px; margin-left: 8px;
         flex-direction: row; align-items: center; }
.cbt { }
.foot { width: 100%; text-align: center; margin-top: 10px; margin-bottom: 20px; }
</style>
