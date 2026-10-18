<template>
  <div class="page" :style="{ backgroundColor: U.c.surface }">
    <!-- 左区: 顶栏 + 模式切换 + 状态. 电脑同步模式铺满全宽 (无二维码, 不留空白) -->
    <div class="left" :class="mode === 'pc' ? 'left-full' : ''" :style="{ backgroundColor: U.c.surface }">
      <div class="topbar" :class="mode === 'pc' ? 'topbar-full' : ''">
        <div class="back" :style="{ width: '44px', height: '44px' }" @click="goBack">
          <image class="bic" :src="MIc.back" :style="{ width: '24px', height: '24px' }"></image>
        </div>
        <text class="title" :lines="1" :style="U.t.title">登录哔哩哔哩</text>
        <div class="grow"></div>
        <text v-if="account" class="acc" :lines="1" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ accText }}</text>
        <div v-if="account" class="logout" :style="{ height: '44px' }" @click="doLogout">
          <text class="logoutt" :style="{ fontSize: U.f.caption + 'px', color: U.c.primary }">退出登录</text>
        </div>
      </div>

      <div class="modes">
        <div class="mtab" :style="tabStyle('qr')" @click="switchMode('qr')">
          <text class="mtabt" :style="tabTextStyle('qr')">扫码登录</text>
        </div>
        <div class="mtab" :style="tabStyle('pc')" @click="switchMode('pc')">
          <text class="mtabt" :style="tabTextStyle('pc')">电脑同步</text>
        </div>
      </div>

      <!-- 扫码状态 -->
      <div v-if="mode === 'qr'" class="qr-status">
        <text class="st" :lines="1" :style="stateStyle">{{ stateText }}</text>
        <text class="st2" :lines="2" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ qrHint }}</text>
        <div v-if="showQrBtn" class="btn" :style="{ backgroundColor: U.c.primary, borderRadius: U.rad.chip + 'px', height: '44px' }" @click="refreshOrDone">
          <text class="btnt" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">{{ qrBtnText }}</text>
        </div>
      </div>

      <!-- 电脑同步: 步骤说明 + IP 输入 + 获取并登录 -->
      <div v-else class="pc-wrap">
        <scroller class="pc-scroll" scroll-direction="vertical" :show-scrollbar="true">
          <text class="pc-step" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">① 电脑与词典笔连同一个 WiFi; 电脑上运行 tools/pc-cookie-server.py, 记下它打印的局域网地址。</text>
          <text class="pc-step" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">② 电脑浏览器打开 http://127.0.0.1:9527, 粘贴 B 站 Cookie 整行 (含 SESSDATA), 点保存。</text>
          <text class="pc-step" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">③ 取得方法: 电脑浏览器登录 bilibili.com → F12 → Network → 任一 api 请求 → 复制 Cookie 行。</text>
          <div class="pc-input" :style="{ backgroundColor: U.c.surfaceContainerHighest, borderRadius: U.rad.card + 'px', height: '44px' }" @click="inputIp">
            <text class="pc-inputt" :lines="1" :style="pcIp === '' ? U.t.weak : U.t.body">{{ pcIp === '' ? '点击输入电脑 IP (如 192.168.1.100)' : pcIp }}</text>
          </div>
          <div class="btn" :style="{ backgroundColor: U.c.primary, borderRadius: U.rad.chip + 'px', height: '44px' }" @click="fetchFromPc">
            <text class="btnt" :style="{ fontSize: U.f.body + 'px', color: U.c.onPrimary }">{{ fetching ? '获取中…' : '获取并登录' }}</text>
          </div>
          <text v-if="pcStatus !== ''" class="pc-status" :lines="2" :style="{ fontSize: U.f.caption + 'px', color: pcOk ? U.c.primary : U.c.error }">{{ pcStatus }}</text>
          <text class="pc-warn" :lines="2" :style="{ fontSize: U.f.tiny + 'px', color: U.c.onSurfaceVariant }">安全提示: Cookie 等同于登录凭证, 只在本机与笔之间传输; 用完请在电脑上按 Ctrl+C 关闭该服务。</text>
        </scroller>
      </div>
    </div>

    <!-- 右区: 二维码 (本地编码, div 画矩阵; 不依赖任何外部图片服务) -->
    <div v-if="mode === 'qr'" class="qr-zone" :style="{ backgroundColor: U.c.surfaceContainerHighest }">
      <div v-if="qr !== null" class="qr-box" :style="boxStyle">
        <div v-for="(d, i) in qrRuns" :key="i" class="qr-dark" :style="runStyle(d)"></div>
        <div v-if="pollState === 'expired' || pollState === 'error'" class="qr-mask" :style="maskStyle" @click="startQr">
          <text class="qm-t" :style="{ fontSize: U.f.body + 'px', color: '#000000' }">{{ pollState === 'expired' ? '已过期' : '出错了' }}</text>
          <text class="qm-s" :style="{ fontSize: U.f.caption + 'px', color: U.c.primary }">点此刷新</text>
        </div>
        <div v-else-if="pollState === 'ok'" class="qr-mask" :style="maskStyle">
          <!-- 遮罩恒为白底, 对勾固定用深色图标 (深色主题下白色图标在白底上不可见) -->
          <image class="qm-ic" :src="MI_CHECK" :style="{ width: '24px', height: '24px' }"></image>
        </div>
      </div>
      <text v-else class="qr-ph" :style="{ fontSize: U.f.caption + 'px', color: U.c.onSurfaceVariant }">{{ qrErr !== '' ? '生成失败' : '生成中…' }}</text>
    </div>
  </div>
