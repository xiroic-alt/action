// 播放引擎 —— 纯 JS 驱动系统 gst-play-1.0 (无需任何自研 .so)
//
// ══════════════ 为什么推倒重来 ══════════════
// 旧方案是自研 libjsapi_gstplayer.so, 它有三处硬伤:
//   1. 音频支路多过一层 decodebin (自带 queue), 与视频链**不共享缓冲** => 结构性音画错位
//      video: qtdemux>vparse>mppvideodec>vqueue>videoconvert:kmssink
//      audio: decodebin>acaps_early>audioconvert>audioresample>volume>alsasink
//   2. 音频设备热切走 rebuildAudio_ (拆 sink 重建), 播放中调用必错位
//   3. 源码不在仓库任何分支, 修不动
//
// ══════════════ 新方案: 系统 gst-play-1.0 ══════════════
// 设备自带 GStreamer 1.22.0 全套工具与插件 (gst-play / gst-launch / 全部 sink),
// 它内部是 playbin -> uridecodebin, **一个 bin 同时出音视频 = 合并解码**:
//   uridecodebin ─┬─ video: mppvideodec ! videoconvert ! videoscale -> waylandsink
//                 └─ audio: audioconvert ! audioresample -> alsasink
// 这正是官方 cvplayer 的管线形态, 且不依赖任何原生模块.
//
// ══════════════ 蓝牙音画同步 ══════════════
// A2DP 端到端延迟 150~250ms 发生在 bluealsa **之后**, ALSA 完全看不见,
// 只能在音频侧加**正的时间戳偏移**把声音推迟, 与画面重新对齐:
//   alsasink ts-offset   = +<ms>*1e6  (纳秒; 正值 = 推迟音频)
//   alsasink buffer-time = 400000     (400ms)
// 运行时可调: /userdisk/xiro/btaudio_ms (缺省 200ms).
//
// ══════════════ 控制方式 ══════════════
//   play   : 写脚本 -> execAsync 后台启动 (必须后台, 否则不返回)
//   pause  : kill -STOP <pid>   (进程级冻结, 不重建管线, 时间轴连续)
//   resume : kill -CONT <pid>
//   stop   : kill
//   seek   : 用 -s <秒> 重启 (gst-play 原生支持起播位置)
//   position: JS 侧计时 (起点已知 + 速率), 起播/seek/暂停时校准
import { bilinet } from './native.js'
import { log } from '../core/log.js'
import { dataDir } from '../core/paths.js'

const GST_PLAY = '/usr/bin/gst-play-1.0'
const PID_FILE = '/tmp/pilipro_gst.pid'
const LOG_FILE = '/tmp/pilipro_gst.log'
const NL = String.fromCharCode(10)

let _btMs = 200

/** 当前蓝牙补偿毫秒 */
export function currentBtMs() { return _btMs }

/** 从设备读一次补偿值 (沿用旧项目约定路径, 缺省 200ms) */
export async function refreshBtAudioMs() {
  if (!bilinet) return _btMs
  try {
    const sp = dataDir() + '/readbtaudio.sh'
    bilinet.mkdirs(dataDir())
    bilinet.writeFile(sp, ['#!/bin/sh',
      'V=$(cat /userdisk/xiro/btaudio_ms 2>/dev/null)',
      'case "$V" in ""|*[!0-9]*) V=200;; esac',
      'echo "BTMS=$V"'].join(NL), false)
    bilinet.exec('chmod 755 ' + sp + ' 2>/dev/null')
    const out = String(await bilinet.execAsync('sh ' + sp) || '')
    const m = out.match(/BTMS=([0-9]+)/)
    if (m) {
      const v = parseInt(m[1], 10)
      _btMs = (v >= 0 && v <= 1000) ? v : 200
      log('播放器', '蓝牙音画补偿 = ' + _btMs + 'ms')
    }
  } catch (e) { log('播放器', '读补偿失败, 用缺省 ' + _btMs) }
  return _btMs
}

/** 生成播放脚本
 * @param {object} o { url, x, y, w, h, startSec, audioDevice, btOn, btMs }
 */
