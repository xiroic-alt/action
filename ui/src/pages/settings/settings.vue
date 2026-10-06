<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="bac" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="bat" :style="T.t.body">返回</text>
      </div>
      <text class="ttl" :style="T.t.title">设置</text>
      <text v-if="status !== ''" class="toast" :style="T.accentChip">{{ status }}</text>
    </div>

    <scroller class="list" scroll-direction="vertical" :show-scrollbar="true">
      <div v-for="g in groups" :key="g.id" class="grp">
        <div class="sechead">
          <image class="secic" :src="ic(g.icon)" :style="{ width: '18px', height: '18px' }"></image>
          <text class="sect" :style="T.t.label">{{ g.title }}</text>
        </div>

        <div v-for="r in g.rows" :key="g.id + '.' + r.k" class="row" :style="T.cardR">
          <div v-if="r.t !== 'text'" class="rmain">
            <text class="rtitle" :style="T.t.labelOn">{{ r.label }}</text>
            <text v-if="r.desc" class="rdesc" :style="T.t.weak">{{ r.desc }}</text>
          </div>
          <text v-else class="rtext" :style="T.t.caption">{{ aboutText(r.textKey) }}</text>

          <!-- 开关 (M3 switch): 轨道 + 手柄, 状态不只靠颜色 (手柄位置也是信息) -->
          <div v-if="r.t === 'switch'" class="sw"
               :style="cfg[r.k] ? T.accentBg : T.inset" @click="toggle(r.k)">
            <div class="knob" :class="cfg[r.k] ? 'knob-on' : 'knob-off'"
                 :style="{ backgroundColor: cfg[r.k] ? T.c.onPrimary : T.c.outline }"></div>
          </div>

          <!-- 分段选择 (M3 segmented button) -->
          <div v-else-if="r.t === 'choice'" class="seg">
            <div v-for="o in r.opts" :key="r.k + '_' + o[0]" class="segi"
                 :style="isOn(r.k, o[0]) ? T.accentChip : T.insetR" @click="pick(r.k, o[0])">
              <text class="segt" :style="isOn(r.k, o[0]) ? T.t.onAccentC : T.t.label">{{ o[1] }}</text>
            </div>
          </div>

          <!-- 数值 (步进器) -->
          <div v-else-if="r.t === 'number'" class="num">
            <div class="nbtn" :style="T.insetR" @click="bump(r, -1)"><text class="nbt" :style="T.t.labelOn">−</text></div>
            <text class="nval" :style="T.t.accentSm">{{ r.fmt ? r.fmt(cfg[r.k]) : cfg[r.k] }}</text>
            <div class="nbtn" :style="T.insetR" @click="bump(r, 1)"><text class="nbt" :style="T.t.labelOn">＋</text></div>
          </div>

          <!-- 主题色板: 展示的是**种子原色** (M3 tonal spot 只取色相, 派生的 primary
               会按明暗落到 tone 40/80, 所以展示原色更能说明"我选了什么") -->
          <div v-else-if="r.t === 'color'" class="swatches">
            <div v-for="s in seeds" :key="s[0]" class="swatch"
                 :style="swatchStyle(s[1])" @click="pick('themeSeed', s[0])">
              <image v-if="cfg.themeSeed === s[0]" class="swic"
                     :src="readableOn(s[1]) === '#ffffff' ? MIc.check : MIc.checkDark"
                     :style="{ width: '20px', height: '20px' }"></image>
            </div>
          </div>

          <!-- 跳转 -->
          <div v-else-if="r.t === 'go'" class="go" :style="T.insetR" @click="nav(r.to)">
            <text class="got" :style="T.t.label">{{ r.val() }}</text>
            <image class="goic" :src="MIc.chevron" :style="{ width: '20px', height: '20px' }"></image>
          </div>

          <!-- 动作 -->
          <div v-else-if="r.t === 'action'" class="go"
               :style="r.danger ? T.errActionR : T.actionR" @click="runAction(r)">
            <text class="got" :style="r.danger ? T.t.err : T.t.labelOn">{{ r.confirm ? '再点一次确认' : r.act }}</text>
          </div>
        </div>
      </div>

      <text class="foot" :style="T.t.tiny">bilibilipan · 有道词典笔 mini-app · 设置保存在 {{ cfgPath }}</text>
    </scroller>
  </div>