</template>

<script>
// 登录页 —— 两种方式, 与 bilibilipan 同能力, 代码全新:
//   ① 扫码登录: qrGenerate/qrPoll (Web 链路) + 本地二维码编码 (services/qrcode.js)
//      B 站登录 url 实测 131 字节 -> M 级版本 8 (49x49 模块), 所以二维码区按整屏高 266 布局,
//      模块边长算到 4px (含 4 模块静默区), 保证手机能扫出来.
//   ② 电脑同步: 电脑跑 tools/pc-cookie-server.py, 笔端按 IP 拉取 Cookie
//      (端口 9527 + 路径 /pilipro/cookie 是对外契约)
// 登录成功后显示昵称/UID, 并可直接退出登录.
import { ui } from '../../design/ui.js'
import { qrGenerate, qrPoll, fetchPcCookie, nav } from '../../services/api.js'
import { qrcodeMatrix } from '../../services/qrcode.js'
import { createIME } from '../../services/ime.js'
import { saveLogin, clearLogin, updateProfile, authState } from '../../core/auth.js'
import { log } from '../../core/log.js'

const POLL_MS = 2000          // 轮询周期 (PiliNara 同档)
const QR_TTL_MS = 180000      // 二维码有效期 3 分钟
const QR_ZONE_W = 280         // 右区宽度
const QR_MAX_H = 250          // 二维码白盒可用高 (266 - 上下各 8)

const MI = {
  back: require('../../assets/mi/back_26_w.png')
}
const MI_D = {
  back: require('../../assets/mi/back_26_d.png')
}
// 二维码成功遮罩恒为白底 -> 对勾固定深色版
const MI_CHECK = require('../../assets/mi/check_20_d.png')

