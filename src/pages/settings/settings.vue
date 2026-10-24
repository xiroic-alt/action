<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 顶栏: 返回 + 标题 (PiliNara AppBar: elevation 0 / titleSpacing 0 / 标题 16px) -->
    <div class="head" :style="{ backgroundColor: U.c.surface, height: '44px', width: '100%', flexDirection: 'row', alignItems: 'center' }">
      <div class="hit" :style="{ width: '44px', height: '44px', justifyContent: 'center', alignItems: 'center' }" @click="goBack">
        <image class="hic" :src="MIc.back" :style="{ width: '24px', height: '24px' }"></image>
      </div>
      <text class="ttl" :lines="1" :style="{ fontSize: U.f.title + 'px', color: U.c.onSurface }">设置</text>
    </div>

    <div class="body" :style="{ flexDirection: 'row', height: S.content + 'px' }">
      <!-- 左: 分组 (PiliNara 横屏设置页 Expanded(flex:4) 的等价物) -->
      <scroller class="gnav" scroll-direction="vertical" :show-scrollbar="false"
                :style="{ width: '296px', height: S.content + 'px', backgroundColor: U.c.surfaceContainerLow }">
        <div class="gl" :style="{ flexDirection: 'column', paddingTop: '4px', paddingBottom: '8px' }">
          <div v-for="g in groups" :key="g.id" class="grow" :style="groupStyle(g)" @click="pickGroup(g)">
            <text class="gt" :lines="1" :style="groupText(g)">{{ g.title }}</text>
          </div>
        </div>
      </scroller>

      <div class="sep" :style="{ width: '1px', height: S.content + 'px', backgroundColor: U.c.outlineVariant }"></div>

      <!-- 右: 当前分组的行 (分组 + 行 + 右侧控件) -->
      <scroller class="rows" scroll-direction="vertical" :show-scrollbar="true"
                :style="{ flex: 1, height: S.content + 'px' }">
        <div class="rl" :style="{ flexDirection: 'column', paddingLeft: '14px', paddingRight: '12px', paddingBottom: '12px' }">
          <text class="rtitle" :lines="1" :style="{ fontSize: U.f.subtitle + 'px', color: U.c.onSurface, marginTop: '8px', marginBottom: '4px', fontWeight: 'bold' }">{{ curGroup.title }}</text>

          <div v-for="(r, i) in curGroup.rows" :key="curGroup.id + '_' + i" class="row" :style="rowStyle(r)" @click="onRow(r)">
            <div class="rtext" :style="{ flex: 1, flexDirection: 'column' }">
              <text class="rlabel" :lines="1" :style="{ fontSize: U.f.body + 'px', color: r.danger === true ? U.c.error : U.c.onSurface }">{{ r.label }}</text>
              <text v-if="r.desc" class="rdesc" :lines="1" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant, marginTop: '2px' }">{{ r.desc }}</text>
            </div>

            <!-- 开关: 44px 命中区里的药丸 + 圆点; 只用 transform 位移 -->
            <div v-if="r.t === 'switch'" class="ctl" :style="{ width: '56px', height: '44px', justifyContent: 'center', alignItems: 'center' }">
              <div class="sw" :style="switchStyle(r.k)">
                <div class="knob" :style="knobStyle(r.k)"></div>
              </div>
            </div>

            <!-- 单选: 点一次换下一档 (笔上不做弹层, 循环取值最省触摸步数) -->
            <div v-else-if="r.t === 'choice'" class="ctl" :style="pillStyle()">
              <text class="ct" :style="pillText(false)">{{ choiceLabel(r) }}</text>
              <image class="cic" :src="MIc.chevron" :style="{ width: '16px', height: '16px', marginLeft: '2px' }"></image>
            </div>

            <!-- 数值: 点一次加一个步长, 超上限回到最小值 -->
            <div v-else-if="r.t === 'number'" class="ctl" :style="pillStyle()">
              <text class="ct" :style="pillText(false)">{{ numLabel(r) }}</text>
            </div>

            <!-- 输入: 点击唤起系统输入法 (services/ime.js 的 createIME) -->
            <div v-else-if="r.t === 'input'" class="ctl" :style="pillStyle()">
              <text class="ct" :lines="1" :style="pillText(true)">{{ inputLabel(r) }}</text>
            </div>

            <div v-else-if="r.t === 'action'" class="ctl" :style="pillStyle()">
              <text class="ct" :style="pillText(r.danger === true)">{{ r.actText || '执行' }}</text>
            </div>
            <div v-else-if="r.t === 'go'" class="ctl" :style="pillStyle()">
              <text class="ct" :style="pillText(false)">{{ goLabel(r) }}</text>
              <image class="cic" :src="MIc.chevron" :style="{ width: '16px', height: '16px', marginLeft: '2px' }"></image>
            </div>

            <!-- 纯文本行 (版本 / appid / 路径) -->
            <text v-else class="rval" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ r.value || '' }}</text>
          </div>

          <!-- 表情预览: 用于上机确认 emoji 字体是否生效 (装了字体才会出现彩色 emoji) -->
          <div v-if="curGroup.id === 'emoji'" class="eprev"
               :style="{ flexDirection: 'row', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }">
            <RichText :text="emojiPreview" :size="17" :color="U.c.onSurface" :lines="0" :drop-emoji="false" />
          </div>

          <!-- 主题色板: 全部取自 design/tokens.js 的 SEEDS, 点选写回 themeSeed -->
          <div v-if="curGroup.id === 'appearance'" class="seeds" :style="{ flexDirection: 'row', flexWrap: 'wrap', marginTop: '6px' }">
            <div v-for="s in seeds" :key="s.id" class="seed" :style="seedOuter(s)" @click="onSeed(s)">
              <div class="seedin" :style="seedInner(s)">
                <image v-if="s.id === vals.themeSeed" class="sck" :src="s.dark ? MIc.checkW : MIc.checkD" :style="{ width: '18px', height: '18px' }"></image>
              </div>
            </div>
          </div>
        </div>
      </scroller>
    </div>

    <!-- 轻提示 (框架无 toast; 页内小条, 只做 transform 过渡) -->
    <div v-if="tip !== ''" class="tip"
         :style="{ position: 'absolute', left: '250px', bottom: '8px', width: '460px', height: '40px', justifyContent: 'center', alignItems: 'center', backgroundColor: U.c.inverseSurface, borderRadius: U.rad.chip + 'px' }">
      <text class="tipt" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.inverseOnSurface }">{{ tip }}</text>
    </div>
  </div>
