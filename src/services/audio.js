// 音频输出 —— 本机扬声器 / 蓝牙
//
// ── 设备事实 (实测) ──────────────────────────────────────────────
//   - bluealsa 在跑: /data/local/bluealsa_custom/bluealsa_orig --profile=a2dp-source ...
//   - 但 ALSA **没有** bluealsa PCM 设备 (aplay -L 里没有), /etc/asound.conf 的默认播放是 "speaker"
//     => 音频没法靠改 ALSA 默认设备转给蓝牙
//   - 播放器元素有 setAudioDeviceType(14 个方法之一), 内部把 ALSA sink 拆了重建:
//     设备串 0/3=扬声器, 1=tc_digital, 2=tc_analog, 4=bluealsa:DEV=<mac>
//   - ★ 旧项目踩过的坑: 用"猜"的参数调 setAudioDeviceType 会直接报
//     "Could not open audio device for playback", 而且**把整条播放管线带崩** (即使没接蓝牙).
//
// ── 因此这里的策略 ───────────────────────────────────────────────
//   1. 只做**探测 + 显式切换**: 先确认真的连上了蓝牙音频设备, 才允许切
//   2. 切换前记录当前值, 失败立刻回滚到扬声器
//   3. 任何一步异常都不抛出, 只置错误信息 (音频是"锦上添花", 不能拖垮播放)
//
// 蓝牙设备枚举用 bluetoothctl (系统自带, 旧项目实测可用).

import { bilinet } from './native.js'
import { log } from '../core/log.js'
import { dataDir } from '../core/paths.js'

// ALSA 设备串 (取证见文件头)
export const AUDIO_TYPE_SPEAKER = 0
export const AUDIO_TYPE_BLUETOOTH = 4

// 扫描已连接的蓝牙**音频**设备: 输出 "MAC|名称|pcm" 若干行.
//
// ★ 判据来自 PenBili docs/x6pro-video-playback.md §5.3 (逐条都是踩过的坑):
//   1. 只看 "Connected: yes" 不够 —— AVRCP-only 设备能连上但放不出声,
//      选它等于静默无声, 比不选更坑. 必须**同时**命中 Audio Sink UUID.
//   2. 不要用 `bluetoothctl devices Connected` —— 这版 BlueZ 报 "Too many arguments",
//      必须 `devices` 再逐个 `info`.
//   3. 本机 `bluealsa-aplay -L` 实测返回空 (旧固件上更是直接栈溢出 abort),
//      所以 PCM 名自己拼: bluealsa:DEV=<MAC>,PROFILE=a2dp
const SCAN_CMD = 'for m in $(bluetoothctl devices 2>/dev/null | sed -n "s/^Device \([0-9A-Fa-f:]\{17\}\).*/\\1/p"); do ' +
  'I=$(bluetoothctl info "$m" 2>/dev/null); ' +
  'echo "$I" | grep -q "Connected: yes" || continue; ' +
  'echo "$I" | grep -q "Audio Sink" || continue; ' +
  'n=$(echo "$I" | sed -n "s/^[[:space:]]*Name: //p" | head -1); ' +
  'echo "$m|$n|bluealsa:DEV=$m,PROFILE=a2dp"; done'

/**
 * 枚举已连接的蓝牙设备.
 * @returns {Promise<Array<{mac:string,name:string}>>}
 */
export function btDevices() {
  return new Promise(function (resolve) {
    if (!bilinet || typeof bilinet.execAsync !== 'function') { resolve([]); return }
    try {
      bilinet.execAsync(SCAN_CMD).then(function (out) {
        const list = []
        const lines = String(out || '').split('\n')
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim()
          if (!t || t.indexOf('|') < 0) continue
          const parts = t.split('|')
          if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(parts[0])) continue
          list.push({ mac: parts[0], name: parts[1] || parts[0], pcm: parts[2] || '' })
        }
        resolve(list)
      }).catch(function () { resolve([]) })
    } catch (e) { resolve([]) }
  })
}

/** 蓝牙适配器是否开着 */
export function btPowerState() {
  return new Promise(function (resolve) {
    if (!bilinet || typeof bilinet.execAsync !== 'function') { resolve('unknown'); return }
    try {
      bilinet.execAsync('bluetoothctl show 2>/dev/null | grep -q "Powered: yes" && echo ON || echo OFF')
        .then(function (o) { resolve(String(o || '').indexOf('ON') >= 0 ? 'on' : 'off') })
        .catch(function () { resolve('unknown') })
    } catch (e) { resolve('unknown') }
  })
}

/**
 * 通知设备: 音频走哪.
 * @param videoEl 播放器元素 (必须有 setAudioDeviceType)
 * @param {'speaker'|'bluetooth'} mode
 * @param {string} [mac] 蓝牙 mac (mode=bluetooth 时必填)
 * @returns {{ok:boolean, msg:string, type?:number}}
 */
