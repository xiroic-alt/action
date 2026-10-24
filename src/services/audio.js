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

// ALSA 设备串 (取证见文件头)
export const AUDIO_TYPE_SPEAKER = 0
export const AUDIO_TYPE_BLUETOOTH = 4

// 扫描已连接的蓝牙设备: 输出 "MAC 名称" 若干行
const SCAN_CMD = 'for m in $(bluetoothctl devices 2>/dev/null | cut -d" " -f2); do ' +
  'n=$(bluetoothctl info $m 2>/dev/null | sed -n "s/^\\s*Name: //p" | head -1); ' +
  'bluetoothctl info $m 2>/dev/null | grep -q "Connected: yes" && echo "$m|$n"; done'

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
          list.push({ mac: parts[0], name: parts[1] || parts[0] })
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
export function applyAudioRoute(videoEl, mode, mac) {
  if (!videoEl || typeof videoEl.setAudioDeviceType !== 'function') {
    return { ok: false, msg: '当前固件播放器没有 setAudioDeviceType' }
  }
  try {
    if (mode === 'bluetooth') {
      if (!mac) return { ok: false, msg: '没有已连接的蓝牙设备' }
      videoEl.setAudioDeviceType(AUDIO_TYPE_BLUETOOTH, mac)
      log('音频', '已切蓝牙输出 ' + mac)
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