</template>

<script>
// 设置页 —— 对齐 PiliNara lib/pages/setting/view.dart 的横屏形态:
//   左列分组 (Expanded flex:4) + 分隔线 + 右列「行 + 右侧控件」(Expanded flex:6).
//   行字典与 core/feature.js 完全一致 (switch / choice / number / input / go / action / text),
//   功能分组直接消费 settingsGroups() —— 新功能加设置不需要改本页.
//   改值后立刻 this.U = ui(), 颜色/字号/圆角即时生效 (笔上没有 CSS 变量).
import { ui } from '../../design/ui.js'
import { SEEDS, SCREEN } from '../../design/tokens.js'
import { getCfg, setCfg, allCfg, specOf } from '../../core/config.js'
import { settingsGroups } from '../../features/index.js'
import { clearSearchHistory, getSearchHistory } from '../../core/store.js'
import { setLogLevel, log } from '../../core/log.js'
import { appId, dataDir, logPath } from '../../core/paths.js'
import { createIME } from '../../services/ime.js'
import * as sysFont from '../../services/system-font.js'
import * as audio from '../../services/audio.js'
import RichText from '../../components/rich-text.vue'

const MI = {
  back: require('../../assets/mi/back_26_w.png'),
  chevron: require('../../assets/mi/chevron_20_m.png'),
  checkW: require('../../assets/mi/check_20_w.png'),
  checkD: require('../../assets/mi/check_20_d.png')
}
const MI_D = {
  back: require('../../assets/mi/back_26_d.png'),
  chevron: require('../../assets/mi/chevron_20_m.png'),
  checkW: require('../../assets/mi/check_20_w.png'),
  checkD: require('../../assets/mi/check_20_d.png')
}