function buildScript(o) {
  const L = ['#!/bin/sh']
  L.push('export XDG_RUNTIME_DIR=/var/run')
  L.push('export WAYLAND_DISPLAY=wayland-0')
  L.push('. /etc/profile.d/gst.sh 2>/dev/null')
  L.push('')
  const rect = '<' + o.x + ',' + o.y + ',' + o.w + ',' + o.h + '>'
  // ★★ 绝对**不要**加 layer= 属性 —— 真机必崩.
  //   git 历史 bfa4471 已经踩过: "修播放崩溃 (layer 属性在 toplevel 窗口上必崩)".
  //   我 2026-11-14 又踩了一次 (加 layer=bottom 后用户报"播放出现闪退").
  //   图层问题的正确解法见 WAYLANDSINK_PLACE_ABOVE / 合成时序, 不要碰 layer.
  //   sync 也保持默认: 1946faa 那条 "sync=false 修首帧停住" 是配合 layer=bottom 用的,
  //   单独加没有收益且有风险.
  // ★★ 必须显式串 videoconvert ! videoscale, 不能只给 waylandsink.
  //   原因: waylandsink 支持 dmabuf, 解码器直出原生分辨率 (如 4K) 时它会**绕过缩放**,
  //   于是 473x266 的窗口里只显示 4K 帧的左上角 —— 真机表现就是
  //   "视频只显示在上半个屏幕, 下半个不显示" (用户 2026-11-14 反馈).
  //   旧 .so 的管线里本来就有 videoconvert/videoscale, playbin 不保证插.
  //   gst-play 的 --videosink 接受**bin 描述**, 所以直接串起来即可.
  // ★ fullscreen=true 必须有: waylandsink 默认建的是 **toplevel 窗口**, 会被 Weston
  //   桌面 shell 摆放; 若窗口不是全屏, render-rectangle 就是相对窗口而不是相对屏幕,
  //   于是逻辑矩形 <244,0,473,266> 落在小窗口里 —— 真机表现就是
  //   "视频只显示在上半个屏幕" (用户 2026-11-14 两次反馈).
  //   全屏后 render-rectangle 才真正相对整个屏幕.
  L.push('VS="videoconvert ! videoscale ! waylandsink fullscreen=true render-rectangle=' + rect + '"')
  let as = 'alsasink'
  if (o.audioDevice) as += ' device=' + o.audioDevice
  if (o.btOn) {
    as += ' buffer-time=400000 latency-time=10000'
    as += ' ts-offset=' + (Math.round(o.btMs || 200) * 1000000)
  }
  L.push('AS="' + as + '"')
  L.push('')
  const a = ['-q', '--no-interactive', '--no-position']
  if (o.startSec > 0) a.push('-s ' + Math.floor(o.startSec))
  a.push('--videosink="$VS"')
  a.push('--audiosink="$AS"')
  a.push('"' + String(o.url).replace(/"/g, '%22') + '"')
  L.push(GST_PLAY + ' ' + a.join(' ') + ' &')
  L.push('echo $! > ' + PID_FILE)
  L.push('wait')
  return L.join(NL)
}

/** 写一个小脚本并执行 (复杂命令不能直接交给 execAsync) */
function runScript(name, lines) {
  if (!bilinet) return
  try {
    const sp = dataDir() + '/' + name
    bilinet.mkdirs(dataDir())
    bilinet.writeFile(sp, lines.join(NL), false)
    bilinet.exec('chmod 755 ' + sp + ' 2>/dev/null')
    bilinet.exec('sh ' + sp)
  } catch (e) { log('播放器', name + ' 失败: ' + (e && e.message ? e.message : e)) }
}

/** 起播 (先停上一次) */
export async function start(o) {
  if (!bilinet) return { ok: false, msg: '无原生桥' }
  await stop()
  try {
    const sp = dataDir() + '/runplayer.sh'
    bilinet.mkdirs(dataDir())
    bilinet.writeFile(sp, buildScript(o), false)
    bilinet.exec('chmod 755 ' + sp + ' 2>/dev/null')
    bilinet.exec('sh ' + sp + ' > ' + LOG_FILE + ' 2>&1 &')
    log('播放器', '起播 start=' + (o.startSec || 0) + 's ' +
      (o.btOn ? ('蓝牙偏移' + (o.btMs || 200) + 'ms') : '扬声器') +
      ' rect=' + o.x + ',' + o.y + ',' + o.w + ',' + o.h)
    return { ok: true }
  } catch (e) {
    log('播放器', '起播失败: ' + (e && e.message ? e.message : e))
    return { ok: false, msg: String(e).slice(0, 60) }
  }
}

/** 给播放进程发信号 */
function signal(sig) {
  runScript('sigplayer.sh', ['#!/bin/sh',
    'P=$(cat ' + PID_FILE + ' 2>/dev/null)',
    'if [ -n "$P" ]; then kill -' + sig + ' "$P" 2>/dev/null; fi',
    'echo SIGOK'])
}

/** 暂停: 冻结进程 (不重建管线, 时间轴连续) */
export function pause() { signal('STOP'); log('播放器', '暂停 SIGSTOP') }
/** 恢复 */
export function resume() { signal('CONT'); log('播放器', '恢复 SIGCONT') }
/** 停止 */
export async function stop() {
  signal('TERM')
  runScript('killplayer.sh', ['#!/bin/sh',
    'P=$(cat ' + PID_FILE + ' 2>/dev/null)',
    'if [ -n "$P" ]; then kill -9 "$P" 2>/dev/null; fi',
    'rm -f ' + PID_FILE, 'echo KILLOK'])
}

/** 播放进程是否还活着 (判自然结束) */
export async function isAlive() {
  if (!bilinet) return false
  try {
    const sp = dataDir() + '/aliveplayer.sh'
    bilinet.mkdirs(dataDir())
    bilinet.writeFile(sp, ['#!/bin/sh',
      'P=$(cat ' + PID_FILE + ' 2>/dev/null)',
      'if [ -n "$P" ] && [ -d /proc/$P ]; then echo ALIVE; else echo DEAD; fi'].join(NL), false)
    bilinet.exec('chmod 755 ' + sp + ' 2>/dev/null')
    const out = String(await bilinet.execAsync('sh ' + sp) || '')
    return out.indexOf('ALIVE') >= 0
  } catch (e) { return false }
}

/** 读播放器日志尾部 (排障) */
export async function tailLog() {
  if (!bilinet) return ''
  try {
    const sp = dataDir() + '/taillog.sh'
    bilinet.mkdirs(dataDir())
    bilinet.writeFile(sp, ['#!/bin/sh', 'tail -6 ' + LOG_FILE + ' 2>/dev/null'].join(NL), false)
    bilinet.exec('chmod 755 ' + sp + ' 2>/dev/null')
    return String(await bilinet.execAsync('sh ' + sp) || '')
  } catch (e) { return '' }
}

export default { start, pause, resume, stop, isAlive, currentBtMs, refreshBtAudioMs, tailLog }