export default {
  name: 'login',
  data() {
    return {
      U: ui(),
      MI: MI,
      MI_CHECK: MI_CHECK,
      mode: 'qr',
      qr: null,
      qrRuns: [],
      qrErr: '',
      qbW: 0,
      qbH: 0,
      qbLeft: 0,
      qbTop: 0,
      qrcodeKey: '',
      qrAt: 0,
      pollState: 'idle',   // idle/generating/waiting/scanned/ok/expired/error
      pollError: '',
      pcIp: '',
      pcStatus: '',
      pcOk: false,
      fetching: false,
      account: null,
      _gen: 0,        // 二维码/轮询世代
      _accGen: 0,     // 账号校验世代 (与二维码分开, 免得互相作废)
      _poll: null,
      _ime: null,
      _unloaded: false
    }
  },
  computed: {
    MIc() { return this.U.dark ? MI : MI_D },
    accText() {
      const a = this.account
      if (!a) return ''
      const uid = a.mid || a.dedeUserId || ''
      return (a.uname || '已登录') + (uid ? ' · UID ' + uid : '') + (a.level ? ' · Lv' + a.level : '')
    },
    boxStyle() {
      return { left: this.qbLeft + 'px', top: this.qbTop + 'px', width: this.qbW + 'px', height: this.qbH + 'px' }
    },
    maskStyle() {
      return { width: this.qbW + 'px', height: this.qbH + 'px', backgroundColor: 'rgba(255,255,255,0.92)' }
    },
    stateText() {
      if (this.pollState === 'generating') return '正在生成二维码…'
      if (this.pollState === 'waiting') return '等待扫描中…'
      if (this.pollState === 'scanned') return '已扫描, 请在手机上确认'
      if (this.pollState === 'ok') return '登录成功'
      if (this.pollState === 'expired') return '二维码已过期'
      if (this.pollState === 'error') return this.pollError || '出错了'
      return '用手机 B 站 App 扫右侧二维码'
    },
    stateStyle() {
      const okState = this.pollState === 'ok' || this.pollState === 'scanned'
      return { fontSize: this.U.f.body + 'px', color: okState ? this.U.c.primary : this.U.c.onSurface }
    },
    qrHint() {
      if (this.pollState === 'ok') return '再用一次登录态校验, 就能看到昵称与 UID'
      return '手机 B 站 → 扫一扫 → 确认登录 · 二维码 3 分钟内有效'
    },
    showQrBtn() {
      return this.pollState === 'expired' || this.pollState === 'error' || this.pollState === 'ok'
    },
    qrBtnText() {
      return this.pollState === 'ok' ? '完成, 返回' : '刷新二维码'
    }
  },
  mounted() {
    this.syncAccount()
    this.maybeStartQr()
  },
  methods: {
    onShow() {
      this.U = ui()
      this.maybeStartQr()
      this.syncAccount()
    },

    /** 二维码懒启动 (mounted 与 onShow 都会调; 有守卫, 不会重复生成) */
    maybeStartQr() {
      if (this.mode !== 'qr') return
      if (this.pollState === 'generating' || this.pollState === 'waiting' || this.pollState === 'scanned') return
      if (this.qr === null) this.startQr()
    },
    onPageUnload() {
      this._unloaded = true
      this._gen++
      this._accGen++
      this.stopPoll()
      if (this._ime) { try { this._ime.destroy() } catch (e) {} this._ime = null }
    },

    goBack() {
      try { this.$page.finish() } catch (e) {}
    },

    switchMode(m) {
      if (this.mode === m) return
      this.mode = m
      if (m === 'qr') {
        if (this.pollState === 'waiting' || this.pollState === 'scanned') this.startPoll()
        else this.maybeStartQr()
      } else {
        this.stopPoll()   // 电脑同步模式没有二维码, 停了省请求
      }
    },

    // ---------------- 扫码登录 ----------------
    startQr() {
      this.stopPoll()
      this.pollState = 'generating'
      this.pollError = ''
      this.qrErr = ''
      this.qr = null
      this.qrRuns = []
      this.qrcodeKey = ''
      const gen = ++this._gen
      const self = this
      // 首帧之后再做网络请求 (同步 http 会阻塞 JS 线程)
      setTimeout(function () {
        qrGenerate().then(function (r) {
          if (self._unloaded || gen !== self._gen) return
          self.qrcodeKey = r.key
          self.qrAt = Date.now()
          self.buildQr(r.url)
          self.pollState = self.qr === null ? 'error' : 'waiting'
          if (self.pollState === 'waiting') self.startPoll()
        }).catch(function (e) {
          if (self._unloaded || gen !== self._gen) return
          self.qrErr = e && e.message ? e.message : String(e)
          self.pollState = 'error'
          self.pollError = '生成失败: ' + self.qrErr
          log('登录', '二维码生成失败: ' + self.qrErr)
        })
      }, 50)
    },

    /** url -> 矩阵 -> 渲染块 (只把暗模块按行合并成游程, 节点数从 2401 降到约 600) */
    buildQr(url) {
      try {
        const m = qrcodeMatrix(url)
        const size = m.size
        // 白盒边长: (模块数 + 静默区 4*2) * 模块边长, 取能塞进右区的最大整数边长
        const mod = Math.max(2, Math.floor(QR_MAX_H / (size + 8)))
        const w = (size + 8) * mod
        this.qbW = w
        this.qbH = w
        this.qbLeft = Math.round((QR_ZONE_W - w) / 2)
        this.qbTop = Math.round((266 - w) / 2)
        this.qr = m
        this.qrRuns = buildRuns(m.rows, size, mod)
        log('登录', '二维码 v' + m.version + ' ' + size + 'x' + size + ' 模块边长 ' + mod + 'px')
      } catch (e) {
        this.qrErr = e && e.message ? e.message : String(e)
        this.qr = null
        this.qrRuns = []
        log('登录', '本地编码失败: ' + this.qrErr)
      }
    },

    startPoll() {
      this.stopPoll()
      const self = this
      this._poll = setInterval(function () { self.pollOnce() }, POLL_MS)
    },

    stopPoll() {
      if (this._poll != null) { clearInterval(this._poll); this._poll = null }
    },

    async pollOnce() {
      if (this.pollState !== 'waiting' && this.pollState !== 'scanned') return
      if (this.qrcodeKey === '') return
      if (Date.now() - this.qrAt > QR_TTL_MS) {
        this.pollState = 'expired'
        this.stopPoll()
        return
      }
      const gen = this._gen
      try {
        const r = await qrPoll(this.qrcodeKey)
        if (this._unloaded || gen !== this._gen) return
        if (r.state === 'ok') {
          this.stopPoll()
          const ok = saveLogin({ sessdata: r.cookie.sessdata, biliJct: r.cookie.biliJct, dedeUserId: r.cookie.dedeUserId })
          if (ok) {
            this.pollState = 'ok'
            log('登录', '扫码登录成功 uid=' + r.cookie.dedeUserId)
            this.syncAccount()
          } else {
            this.pollState = 'error'
            this.pollError = '登录态保存失败 (缺少 SESSDATA)'
          }
          return
        }
        if (r.state === 'expired') { this.stopPoll(); this.pollState = 'expired'; return }
        if (r.state === 'scanned') { this.pollState = 'scanned'; return }
        if (r.state === 'error') { this.stopPoll(); this.pollState = 'error'; this.pollError = r.message || '二维码失效' }
      } catch (e) {
        // 单次轮询失败容忍 (网络抖动), 由 3 分钟有效期兜底
        log('登录', '轮询失败: ' + (e && e.message ? e.message : e))
      }
    },

    refreshOrDone() {
      if (this.pollState === 'ok') { this.goBack(); return }
      this.startQr()
    },

    // ---------------- 电脑同步 ----------------
    async inputIp() {
      if (this._unloaded) return
      if (!this._ime) this._ime = createIME()
      let text = null
      try {
        text = await this._ime.open({
          text: this.pcIp,
          placeholder: '电脑局域网 IP, 如 192.168.1.100',
          maxlength: 15,
          inputType: 'EnUSPreferred',
          enterButtonText: '确定',
          confirmText: '确定'
        })
      } catch (e) {
        this.pcOk = false
        this.pcStatus = '输入法不可用: ' + (e && e.message ? e.message : e)
        return
      }
      if (this._unloaded || text === null) return
      this.pcIp = String(text).trim()
    },

    async fetchFromPc() {
      if (this.fetching) return
      if (this.pcIp === '') { this.pcOk = false; this.pcStatus = '请先输入电脑 IP'; return }
      const gen = this._gen
      this.fetching = true
      this.pcOk = false
      this.pcStatus = '正在从电脑获取…'
      try {
        const c = await fetchPcCookie(this.pcIp)
        if (this._unloaded || gen !== this._gen) return
        if (!saveLogin({ sessdata: c.sessdata, biliJct: c.biliJct, dedeUserId: c.dedeUserId })) {
          this.pcStatus = 'Cookie 缺少 SESSDATA, 保存失败'
          return
        }
        this.pcStatus = '已获取, 校验登录态…'
        const info = await nav()
        if (this._unloaded || gen !== this._gen) return
        if (info.isLogin) {
          updateProfile(info)
          this.account = authState()
          this.pcOk = true
          this.pcStatus = '登录成功: ' + (info.uname || '') + ' (UID ' + info.mid + ')'
          log('登录', '电脑同步登录成功 uid=' + info.mid)
        } else {
          this.pcStatus = 'Cookie 无效或已过期 (isLogin=false)'
        }
      } catch (e) {
        if (this._unloaded || gen !== this._gen) return
        this.pcStatus = e && e.message ? e.message : String(e)
        this.pcOk = false
      } finally {
        if (gen === this._gen) this.fetching = false
      }
    },

    // ---------------- 账号 ----------------
    /** 进页面就校验一次本地登录态 (nav), 有昵称就显示在顶栏右侧 */
    async syncAccount() {
      const gen = ++this._accGen
      const s = authState()
      if (s && s.sessdata) { this.account = s }
      try {
        const info = await nav()
        if (this._unloaded || gen !== this._accGen) return
        if (info.isLogin) {
          updateProfile(info)
          this.account = authState()
        } else {
          this.account = null
        }
      } catch (e) {
        // 网络不通时保留本地快照, 不误清登录态
      }
    },

    doLogout() {
      this._accGen++
      clearLogin()
      this.account = null
      this.pcStatus = ''
      this.pcOk = false
      log('登录', '已退出登录')
    },

    // ---------------- 样式 ----------------
    tabStyle(m) {
      const on = this.mode === m
      return {
        height: '44px',
        paddingLeft: '18px',
        paddingRight: '18px',
        marginRight: '12px',
        backgroundColor: on ? this.U.c.primaryContainer : this.U.c.surfaceContainerHighest,
        borderRadius: this.U.rad.chip + 'px'
      }
    },
    tabTextStyle(m) {
      const on = this.mode === m
      return {
        fontSize: this.U.f.body + 'px',
        color: on ? this.U.c.onPrimaryContainer : this.U.c.onSurfaceVariant
      }
    },
    runStyle(d) {
      const mod = this.qbW / (this.qr ? this.qr.size + 8 : 1)
      const pad = mod * 4
      return {
        left: Math.round(pad + d.left * mod) + 'px',
        top: Math.round(pad + d.top * mod) + 'px',
        width: Math.round(d.w * mod) + 'px',
        height: Math.round(mod) + 'px'
      }
    }
  }
}