</template>

<script>
// 设置页 (M3 settings): 分组列表 + 逐行控件.
//
// 结构: SCHEMA 描述"有哪些组/哪些行/什么控件", 值是运行时从 services/config.js 读的
// live 值 —— 结构静态、值动态, 所以不会出现"加了配置项但设置页没入口"的漂移.
// 每个键都在 config.js 的 SPEC 表里注册 (默认值 + 取值域 + 类型校验是同一张表).
//
// 主题相关的键改完立刻生效: 重新 tokens() 赋给 this.T, 整页颜色跟着变.
import pm from 'pm'
import { bilinet } from 'bilinet'
import { loadConfig, setCfg, resetConfig, specOf, CFG_PATH } from '../../services/config.js'
import { tokens, seedList, readableOn } from '../../services/theme.js'
import { currentLineLabel } from '../../services/lines.js'
import { log, logStatus, setLogLevel } from '../../services/log.js'
import { getMid, clearLogin, hasCookie } from '../../services/auth.js'
import { clearSearchHistory } from '../../services/store.js'

// 图标 (material-icons-svg 光栅化; _w 深色主题底 / _d 浅色主题底)
const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  set_appearance: require('../../assets/mi/set_appearance_w.png'),
  set_play: require('../../assets/mi/set_play_w.png'),
  set_line: require('../../assets/mi/set_line_w.png'),
  set_net: require('../../assets/mi/set_net_w.png'),
  set_data: require('../../assets/mi/set_data_w.png'),
  set_account: require('../../assets/mi/set_account_w.png'),
  set_about: require('../../assets/mi/set_about_w.png'),
  set_live: require('../../assets/mi/set_live_w.png'),
  set_msg: require('../../assets/mi/set_msg_w.png'),
  chevron: require('../../assets/mi/chevron_20_m.png'),
  // 色板打勾: 深底用白勾, 浅底用黑勾 (种子的明度决定)
  check: require('../../assets/mi/check_20_w.png'),
  checkDark: require('../../assets/mi/check_20_d.png')
}
const MI_D = {
  back: require('../../assets/mi/back_26_d.png'),
  set_appearance: require('../../assets/mi/set_appearance_d.png'),
  set_play: require('../../assets/mi/set_play_d.png'),
  set_line: require('../../assets/mi/set_line_d.png'),
  set_net: require('../../assets/mi/set_net_d.png'),
  set_data: require('../../assets/mi/set_data_d.png'),
  set_account: require('../../assets/mi/set_account_d.png'),
  set_about: require('../../assets/mi/set_about_d.png'),
  set_live: require('../../assets/mi/set_live_d.png'),
  set_msg: require('../../assets/mi/set_msg_d.png'),
  chevron: require('../../assets/mi/chevron_20_dm.png'),
  check: require('../../assets/mi/check_20_d.png'),
  checkDark: require('../../assets/mi/check_20_d.png')
}

