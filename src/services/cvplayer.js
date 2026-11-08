// cvplayer 能力层 —— 官方视频播放器用的那个模块 (固件 libjsapi_export.so 提供)
//
// ══════════════ 为什么换它 (合并解码) ══════════════
// 官方管线是**一个** uridecodebin 同时出音视频:
//   uridecodebin ──┬─ video: mymppvideodec ! videoconvert ! videoscale -> waylandsink
//                  └─ audio: audioconvert ! resample -> alsasink
// 而现在用的自定义 <video> (libjsapi_gstplayer.so) 音频多过一层 decodebin:
//   video: qtdemux>vparse>mppvideodec>vqueue>videoconvert:kmssink  (直连)
//   audio: decodebin>acaps_early>audioconvert>audioresample>volume>alsasink
// 两条链**不共享缓冲** -> 结构性音画错位. 换成 cvplayer 才能根治.
//
// ══════════════ API (2026-11-08 真机内省实测, 不是猜的) ══════════════
//   const p = new CVPlayer()          <- 是**构造器**, 没有 getCVPlayerManager
//   实例方法 (原型上, 11 个):
//     setDataSource(url)             建管线; 之后才会有 onState
//     setVideoSurface(x, y, h)       3 个 int (来自 .so: "setVideoSurface %d, %d, %d")
//     videoCrop(l, t, w, h)          4 个 int
//     play() / pause() / stop() / resume()
//     seek(pos)                      seekto 语义
//     setRate(r) / getRate()
//     setAudioDeviceType(type, mac)  蓝牙热切; type 4 = bluealsa, 参数传**裸 MAC**
//   实例事件属性 (5 个, 直接赋值函数):
//     onState(state) / onInfo(...) / onPosition(pos) / onComplete() / onResume()
//
// ══════════════ 解析不到怎么办 ══════════════
// 构建侧: 未解析的 import 只会被标 external + 打 warn, 不会让构建失败
//   (aiot-vue-cli/src/rollup-plugins/falcon-module.js).
// 运行侧: 真机实测**能解析** —— root=object keys=[CVPlayer], 且应用正常启动.
// 这里仍做一层兜底, 万一将来固件移除了它, 页面可以退回旧 <video>.
// ★★ 必须是**命名空间导入**, 不能写 import { CVPlayer } from 'cvplayer'.
//   实测 (2026-11-08): 命名导入会让整个应用**黑屏** —— 链接期就解析不到,
//   而命名空间导入 root=object keys=[CVPlayer] 完全正常.
//   教训与 native.js 里那条一致: 静态 import 解析失败 = 应用起不来, 只能在 JS 里兜底不了.
import * as CV_MOD from 'cvplayer'
import { log } from '../core/log.js'

/** 模块是否可用 (解析得到构造器) */
export function cvAvailable() {
  return !!(CV_MOD && typeof CV_MOD.CVPlayer === 'function')
}

/** 取构造器 (不可用时 null) */
function Ctor() {
  return (CV_MOD && typeof CV_MOD.CVPlayer === 'function') ? CV_MOD.CVPlayer : null
}

/** 建一个播放器实例; 不可用时返回 null (调用方据此退回旧路径) */
export function createCVPlayer(handlers) {
  const C = Ctor()
  if (!C) { log('cvplayer', '模块不可用, 返回 null'); return null }
  try {
    const p = new C()
    const h = handlers || {}
    // 事件属性直接赋值; 每个都包一层 try, 免得某个回调异常把播放打断
    const bind = function (name, fn) {
      if (typeof fn !== 'function') return
      p[name] = function () {
        try { fn.apply(null, Array.prototype.slice.call(arguments)) }
        catch (e) { log('cvplayer', name + ' 回调异常: ' + (e && e.message ? e.message : e)) }
      }
    }
    bind('onState', h.onState)
    bind('onInfo', h.onInfo)
    bind('onPosition', h.onPosition)
    bind('onComplete', h.onComplete)
    bind('onResume', h.onResume)
    log('cvplayer', '实例已建')
    return p
  } catch (e) {
    log('cvplayer', '建实例失败: ' + (e && e.message ? e.message : e))
    return null
  }
}

/** 安全调用实例方法 (方法不存在/抛异常时返回 undefined, 不打断播放) */
export function call(player, name) {
  if (!player) return undefined
  const fn = player[name]
  if (typeof fn !== 'function') { log('cvplayer', '无方法 ' + name); return undefined }
  try { return fn.apply(player, Array.prototype.slice.call(arguments, 2)) }
  catch (e) { log('cvplayer', name + ' 失败: ' + (e && e.message ? e.message : e)); return undefined }
}

/** 能力快照 (设置页/排障用) */
export function cvStatus() {
  const C = Ctor()
  const out = { ok: !!C, methods: [], events: [] }
  if (!C) return out
  try {
    const p = new C()
    out.methods = Object.getOwnPropertyNames(Object.getPrototypeOf(p) || {})
      .filter(function (k) { return k !== 'constructor' })
    out.events = ['onState', 'onInfo', 'onPosition', 'onComplete', 'onResume']
  } catch (e) { out.err = String((e && e.message) || e).slice(0, 80) }
  return out
}

export default { cvAvailable, createCVPlayer, call, cvStatus }