export async function applyAudioRoute(videoEl, mode, mac, pcm) {
  // ★ 两条路, 按可用性选:
  //   ① 元素 API setAudioDeviceType —— 本机固件**没有**这个方法 (真机报过
  //      "当前固件播放器没有 setAudioDeviceType");
  //   ② 系统层 hal-audio —— 系统自带, 也是其它播放器(网易云)走的路子, 本机可用.
  //   所以元素 API 不可用时不再报错, 直接落到系统路由.
  if (!videoEl || typeof videoEl.setAudioDeviceType !== 'function') {
    log('音频', '播放器无 setAudioDeviceType, 改用系统层路由 (hal-audio)')
    return applySystemRoute(mode === 'bluetooth' ? 'bt' : 'speaker', mac)
  }
  try {
    if (mode === 'bluetooth') {
      if (!mac) return { ok: false, msg: '没有已连接的蓝牙设备' }
      // ★ 参数格式是这套代码最容易翻车的地方:
      //   历史报错 {"code":100,"msg":"Could not open audio device for playback."}
      //   就是"用猜的参数调 setAudioDeviceType"的结果 —— 而且**会把整条管线带崩**.
      //   元素内部是拆掉 ALSA sink 重建, 所以要的是**完整 ALSA 设备串**,
      //   不是裸 MAC. 优先传 bluealsa:DEV=<mac>,PROFILE=a2dp, 拿不到才退回 MAC.
      const dev = String(pcm || '').trim() !== '' ? String(pcm).trim() : mac
      videoEl.setAudioDeviceType(AUDIO_TYPE_BLUETOOTH, dev)
      log('音频', '已切蓝牙输出 pcm=' + dev)
      return { ok: true, msg: '已切到蓝牙', type: AUDIO_TYPE_BLUETOOTH }
    }
    // 回扬声器: 类型 + 空 mac (旧项目验证过空 mac 对 0 是安全的)
    videoEl.setAudioDeviceType(AUDIO_TYPE_SPEAKER, '')
    log('音频', '已切回扬声器')
    return { ok: true, msg: '已切到扬声器', type: AUDIO_TYPE_SPEAKER }
  } catch (e) {
    // 回滚尝试: 切回扬声器, 尽量不让管线留在坏状态
    try { videoEl.setAudioDeviceType(AUDIO_TYPE_SPEAKER, '') } catch (e2) {}
    log('音频', '切换失败并已回滚: ' + e)
    return { ok: false, msg: '切换失败: ' + String(e).slice(0, 60) }
  }
}

/* ==================== 音频通路自愈 (PenBili 实证) ==================== */
//
// ★★ 本机出厂状态是**整机静音**, 两道闸门都关着 (实测):
//      amixer -c 0 cget name='Playback Path'   ->  ; Item #0 'OFF'      (: values=0)
//      amixer -c 1 cget name='aw_dev_0_switch' ->  ; Item #0 'Disable'
//    这时 aplay 在跑、PCM 状态 RUNNING、Master 88%, 扬声器**完全无声**.
//    X5 上有系统音频守护进程代劳; X6 Pro 的 PulseAudio 连不上, 没人设.
//
// ★★★ 解析坑 (PenBili v2.3.0 自愈静默失效的真因):
//      `amixer cget` 的**第一行**也被单引号包着:
//        numid=45,iface=MIXER,name='Playback Path'     <- 首行! 控件名也在引号里
//          ; type=ENUMERATED,...
//          ; Item #0 'OFF'                             <- 值在这里
//      v2.3.0 取"第一对单引号" -> 拿到 'Playback Path', 与 "OFF" 永不相等
//      -> 代码看着完全正确, 实际一次都没触发过.
//      正确姿势: **只认 "; Item #" 那一行**, 在该行内取第一对单引号.
//
// ★ 策略: 只在当前值是 OFF 时才写 SPK —— 绝不把用户手动选的耳机抢回扬声器.
//   (PenBili: 已经是 HP/HP_NO_MIC/BT/SPK 一律不动)

/** 生成自愈脚本内容 (写成文件再执行: 多行命令直接塞给 execAsync 在真机上不生效) */
function routeScript() {
  return [
    "#!/bin/sh",
    "# 读当前选中值: ★ 必须用 sget 的 \"Item0:\" 行.",
    "#   cget 会把**全部** items 都列成 \"; Item #N 'X'\", 取第一行永远得到第一项,",
    "#   跟真实选中值无关 (本机实测: cget 第一行恒为 OFF, 而 sget 的 Item0 才是真值).",
    "RD() { amixer -c \"$1\" sget \"$2\" 2>/dev/null | sed -n \"s/^[[:space:]]*Item0: '\\([^']*\\)'.*/\\1/p\" | head -1; }",
    "V=$(RD 0 'Playback Path')",
    "FIXED=0",
    "if [ \"$V\" = \"OFF\" ]; then amixer -c 0 sset 'Playback Path' 'SPK' >/dev/null 2>&1 && FIXED=1; fi",
    "W=$(RD 1 'aw_dev_0_switch')",
    "if [ \"$W\" = \"Disable\" ]; then amixer -c 1 sset 'aw_dev_0_switch' 'Enable' >/dev/null 2>&1 && FIXED=1; fi",
    "V2=$(RD 0 'Playback Path')",
    "echo \"PATH=$V2 BEFORE=$V FIXED=$FIXED\""
  ].join('\n')
}