// 分组与行 (结构). 值一律从 this.cfg live 读, 不在这里快照.
const SCHEMA = [
  {
    id: 'look', title: '外观', icon: 'set_appearance',
    rows: [
      { k: 'themeSeed', t: 'color', label: '主题色', desc: 'M3 动态取色: 由种子色派生整套配色 (tonal spot)' },
      { k: 'themeMode', t: 'choice', label: '明暗', desc: '跟随时间 = 06:00-18:00 浅色', opts: [['dark', '深色'], ['light', '浅色'], ['auto', '跟随时间']] },
      { k: 'contrastLevel', t: 'choice', label: '对比度', desc: 'M3 contrast level', opts: [[0, '标准'], [1, '高对比']] },
      { k: 'pureBlack', t: 'switch', label: '纯黑背景', desc: '深色模式下页面底压到纯黑, 更省电' },
      { k: 'radiusStyle', t: 'choice', label: '圆角', opts: [['flat', '方正'], ['std', '标准'], ['round', '圆润']] },
      { k: 'density', t: 'choice', label: '列表密度', desc: '影响列表封面大小与行高', opts: [['compact', '紧凑'], ['std', '标准'], ['cozy', '宽松']] },
      { k: 'fontScale', t: 'choice', label: '字号', opts: [['sm', '小'], ['std', '标准'], ['lg', '大']] },
      { k: 'navPos', t: 'choice', label: '导航位置', desc: '左侧竖排 = M3 NavigationRail, 内容多 20% 高', opts: [['left', '左侧竖排'], ['top', '顶部横排']] },
      { k: 'motion', t: 'switch', label: '界面动效', desc: '关闭后不挂任何过渡动画' }
    ]
  },
  {
    id: 'play', title: '播放', icon: 'set_play',
    rows: [
      { k: 'line', t: 'go', label: '播放线路', desc: '取流口 / CDN 节点 / 测速', to: 'lines', val: () => currentLineLabel() },
      { k: 'playSource', t: 'choice', label: '取流口', opts: [['auto', '自动'], ['html5', 'HTML5'], ['web', '网页'], ['backup', '备用']] },
      { k: 'autoFallback', t: 'switch', label: '失败自动换线', desc: '起播失败时按顺序试下一个线路' },
      { k: 'defaultRate', t: 'choice', label: '默认倍速', opts: [[0.5, '0.5x'], [1, '1x'], [1.25, '1.25x'], [1.5, '1.5x'], [2, '2x']] },
      { k: 'resumePlay', t: 'switch', label: '断点续播', desc: '记住每支视频看到哪, 下次接着放' },
      { k: 'skipIntroSec', t: 'number', label: '跳过片头', desc: '进入播放时直接跳过开头 N 秒', step: 5, fmt: (v) => v + 's' },
      { k: 'keepAwake', t: 'switch', label: '播放防息屏', desc: '播放期间每 6s 点亮一次屏幕' },
      { k: 'btaudioMs', t: 'number', label: '蓝牙音画补偿', desc: '画面超前就加大, 声音超前就减小', step: 50, fmt: (v) => v + 'ms' }
    ]
  },
  {
    id: 'net', title: '网络与内容', icon: 'set_net',
    rows: [
      { k: 'imgQuality', t: 'choice', label: '图片质量', desc: '封面按需裁切, 省流档更小更快', opts: [['low', '省流'], ['std', '标准'], ['high', '高清']] },
      { k: 'defaultTab', t: 'choice', label: '启动分区', opts: [['recommend', '推荐'], ['hot', '热门'], ['search', '搜索'], ['dynamic', '动态'], ['mine', '我的']] },
      { k: 'showStat', t: 'switch', label: '显示播放量', desc: '列表卡片底部显示播放量与时长' },
      { k: 'httpTimeout', t: 'number', label: '请求超时', desc: '接口最长等待秒数', step: 5, fmt: (v) => v + 's' }
    ]
  },
  {
    id: 'more', title: '扩展', icon: 'set_live',
    rows: [
      { k: 'live', t: 'go', label: '直播', desc: '搜索直播间并尝试播放', to: 'live', val: () => '进入' },
      { k: 'msg', t: 'go', label: '消息中心', desc: '未读统计与回复我的', to: 'msg', val: () => '进入' }
    ]
  },
  {
    id: 'data', title: '数据', icon: 'set_data',
    rows: [
      { k: 'cache', t: 'action', label: '清理图片缓存', desc: '下次进入列表重新下载封面', act: '清理', run: 'clearImage' },
      { k: 'his', t: 'action', label: '清空搜索历史', act: '清空', run: 'clearHis' },
      { k: 'reset', t: 'action', label: '恢复默认设置', desc: '主题 / 播放 / 网络全部回到出厂值', act: '恢复默认', run: 'reset', danger: true }
    ]
  },
  {
    id: 'acct', title: '账号', icon: 'set_account',
    rows: [
      { k: 'logout', t: 'action', label: '退出登录', desc: '退出后需重新扫码或导入 Cookie', act: '退出登录', run: 'logout', danger: true }
    ]
  },
  {
    id: 'about', title: '关于', icon: 'set_about',
    rows: [
      { k: 'v', t: 'text', textKey: 'version' },
      { k: 'a', t: 'text', textKey: 'appid' },
      { k: 'u', t: 'text', textKey: 'login' },
      { k: 'l', t: 'text', textKey: 'log' },
      { k: 'c', t: 'text', textKey: 'cfg' },
      { k: 'lg', t: 'choice', label: '日志级别', desc: 'off 完全不落盘, debug 最啰嗦', opts: [['off', '关'], ['error', '错误'], ['info', '常规'], ['debug', '调试']] }
    ]
  }
]

