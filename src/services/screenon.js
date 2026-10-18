// 防息屏 —— 播放期间让屏幕常亮
//
// 设备契约 (HANDOVER §3, 已真机验证):
//   - 官方 JSAPI 三件套 startAlwaysScreenOn / stopAlwaysScreenOn / keepScreenOn,
//     模块名 brightness (app.json 的 options.external 需列进)
//   - 这套 JSAPI 在部分固件不可用 (拿不到三个方法) -> 退回 exec 注入
//   - exec 注入法: /bin/hal-screen on 每 6s 一次 (比 send_event slip 可靠, 实测 40s 不睡)
//     注意 hal-screen on 会注入一次触摸, 可能误触控制条 -> 调用方负责还原控制条状态
import { bilinet } from './native.js'
import { logDebug } from '../core/log.js'

let timer = null

function hasJsapi() {
  try {
    const b = (typeof brightness !== 'undefined') ? brightness : null
    return !!(b && typeof b.startAlwaysScreenOn === 'function' && typeof b.stopAlwaysScreenOn === 'function')
  } catch (e) { return false }
}

export function screenOnStart() {
  if (timer != null) return
  try {
    const b = (typeof brightness !== 'undefined') ? brightness : null
    if (b && typeof b.startAlwaysScreenOn === 'function') { b.startAlwaysScreenOn(); return }
  } catch (e) {}
  // 降级: exec 每 6s 点亮一次
  const tick = function () {
    try { if (bilinet && typeof bilinet.exec === 'function') bilinet.exec('/bin/hal-screen on') } catch (e) {}
  }
  tick()
  timer = setInterval(tick, 6000)
}

export function screenOnStop() {
  if (timer != null) { clearInterval(timer); timer = null }
  try {
    const b = (typeof brightness !== 'undefined') ? brightness : null
    if (b && typeof b.stopAlwaysScreenOn === 'function') b.stopAlwaysScreenOn()
  } catch (e) {}
}