const VERSION = '1.0.0'                 // 与 package.json 的 version 一致
const APPID = '8009476000000001'        // 与 package.json 的 appid 一致
const TIP_MS = 2000

// 基础分组: 键名与取值域全部来自 core/config.js 的 SPEC
const BASE_GROUPS = [
  {
    id: 'appearance',
    title: '外观',
    rows: [
      { k: 'themeSeed', t: 'seeds', label: '主题色', desc: '取自 design/tokens.js 的 SEEDS' },
      { k: 'themeMode', t: 'choice', label: '明暗模式', opts: [['dark', '深色'], ['light', '浅色'], ['auto', '跟随系统']] },
      { k: 'pureBlack', t: 'switch', label: '纯黑背景', desc: '深色模式下底色压成 #000' },
      { k: 'radiusStyle', t: 'choice', label: '圆角风格', opts: [['flat', '方角'], ['std', '标准'], ['round', '圆润']] },
      { k: 'density', t: 'choice', label: '列表密度', opts: [['compact', '紧凑'], ['std', '标准'], ['cozy', '宽松']] },
      { k: 'fontScale', t: 'choice', label: '字号', opts: [['sm', '小'], ['std', '标准'], ['lg', '大']] }
    ]
  },
  {
    id: 'play',
    title: '播放',
    rows: [
      { k: 'defaultRate', t: 'choice', label: '默认倍速', opts: [[0.5, '0.5x'], [0.75, '0.75x'], [1, '1x'], [1.25, '1.25x'], [1.5, '1.5x'], [2, '2x']] },
      { k: 'resumePlay', t: 'switch', label: '断点续播', desc: '从上次离开的位置开始' },
      { k: 'skipIntroSec', t: 'number', label: '跳片头', desc: '起播时跳过开头若干秒', step: 5, unit: '秒' },
      { k: 'keepAwake', t: 'switch', label: '播放防息屏', desc: '播放期间定时唤醒屏幕' }
    ]
  },
  {
    id: 'audio',
    title: '音频',
    rows: [
      { k: 'audioRoute', t: 'choice', label: '输出设备', opts: [['auto', '自动'], ['speaker', '扬声器'], ['bluetooth', '蓝牙']] },
      { k: 'audioPreempt', t: 'switch', label: '自动抢占音频', desc: '起播时停掉其它应用的播放 (系统无音频焦点 API, 用全局停止实现)' },
      { k: 'btScan', t: 'action', label: '已连接蓝牙', desc: '点右侧刷新', actText: '刷新' },
      { t: 'text', label: '蓝牙状态', value: '' }
    ]
  },
  {
    id: 'emoji',
    title: '表情字体',
    rows: [
      { t: 'text', label: '说明', value: '系统字体无 emoji 字形' },
      { k: 'emojiInstall', t: 'action', label: '安装 emoji 字体', desc: '绑定挂载, 不改只读分区', actText: '安装' },
      { k: 'emojiRemove', t: 'action', label: '卸载 emoji 字体', desc: '恢复系统原样', actText: '卸载', danger: true },
      { k: 'emojiRestart', t: 'action', label: '重启应用生效', desc: '框架启动时读字体表', actText: '重启' },
      { t: 'text', label: '当前状态', value: '' }
    ]
  },
  {
    id: 'net',
    title: '网络',
    rows: [
      { k: 'httpTimeout', t: 'number', label: '请求超时', desc: '弱网下可调大', step: 5, unit: '秒' },
      { k: 'imgQuality', t: 'choice', label: '图片质量', opts: [['low', '省流'], ['std', '标准'], ['high', '高清']] },
      { k: 'showStat', t: 'switch', label: '显示播放量', desc: '封面右下角的播放量角标' },
      { k: 'autoLoadComments', t: 'switch', label: '自动加载评论', desc: '进详情页就拉第一页评论' }
    ]
  },
  {
    id: 'data',
    title: '数据',
    rows: [
      { k: 'clearSearchHist', t: 'action', label: '清理搜索历史', desc: '当前共 0 条', actText: '清理' }
    ]
  },
  {
    id: 'about',
    title: '关于',
    rows: [
      { t: 'text', label: '版本', value: 'PiliPRO ' + VERSION },
      { t: 'text', label: 'appid', value: APPID },
      { t: 'text', label: '日志路径', value: '' },
      { t: 'text', label: '数据目录', value: '' },
      { k: 'logLevel', t: 'choice', label: '日志级别', desc: '调试档会把网络细节写进日志', opts: [['off', '关闭'], ['error', '仅错误'], ['info', '常规'], ['debug', '调试']] }
    ]
  }
]