export default {
  name: 'settings',
  data() {
    return {
      cfg: loadConfig(),
      groups: SCHEMA,
      seeds: seedList(),
      T: tokens(),
      version: '',
      status: '',
      statusTimer: null,
      confirmKey: '',
      confirmTimer: null,
      cfgPath: CFG_PATH
    }
  },
  computed: {
    MIc() {
      const m = this.T.dark ? MI : MI_D
      // 色板的黑勾只在浅色种子上用, 深色主题/浅色主题各取一版
      const out = {}
      for (const k in m) out[k] = m[k]
      out.checkDark = this.T.dark ? MI.checkDark : MI_D.checkDark
      return out
    }
  },
  mounted() {
    this.reload()
  },
  methods: {
    // 组件里只有 onShow 会被框架转发 (HANDOVER §14.1)
    onShow() { this.reload() },
    onUnload() {
      if (this.statusTimer) { clearTimeout(this.statusTimer); this.statusTimer = null }
      if (this.confirmTimer) { clearTimeout(this.confirmTimer); this.confirmTimer = null }
    },

    reload() {
      this.T = tokens()
      this.cfg = loadConfig()
      try {
        const info = pm.getPackageInfo('8001812345678901')
        if (info && info.version) this.version = info.version
      } catch (e) {}
    },
    aboutText(key) {
      if (key === 'version') return '版本 v' + this.version
      if (key === 'appid') return 'appid 8001812345678901'
      if (key === 'login') return '登录 ' + (hasCookie() ? ('uid ' + (getMid() || '?')) : '(未登录)')
      if (key === 'log') return logStatus()
      if (key === 'cfg') return '配置 ' + CFG_PATH
      return ''
    },

    ic(key) { return this.MIc[key] || this.MIc.set_about },
    isOn(k, v) { return String(this.cfg[k]) === String(v) },
    swatchStyle(hex) {
      return { backgroundColor: hex, borderRadius: this.T.rad.chip }
    },

    // 改一项: 写盘 -> 立刻重算 token -> 提示 (主题类改动当场可见)
    apply(k, v) {
      this.cfg = setCfg(k, v)
      if (k === 'themeSeed' || k === 'themeMode' || k === 'contrastLevel' || k === 'pureBlack' ||
        k === 'radiusStyle' || k === 'density' || k === 'fontScale') {
        this.T = tokens()
      }
      if (k === 'logLevel') { try { setLogLevel(v) } catch (e) {} }
    },
    toggle(k) { this.apply(k, !this.cfg[k]); this.tip(k + (this.cfg[k] ? ' 已开启' : ' 已关闭')) },
    pick(k, v) { this.apply(k, v); this.tip('已设置为 ' + v) },
    bump(r, dir) {
      const cur = Number(this.cfg[r.k]) || 0
      const step = (r.step || 1) * dir
      let next = cur + step
      const sp = specOf(r.k)
      if (sp && sp[1] === 'int') {
        if (next < sp[2][0]) next = sp[2][0]
        if (next > sp[2][1]) next = sp[2][1]
      }
      this.apply(r.k, next)
      this.tip(r.label + ' = ' + next)
    },

    nav(to) { try { $falcon.navTo(to, {}) } catch (e) { this.tip('打开失败: ' + (e && e.message ? e.message : e)) } },
    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('index') } catch (e2) {} } },

    // 危险动作二次确认 (第一次点变文案, 5s 内再点才执行)
    runAction(r) {
      if (r.danger && this.confirmKey !== r.k) {
        this.confirmKey = r.k
        const self = this
        if (this.confirmTimer) clearTimeout(this.confirmTimer)
        this.confirmTimer = setTimeout(function () { self.confirmKey = '' }, 5000)
        this.tip('再点一次确认: ' + r.label)
        return
      }
      this.confirmKey = ''
      if (this.confirmTimer) clearTimeout(this.confirmTimer)
      if (r.run === 'clearImage') this.doClearImage()
      else if (r.run === 'clearHis') this.doClearHis()
      else if (r.run === 'reset') this.doReset()
      else if (r.run === 'logout') this.doLogout()
    },
    doClearImage() {
      try {
        const out = bilinet.exec('miniapp_cli trimImageCache')
        log('设置', '清理图片缓存: ' + out)
        this.tip('图片缓存已清理')
      } catch (e) { this.tip('清理失败: ' + (e && e.message ? e.message : e)) }
    },
    doClearHis() {
      try { clearSearchHistory() } catch (e) {}
      this.tip('搜索历史已清空')
    },
    doReset() {
      this.cfg = resetConfig()
      this.T = tokens()
      try { setLogLevel(this.cfg.logLevel) } catch (e) {}
      this.tip('已恢复默认设置')
    },
    doLogout() {
      try { clearLogin() } catch (e) {}
      log('设置', '已退出登录')
      this.tip('已退出登录, 需重新登录才能用收藏/评论')
    },

    tip(msg) {
      const self = this
      this.status = msg
      if (this.statusTimer) clearTimeout(this.statusTimer)
      this.statusTimer = setTimeout(function () { self.status = '' }, 2600)
    }
  }
}
</script>