/**
 * 确保音频通路是通的 (扬声器出声).
 * 幂等: 已经是 SPK 就不动; 失败静默返回, 不影响播放.
 * @returns {Promise<{ok:boolean, path:string, fixed:boolean}>}
 */
export async function ensureAudioRoute() {
  if (!bilinet) return { ok: false, path: '', fixed: false }
  let out = ''
  try {
    const sp = (typeof dataDir === 'function' ? dataDir() : '/userdisk') + '/audiofix.sh'
    bilinet.mkdirs((typeof dataDir === 'function' ? dataDir() : '/userdisk'))
    bilinet.writeFile(sp, routeScript(), false)
    bilinet.exec('chmod 755 ' + sp + ' 2>/dev/null')
    out = (typeof bilinet.execAsync === 'function') ? await bilinet.execAsync('sh ' + sp) : bilinet.exec('sh ' + sp)
  } catch (e) {
    log('音频', '通路自愈失败: ' + (e && e.message ? e.message : e))
    return { ok: false, path: '', fixed: false }
  }
  const s = String(out || '')
  const m = s.match(/PATH=(\S*)/)
  const fixedM = s.match(/FIXED=(\d)/)
  const path = m ? m[1] : ''
  const fixed = fixedM ? fixedM[1] === '1' : false
  log('音频', '通路自愈: PlaybackPath=' + (path || '?') + ' 本次修正=' + fixed)
  return { ok: path !== '' && path !== 'OFF', path: path, fixed: fixed }
}

/* ==================== 系统级音频路由 (hal-audio) ==================== */
//
// 背景: 固件播放器元素**没有** setAudioDeviceType (真机报"当前固件播放器没有
// SET AUDIO DEVICE TYPE"). 但系统自带 hal-audio, 它的用法里有:
//   -l, --list-devices        列出声卡/音频设备
//   -b, --bluealsa=#          a2dp dev mac addr   <- 把音频送到蓝牙
//   -g/-s                     音量读写
// 这正是系统其它播放器 (网易云) 走的路子: 在**系统层**路由, 不依赖播放器 API.
//
// 焦点释放: 系统有一个常驻 SoundPlayer 守护进程 (/oem/YoudaoDictPen/output/SoundPlayer,
// 由 /usr/bin/runSoundPlayer + guardian_run 托管). killall -9 SoundPlayer 后
// guardian 会自动把它拉起来 —— 等价于"释放并重置音频焦点", 这也是系统其它播放器的做法.

/** 执行一条系统命令 (异步优先, 同步兜底) */
function sysExec(cmd) {
  try {
    if (bilinet && typeof bilinet.execAsync === 'function') return bilinet.execAsync(cmd)
    if (bilinet && typeof bilinet.exec === 'function') return bilinet.exec(cmd)
  } catch (e) {}
  return ''
}

/** 列出系统音频设备 (诊断用) */
export async function listAudioDevices() {
  try { return String(await sysExec('hal-audio -l 2>&1') || '') } catch (e) { return '' }
}

/**
 * 系统级音频路由.
 *   applySystemRoute('bt', 'AA:BB:CC:DD:EE:FF') -> 走蓝牙 A2DP
 *   applySystemRoute('speaker')                  -> 回到扬声器
 * 返回 { ok, msg }
 */
export async function applySystemRoute(kind, mac) {
  const k = String(kind || 'speaker')
  if (k === 'bt') {
    const m = String(mac || '').trim().toUpperCase()
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m)) return { ok: false, msg: '蓝牙地址不合法' }
    try {
      await sysExec('hal-audio -b ' + m + ' 2>&1')
      log('音频', 'hal-audio 路由到蓝牙 ' + m)
      return { ok: true, msg: '已切换到蓝牙耳机' }
    } catch (e) {
      return { ok: false, msg: '切换失败: ' + (e && e.message ? e.message : e) }
    }
  }
  // 回扬声器: 清掉 bluealsa 绑定
  try {
    await sysExec('hal-audio -b "" 2>&1')
    log('音频', 'hal-audio 路由回扬声器')
    return { ok: true, msg: '已切换回扬声器' }
  } catch (e) {
    return { ok: false, msg: '切换失败: ' + (e && e.message ? e.message : e) }
  }
}

/**
 * 释放音频焦点: 让系统 SoundPlayer 重启 (guardian 会自动拉起).
 * 播放前调用一次, 可以打断其它应用正在播的声音 —— 这是系统其它播放器的做法.
 */
export async function releaseAudioFocus() {
  try {
    await sysExec('killall -9 SoundPlayer 2>/dev/null || true')
    log('音频', '已释放音频焦点 (SoundPlayer 重置)')
    return { ok: true, msg: '已释放音频焦点' }
  } catch (e) {
    return { ok: false, msg: '释放失败: ' + (e && e.message ? e.message : e) }
  }
}
