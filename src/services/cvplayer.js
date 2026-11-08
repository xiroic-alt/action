// cvplayer 探测层 (官方视频播放器用的那个模块, 固件 libjsapi_export.so 提供)
//
// 为什么单独一层: 它是**外部原生模块**, 解析不到就是 undefined —— 不能让它污染播放页.
// 所有对 cvplayer 的访问都从这里走, 上层只看到 "有没有能力".
//
// 官方用法 (从播放器字节码原子表还原):
//   cvplayer | CVPlayer | getCVPlayerManager
//   setDataSource | setVideoSurface | setAudioDeviceType | seekto | setRate
//   onCvplayerState | onCvplayerInfo | onCvplayerPosition | onCvplayerComplete
//   onAudioDeviceTypeChanged | onCvplayerResume
import * as CV from 'cvplayer'
import { log } from '../core/log.js'

/** 探测结果 (只跑一次) */
let probed = null

export function cvStatus() {
  if (probed) return probed
  const root = (CV && (CV.default || CV)) || null
  const out = { ok: false, rootType: typeof root, keys: [], mgrKeys: [], err: '' }
  try {
    if (!root) { out.err = 'cvplayer 模块解析为 undefined'; probed = out; return out }
    out.keys = Object.keys(root)
    // 找 CVPlayer 或 getCVPlayerManager
    const CVP = root.CVPlayer || root.default || root
    const getMgr = (CVP && CVP.getCVPlayerManager) || root.getCVPlayerManager
    out.cvpType = typeof CVP
    out.getMgrType = typeof getMgr
    if (typeof getMgr === 'function') {
      try {
        const mgr = getMgr()
        out.mgrKeys = mgr ? Object.keys(mgr) : []
        out.ok = !!mgr
        if (!mgr) out.err = 'getCVPlayerManager() 返回空'
      } catch (e2) { out.err = '取管理器失败: ' + (e2 && e2.message ? e2.message : e2) }
    } else { out.err = '没有 getCVPlayerManager' }
  } catch (e) { out.err = '探测异常: ' + (e && e.message ? e.message : e) }
  probed = out
  return out
}

/** 打一条探测日志 (app 启动时调一次) */
export function logCvStatus() {
  const s = cvStatus()
  log('cvplayer', 'ok=' + s.ok + ' root=' + s.rootType + ' keys=[' + s.keys.join(',') + ']')
  log('cvplayer', 'getMgr=' + s.getMgrType + ' mgrKeys=[' + s.mgrKeys.join(',') + '] err=' + s.err)
  return s
}