<style scoped>
.page { width: 960px; height: 266px; flex-direction: column; }
.topbar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { flex-direction: row; align-items: center; height: 40px; width: 132px; margin-left: 12px; justify-content: center; }
.bac { margin-right: 4px; }
.bat { }
.ttl { margin-left: 12px; }
.toast { padding-left: 14px; padding-right: 14px; padding-top: 4px; padding-bottom: 4px; margin-left: 16px; }
.list { width: 100%; flex: 1; flex-direction: column; }
.grp { flex-direction: column; }
.sechead { flex-direction: row; align-items: center; margin-left: 20px; margin-top: 12px; margin-bottom: 6px; }
.secic { margin-right: 6px; }
.sect { }
.row { width: 100%; flex-direction: row; align-items: center; margin-bottom: 6px;
       padding-left: 16px; padding-right: 16px; padding-top: 6px; padding-bottom: 6px; }
.rmain { flex: 1; flex-direction: column; }
.rtitle { }
.rdesc { margin-top: 2px; }
.rtext { }
.sw { width: 52px; height: 30px; border-radius: 15px; flex-direction: row; align-items: center; }
.knob { width: 22px; height: 22px; border-radius: 11px; }
.knob-on { margin-left: 27px; }
.knob-off { margin-left: 4px; }
.seg { flex-direction: row; align-items: center; }
.segi { padding-left: 12px; padding-right: 12px; padding-top: 5px; padding-bottom: 5px; margin-left: 6px; justify-content: center; }
.segt { }
.num { flex-direction: row; align-items: center; }
.nbtn { width: 36px; height: 32px; justify-content: center; align-items: center; }
.nbt { }
.nval { margin-left: 12px; margin-right: 12px; min-width: 60px; text-align: center; }
.swatches { flex-direction: row; align-items: center; }
.swatch { width: 34px; height: 34px; margin-left: 8px; justify-content: center; align-items: center; }
.swic { }
.go { flex-direction: row; align-items: center; padding-left: 12px; padding-right: 10px; padding-top: 6px; padding-bottom: 6px; }
.got { margin-right: 2px; }
.goic { }
.foot { width: 100%; text-align: center; margin-top: 8px; margin-bottom: 20px; }
</style>