export default {
  name: 'settings',
  components: { RichText },
  data() {
    return {
      // 表情预览: 覆盖中文混排/肤色/ZWJ 组合/星形与箭头 (设备字体缺的那些)
      emojiPreview: '中文混排 😀👍 组合 👨‍👩‍👧 爱心 ❤️ 星 ⭐ 箭头 → 手势 🎉 音符 🎵',
      _btPower: null,
      _btList: [],
      U: ui(),
      S: SCREEN,
      vals: {},
      groups: [],
      gid: 'appearance',
      seeds: [],
      tip: ''
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    curGroup() {
      for (let i = 0; i < this.groups.length; i++) if (this.groups[i].id === this.gid) return this.groups[i]
      return this.groups.length ? this.groups[0] : { id: '', title: '', rows: [] }
    }
  },
  methods: {
    // ---- 生命周期 (项目约定: 只有 onShow / onPageUnload 会被转发) ----
    mounted() {
      // Vue2 不代理 data 里以 _ 开头的键, 计时器/输入法句柄显式初始化 (与 mine.vue 同一约定)
      this._tipTimer = null
      this._ime = null
      this.build()
    },
    onShow() {
      this.U = ui()
      this.build()
    },
    onPageUnload() {
      if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null }
      // 输入法会话必须显式销毁: 设备上残留会话会叠加 (services/ime.js 的契约)
      if (this._ime) { try { this._ime.destroy() } catch (e) {} this._ime = null }
    },

    /** 组装分组: 基础分组 + 功能分组 (core/feature.js 的 settingsGroups) */
    build() {
      this.vals = allCfg()
      const out = []
      let i
      for (i = 0; i < BASE_GROUPS.length; i++) out.push(this.cloneGroup(BASE_GROUPS[i]))
      const fg = settingsGroups() || []
      for (i = 0; i < fg.length; i++) {
        out.push(this.cloneGroup({ id: fg[i].id, title: fg[i].title, rows: fg[i].rows || [] }))
      }
      this.groups = out
      // 主题色板 (SEEDS 是唯一来源, 页面不另写色值)
      const seeds = []
      for (i = 0; i < SEEDS.length; i++) {
        seeds.push({ id: SEEDS[i][0], hex: SEEDS[i][1], name: SEEDS[i][2], dark: darkOfHex(SEEDS[i][1]) })
      }
      this.seeds = seeds
      let found = false
      for (i = 0; i < out.length; i++) if (out[i].id === this.gid) found = true
      if (!found && out.length) this.gid = out[0].id
      this.patchDynamic()
    },
    /** 行的浅拷贝 (功能分组注册的行对象是共享的, 不能就地改) */
    cloneGroup(g) {
      const rows = []
      for (let i = 0; i < (g.rows || []).length; i++) {
        const r = g.rows[i]
        const o = {}
        for (const k in r) if (r.hasOwnProperty(k)) o[k] = r[k]
        if (o.t === undefined) o.t = 'switch'
        rows.push(o)
      }
      return { id: g.id, title: g.title, rows: rows }
    },
    /** 关于/数据分组里的动态值 (路径随固件与 appid 变, 计数随使用变) */
    patchDynamic() {
      const about = this.groupById('about')
      if (about) {
        for (let i = 0; i < about.rows.length; i++) {
          const r = about.rows[i]
          if (r.label === '日志路径') r.value = safeCall(logPath) || '(未知)'
          if (r.label === '数据目录') r.value = safeCall(dataDir) || '(未知)'
          if (r.label === 'appid') r.value = safeCall(appId) || APPID
        }
      }
      const emoji = this.groupById('emoji')
      if (emoji) {
        for (let i = 0; i < emoji.rows.length; i++) {
          const r = emoji.rows[i]
          if (r.label === '当前状态') r.value = this.emojiStatusText()
          if (r.k === 'emojiInstall' || r.k === 'emojiRemove') {
            const st = sysFont.status()
            r.desc = st.mounted ? '绑定挂载, 不改只读分区' : '安装后所有应用的 emoji 都能显示'
          }
        }
      }
      const audioG = this.groupById('audio')
      if (audioG) {
        for (let i = 0; i < audioG.rows.length; i++) {
          const r = audioG.rows[i]
          if (r.label === '蓝牙状态') r.value = this.btStatusText()
        }
      }
      const data = this.groupById('data')
      if (data) {
        for (let i = 0; i < data.rows.length; i++) {
          if (data.rows[i].k === 'clearSearchHist') {
            const n = (getSearchHistory(50) || []).length
            data.rows[i].desc = '当前共 ' + n + ' 条'
          }
        }
      }
    },
    groupById(id) {
      for (let i = 0; i < this.groups.length; i++) if (this.groups[i].id === id) return this.groups[i]
      return null
    },
    pickGroup(g) {
      if (!g || g.id === this.gid) return
      this.gid = g.id
      this.refreshGroup()
    },
    /** 重新取当前分组的一份克隆 (改值后行文案要跟着变) */
    refreshGroup() {
      this.vals = allCfg()
      const src = BASE_GROUPS.concat((settingsGroups() || []).map(function (x) {
        return { id: x.id, title: x.title, rows: x.rows || [] }
      }))
      for (let i = 0; i < src.length; i++) {
        if (src[i].id !== this.gid) continue
        const idx = this.indexOfGroup(this.gid)
        if (idx >= 0) this.groups.splice(idx, 1, this.cloneGroup(src[i]))
        break
      }
      this.patchDynamic()
    },
    indexOfGroup(id) {
      for (let i = 0; i < this.groups.length; i++) if (this.groups[i].id === id) return i
      return -1
    },

    // ---- 行交互 ----
    onRow(r) {
      if (!r) return
      if (r.t === 'seeds') { this.showTip('点下面色板换主题色'); return }
      if (r.t === 'text' || r.t === 'go') return
      if (r.t === 'action') { this.runAction(r); return }
      if (r.t === 'input') { this.openInput(r); return }
      if (r.k === undefined) return
      if (r.t === 'switch') { this.apply(r.k, getCfg(r.k) !== true); return }
      if (r.t === 'choice') { this.apply(r.k, this.nextChoice(r)); return }
      if (r.t === 'number') { this.apply(r.k, this.nextNumber(r)); return }
    },
    nextChoice(r) {
      const opts = r.opts || []
      if (!opts.length) return getCfg(r.k)
      const cur = String(getCfg(r.k))
      for (let i = 0; i < opts.length; i++) {
        if (String(opts[i][0]) === cur) return opts[(i + 1) % opts.length][0]
      }
      return opts[0][0]
    },
    nextNumber(r) {
      const spec = specOf(r.k)
      const step = Number(r.step) || 1
      const isInt = !!(spec && spec[1] === 'int')
      const min = isInt ? spec[2][0] : 0
      const max = isInt ? spec[2][1] : 999999
      let v = Number(getCfg(r.k)) || 0
      v = v + step
      if (v > max) v = min
      if (v < min) v = min
      return v
    },
    /** 写设置 -> 立刻重算一整套 token (颜色/字号/圆角即时生效) */
    apply(k, v) {
      try { setCfg(k, v) } catch (e) { this.showTip('写入失败'); return }
      if (k === 'logLevel') { try { setLogLevel(getCfg('logLevel')) } catch (e) {} }
      this.U = ui()
      this.refreshGroup()
      log('设置', '已改 ' + k + ' = ' + String(getCfg(k)))
    },
    onSeed(s) {
      if (!s) return
      this.apply('themeSeed', s.id)
      this.showTip('主题色: ' + s.name)
    },
    // ---- 表情字体: 一键安装 / 卸载 / 重启 ----
    async emojiInstall() {
      this.showTip('正在安装…')
      const r = await sysFont.install()
      this.showTip(r.msg)
      this.refreshGroup()
      log('设置', 'emoji 字体安装: ' + r.msg)
    },
    async emojiRemove() {
      this.showTip('正在卸载…')
      const r = await sysFont.remove()
      this.showTip(r.msg)
      this.refreshGroup()
      log('设置', 'emoji 字体卸载: ' + r.msg)
    },
    emojiRestart() {
      if (sysFont.restartApp()) { return }
      this.showTip('当前固件不支持自动重启, 请手动重开应用')
    },
    emojiStatusText() {
      const st = sysFont.status()
      if (!st.available) return '不可用 (缺 execAsync)'
      if (!st.fontBundled) return '安装包缺字体'
      return st.mounted ? '已安装 (重启后生效)' : '未安装'
    },

    // ---- 音频: 蓝牙枚举 / 路由 ----
    async btScan() {
      this.showTip('正在扫描蓝牙…')
      const [power, list] = await Promise.all([audio.btPowerState(), audio.btDevices()])
      this._btPower = power
      this._btList = list
      this.refreshGroup()
      this.showTip(list.length ? ('找到 ' + list.length + ' 个已连接设备') : (power === 'off' ? '蓝牙未开启' : '没有已连接的蓝牙设备'))
      log('设置', '蓝牙扫描: power=' + power + ' devices=' + list.length)
    },
    btStatusText() {
      const power = this._btPower
      if (power == null) return '未扫描'
      if (power === 'off') return '未开启'
      const list = this._btList || []
      if (!list.length) return '已开启, 无连接设备'
      return list.map(function (d) { return d.name }).join(' / ').slice(0, 40)
    },

    runAction(r) {
      if (r.k === 'emojiInstall') { this.emojiInstall(); return }
      if (r.k === 'emojiRemove') { this.emojiRemove(); return }
      if (r.k === 'emojiRestart') { this.emojiRestart(); return }
      if (r.k === 'btScan') { this.btScan(); return }
      if (r.k === 'clearSearchHist') {
        try { clearSearchHistory() } catch (e) {}
        this.refreshGroup()
        this.showTip('搜索历史已清理')
        log('设置', '已清理搜索历史')
        return
      }
      const fn = r.act ? this[r.act] : null
      if (typeof fn === 'function') {
        try { fn.call(this) } catch (e) {}
        return
      }
      this.showTip('该操作暂不可用')
    },

    // ---- 输入行: 唤起系统输入法 (只读行 + 提示的旧方案已废弃, services/ime.js 已可用) ----
    async openInput(r) {
      if (!this._ime) this._ime = createIME()
      const spec = specOf(r.k)
      let cur = ''
      try { cur = String(getCfg(r.k) == null ? '' : getCfg(r.k)) } catch (e) {}
      let text = null
      try {
        text = await this._ime.open({
          text: cur,
          placeholder: r.label,
          maxlength: (spec && spec[1] === 'str') ? spec[2][0] : 64,
          enterButtonText: '确定'
        })
      } catch (e) {
        this.showTip('系统输入法唤不起来: ' + (e && e.message ? e.message : String(e)))
        return
      }
      if (text === null) return      // 用户取消 / 输入法不可用
      this.apply(r.k, String(text))
    },

    // ---- 展示 ----
    choiceLabel(r) {
      const opts = r.opts || []
      const cur = String(getCfg(r.k))
      for (let i = 0; i < opts.length; i++) if (String(opts[i][0]) === cur) return opts[i][1]
      return opts.length ? opts[0][1] : '--'
    },
    numLabel(r) {
      const v = getCfg(r.k)
      if (typeof r.fmt === 'function') {
        try { return String(r.fmt(v)) } catch (e) {}
      }
      return String(v) + (r.unit ? ' ' + r.unit : '')
    },
    inputLabel(r) {
      const v = getCfg(r.k)
      const s = String(v == null ? '' : v)
      if (s === '') return '未设置'
      return s.length > 12 ? s.substring(0, 12) + '…' : s
    },
    goLabel(r) {
      if (typeof r.val === 'function') {
        try { const v = r.val(); return v == null || v === '' ? '打开' : String(v) } catch (e) {}
      }
      return r.valText || '打开'
    },

    // ---- 样式 (颜色只来自 U.c 与 SEEDS 色板) ----
    groupStyle(g) {
      const on = g.id === this.gid
      return {
        height: '44px',
        marginLeft: '8px',
        marginRight: '8px',
        marginBottom: '2px',
        paddingLeft: '12px',
        paddingRight: '12px',
        justifyContent: 'center',
        borderRadius: this.U.rad.chip + 'px',
        backgroundColor: on ? this.U.c.primaryContainer : 'rgba(0,0,0,0)'
      }
    },
    groupText(g) {
      const on = g.id === this.gid
      return {
        fontSize: this.U.f.body + 'px',
        color: on ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    },
    rowStyle(r) {
      return {
        height: (r.desc ? 56 : 48) + 'px',
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: '4px',
        paddingLeft: '10px',
        paddingRight: '2px',
        borderRadius: this.U.rad.card + 'px',
        backgroundColor: this.U.c.surfaceContainerLow
      }
    },
    switchStyle(k) {
      const on = getCfg(k) === true
      return {
        width: '44px',
        height: '26px',
        borderRadius: '13px',
        justifyContent: 'center',
        backgroundColor: on ? this.U.c.primary : this.U.c.surfaceContainerHighest
      }
    },
    knobStyle(k) {
      const on = getCfg(k) === true
      return {
        width: '20px',
        height: '20px',
        borderRadius: '10px',
        marginLeft: '3px',
        backgroundColor: on ? this.U.c.onPrimary : this.U.c.onSurfaceVariant,
        // 本机 CSS 只支持 transform 过渡: 开关位移用 translateX
        transform: on ? 'translateX(18px)' : 'translateX(0px)',
        transitionProperty: 'transform',
        transitionDuration: '120ms'
      }
    },
    pillStyle() {
      return {
        minWidth: '84px',
        height: '44px',
        paddingLeft: '12px',
        paddingRight: '10px',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: this.U.rad.btn + 'px',
        backgroundColor: this.U.c.surfaceContainerHighest
      }
    },
    pillText(disabled) {
      return {
        fontSize: this.U.f.caption + 'px',
        color: disabled ? this.U.c.onSurfaceVariant : this.U.c.onSurface
      }
    },
    seedOuter(s) {
      const on = s.id === this.vals.themeSeed
      return {
        width: '48px',
        height: '48px',
        marginRight: '6px',
        marginBottom: '6px',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: this.U.rad.chip + 'px',
        // 选中态用一圈 onSurface 底衬做出描边效果 (本机 CSS 不做 border)
        backgroundColor: on ? this.U.c.onSurface : 'rgba(0,0,0,0)'
      }
    },
    seedInner(s) {
      return {
        width: '40px',
        height: '40px',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: this.U.rad.chip + 'px',
        backgroundColor: s.hex
      }
    },

    // ---- 导航 / 提示 ----
    goBack() {
      try { this.$page.finish() } catch (e) {
        try { $falcon.navTo('mine', {}) } catch (e2) {}
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

/** 安全调用取值函数 (路径/信息类, 固件不同可能取不到) */
function safeCall(fn) {
  try {
    const v = typeof fn === 'function' ? fn() : ''
    return String(v == null ? '' : v)
  } catch (e) { return '' }
}

/** 色值明暗判断 (决定色板对勾用白还是黑) */
function darkOfHex(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length < 6) return false
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return (r * 299 + g * 587 + b * 114) / 1000 < 140
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; flex-direction: column; }
.head { flex-direction: row; align-items: center; }
.body { flex-direction: row; }
.gnav { }
.grow { flex-direction: row; align-items: center; }
.rows { }
.rl { flex-direction: column; }
.row { }
.rtext { }
.tip { }
</style>