/** 矩阵 -> 每行暗色游程 [{left, top, w}] (笔端节点数敏感, 必须合并) */
function buildRuns(rows, size, mod) {
  const out = []
  for (let r = 0; r < size; r++) {
    let c = 0
    while (c < size) {
      if (rows[r][c] === 1) {
        const start = c
        while (c < size && rows[r][c] === 1) c++
        out.push({ left: start, top: r, w: c - start })
      } else {
        c++
      }
    }
  }
  return out
}
</script>

<style scoped>
.page { position: absolute; left: 0px; top: 0px; width: 960px; height: 266px; }
.left { position: absolute; left: 0px; top: 0px; width: 680px; height: 266px; flex-direction: column; }
.left-full { width: 960px; }
.topbar { height: 44px; flex-direction: row; align-items: center; padding-left: 4px; }
.topbar-full { }
.back { justify-content: center; align-items: center; }
.bic { }
.title { margin-left: 6px; }
.grow { flex: 1; }
.acc { margin-right: 10px; }
.logout { justify-content: center; align-items: center; padding-left: 10px; padding-right: 12px; }
.logoutt { }

.modes { flex-direction: row; align-items: center; margin-left: 12px; margin-top: 8px; height: 44px; }
.mtab { justify-content: center; align-items: center; }
.mtabt { }

.qr-status { flex-direction: column; margin-left: 12px; margin-top: 10px; width: 656px; }
.st { }
.st2 { margin-top: 6px; }
.btn { margin-top: 12px; width: 220px; justify-content: center; align-items: center; }
.btnt { }

.pc-wrap { margin-left: 12px; margin-top: 8px; width: 936px; height: 158px; }
.pc-scroll { width: 936px; height: 158px; }
.pc-step { margin-bottom: 8px; }
.pc-input { justify-content: center; padding-left: 12px; padding-right: 12px; }
.pc-inputt { }
.pc-status { margin-top: 8px; }
.pc-warn { margin-top: 8px; }

/* 右区二维码: 白盒 + 黑模块 (与主题无关, 保证任何底色下都能扫) */
.qr-zone { position: absolute; left: 680px; top: 0px; width: 280px; height: 266px; justify-content: center; align-items: center; }
.qr-box { position: absolute; background-color: #ffffff; }
.qr-dark { position: absolute; background-color: #000000; }
.qr-mask { position: absolute; left: 0px; top: 0px; justify-content: center; align-items: center; }
.qm-t { }
.qm-s { margin-top: 6px; }
.qm-ic { }
.qr-ph { }
</style>
