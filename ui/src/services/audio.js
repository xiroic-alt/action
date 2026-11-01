// 音频输出 —— 蓝牙 / 扬声器, 以及音频焦点.
//
// ── 本机事实 (每条都标了来源, 都可以自己核对) ──────────────────────────────
// 1) **固件在蓝牙连上后会关掉板载扬声器通路 (rk817)**, 声音必须走蓝牙通路;
//    反过来, 系统层若还留着 bluealsa 绑定, 蓝牙断开后扬声器也可能是哑的.
//    来源: 同设备上 PenMusic 项目文档「关键设计 10」(实测) + PiliPRO services/audio.js.
//    → 系统级路由工具 `hal-audio`: `-b <MAC>` 走蓝牙, `-b ""` 清绑定回扬声器.
//      (本机 /bin/hal-audio 存在, --help 与 -l 都真机核对过)
// 2) **bluez 会谎报连接状态**. 10-17 真机实测: `hcitool con` 显示 ACL 链路是活的
//    (state 1 lm MASTER AUTH ENCRYPT), 而 `bluetoothctl info` 对同一设备报 Connected: no.
//    PenMusic 给的权威判据是 D-Bus (Device1.Connected):
//      dbus-send --system --print-reply --dest=org.bluez / ...GetManagedObjects
//    本机 /bin/dbus-send 存在 (真机核对过, 真实输出样本见 tools/fixtures/).
// 3) **音频焦点**: 系统常驻 SoundPlayer 守护进程持有焦点
//    (/oem/YoudaoDictPen/output/SoundPlayer, 由 /usr/bin/runSoundPlayer + guardian_run 托管).
//    其它系统播放器的做法是 `killall -9 SoundPlayer` —— guardian 会立刻把它拉回来,
//    等价于「释放并重置音频焦点」, 用来打断别的应用正在播的声音.
//    来源: PiliPRO services/audio.js; 真机确认该进程在跑.
// 4) **A2DP 的 SBC 档位影响延迟**: bluealsa 的 --sbc-quality 越高 -> bitpool 越大 ->
//    每帧载荷越大 -> 接收端要缓冲更多包 -> 端到端延迟越大. 系统自带脚本
//    /usr/bin/runBlueAlsa 传的就是 0, 但曾被一个包装脚本硬编码成 2 (已修正).
//    来源: PenMusic readme (它自己拉 bluealsa 用 --sbc-quality=0) + 真机 ps 核对.
//
// ── 边界 ────────────────────────────────────────────────────────────────
// 本文件只做「探测 + 系统级路由」, **不碰播放管线**. 播放器元素上的
// setAudioDeviceType 仍由 pages/player 负责 (它有管线时序的硬约束, 见那边的注释);
// 这里的 hal-audio 是系统层兜底与「回扬声器」的恢复手段.

import { bilinet } from './native.js'
import { log } from './log.js'
import { parseManagedObjects } from './bluez-parse.js'

export { parseManagedObjects }

function exec(cmd) {
  // 一律 execAsync: 同步 exec 会冻死整个应用 (HANDOVER §10)
  try {
    if (bilinet && typeof bilinet.execAsync === 'function') return bilinet.execAsync(cmd)
  } catch (e) {}
  return Promise.resolve('')
}

/** D-Bus 权威判据: 已连接的蓝牙 MAC 列表 (拿不到返回 []) */
export function btMacDbus() {
  const cmd = 'dbus-send --system --print-reply --dest=org.bluez / ' +
    'org.freedesktop.DBus.ObjectManager.GetManagedObjects 2>/dev/null'
  return exec(cmd).then(function (out) { return parseManagedObjects(out) })
    .catch(function () { return [] })
}

/** 兜底 1: bluetoothctl 逐个查 (命令里不许出现 sed 反引用, 那是 QuickJS 的八进制转义) */
export const SCAN_BT_CMD =
  'for m in $(bluetoothctl devices 2>/dev/null | cut -d" " -f2); do ' +
  'bluetoothctl info $m 2>/dev/null | grep -q "Connected: yes" && echo "CONNECTED $m"; done'

/** 兜底 2: 链路层真相 (bluez 谎报时用) */
export function btMacLinkLayer() {
  return exec('hcitool con 2>/dev/null | grep ACL').then(function (c) {
    const m = /([0-9A-Fa-f:]{17})/.exec(String(c || ''))
    return m ? m[1].toUpperCase() : null
  }).catch(function () { return null })
}

/**
 * 取「当前已连接的蓝牙音频设备」.
 * 顺序: D-Bus (权威) -> bluetoothctl (逐个查) -> hcitool (链路层).
 * 三级都不命中才算真没有 —— bluez 的谎报我们踩过一次, 单靠一种判据不可靠.
 */
export async function btMac() {
  const list = await btMacDbus()
  if (list && list.length) {
    try { log('音频', 'D-Bus 报已连接: ' + list[0]) } catch (e) {}
    return list[0]
  }
  try {
    const out = await exec(SCAN_BT_CMD)
    const m = /CONNECTED ([0-9A-Fa-f:]{17})/i.exec(String(out || ''))
    if (m) return m[1].toUpperCase()
  } catch (e) {}
  // 链路层有 ACL 但 bluez 说没连 -> 正是"谎报". 必须补一次 connect 把 bluez 状态纠正过来,
  // 否则 bluealsa 建不出 A2DP PCM (aplay 报 "PCM not found"), 表现就是"连着蓝牙却没声音".
  // (10-17 真机验过: connect 之后 aplay 立刻能建出 a2dpsrc/sink)
  const link = await btMacLinkLayer()
  if (link) {
    try { log('音频', 'bluez 报未连接但链路层已连 ' + link + ' -> 补一次 connect 纠正') } catch (e1) {}
    try { await exec('timeout 15 bluetoothctl connect ' + link) } catch (e2) {}
    return link
  }
  return null
}

/** 系统层: 把音频送到蓝牙 (hal-audio -b <MAC>) */
export function routeBt(mac) {
  const m = String(mac || '').trim().toUpperCase()
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m)) return Promise.resolve(false)
  return exec('hal-audio -b ' + m + ' 2>&1').then(function () {
    try { log('音频', 'hal-audio 系统层路由到蓝牙 ' + m) } catch (e) {}
    return true
  }).catch(function () { return false })
}

/** 系统层: 清掉 bluealsa 绑定, 回到扬声器 (修「蓝牙断开后扬声器一直哑」) */
export function routeSpeaker() {
  return exec('hal-audio -b "" 2>&1').then(function () {
    try { log('音频', 'hal-audio 已清掉蓝牙绑定 (回扬声器)') } catch (e) {}
    return true
  }).catch(function () { return false })
}

/**
 * 释放音频焦点: 让系统 SoundPlayer 重启 (guardian 会自动拉起).
 * 播放前调一次, 可以打断别的应用占用的声音 —— 系统其它播放器就是这么做的.
 */
export function releaseAudioFocus() {
  return exec('killall -9 SoundPlayer 2>/dev/null || true').then(function () {
    try { log('音频', '已释放音频焦点 (SoundPlayer 重置)') } catch (e) {}
    return true
  }).catch(function () { return false })
}

/** 诊断用: 列出系统音频设备 */
export function listAudioDevices() {
  return exec('hal-audio -l 2>&1').then(function (o) { return String(o || '') })
    .catch(function () { return '' })
}
