// 应用入口
//
// 顺序有讲究:
//   1. installConsoleBridge() 最先 —— 之后所有 console 都进日志 (debug 级)
//   2. initStore() 打开数据库
//   3. initAuth() 读登录态 (依赖数据库)
//   4. initLog() 写第一行日志 (依赖日志目录)
//   5. setLogLevel(getCfg()) 应用用户设置
//   6. runFeatureInits() 功能模块启动钩子 (依赖设置已就绪)
//   7. useDefaultBasePageClass(BasePage) 替换框架页基类
import { BasePage } from './core/page.js'
import { ensureEmoji } from './services/bili-emoji.js'
import { installConsoleBridge, initLog, setLogLevel, log } from './core/log.js'
import { initStore, storeStatus } from './core/store.js'
import { initAuth } from './core/auth.js'
import { getCfg } from './core/config.js'
import { runFeatureInits } from './features/index.js'

const BUILD_TAG = 'PiliPRO-0.1.0001'

// ★ MODULE_SCOPE_BASE_PAGE: 页面基类必须在**模块加载时**就注册好.
//
// 真机现象: 从桌面图标启动时黑屏, 框架日志报
//   cannot read property 'prototype' of undefined at __loadPage
// 原因: 桌面启动时框架可能先创建页面、后跑 App.onLaunch;
//       而基类原来只在 onLaunch 里注册, 页面创建时 $falcon.Page 还是原版,
//       页面类拿不到我们 BasePage 的 prototype, 整页加载失败 -> 黑屏.
// 修法: 模块顶层就注册 (模块一定早于任何页面实例化), onLaunch 里再兜一次.
try { $falcon.useDefaultBasePageClass(BasePage) } catch (e) {
  try { console.log('[app] 模块级注册页面基类失败: ' + e) } catch (e2) {}
}

// ★ 基类方法不保证都存在: 真机日志出现过
//   "TypeError: cannot read property 'onDestroy' of undefined"
//   —— $falcon.App 上没有 onDestroy 时, super.onDestroy() 直接炸.
//   所以所有 super 调用都必须先判存在.
function superCall(self, name, arg) {
  try {
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(self))
    if (proto && typeof proto[name] === 'function') return proto[name].call(self, arg)
  } catch (e) {}
  return undefined
}

class App extends $falcon.App {
  onLaunch(options) {
    superCall(this, 'onLaunch', options)
    // 兜底再注册一次 (幂等): 保证即便模块级那行被异常打断也能生效
    try { $falcon.useDefaultBasePageClass(BasePage) } catch (e) {}
    installConsoleBridge()
    initLog(BUILD_TAG + ' appid=8009476000000001')
    try { initStore() } catch (e) { log('应用', '存储初始化异常: ' + e) }
    try { initAuth() } catch (e) { log('应用', '登录态初始化异常: ' + e) }
    setLogLevel(getCfg('logLevel'))
    try { runFeatureInits() } catch (e) { log('应用', '功能初始化异常: ' + e) }
    // 异步加载 B 站表情表 ([doge] 这类): 不阻塞启动, 首次成功后写进 KV, 之后离线可用.
    // 富文本是同步渲染的, 拿不到异步结果时退回 [名称] 文字, 所以这里 fire-and-forget.
    try { ensureEmoji() } catch (e) { log('应用', '表情初始化异常: ' + e) }
    // ★ jsapi 探测 (一次性): Falcon 的官方模块接入是 import x from '$jsapi/x'
    //   它编译成 $falcon.jsapi['x']. 这里把实际可用的模块名列出来, 决定能不能用 cvplayer
    //   (官方视频播放器用的就是 cvplayer, 它有 setAudioDeviceType 能做蓝牙热切).
    try {
      const j = ($falcon && $falcon.jsapi) || null
      if (!j) { log('jsapi 探测', '❌ $falcon.jsapi 不存在') }
      else {
        const keys = Object.keys(j)
        log('jsapi 探测', '共 ' + keys.length + ' 个: ' + keys.join(','))
        const want = ['cvplayer', 'videoplayer', 'volume', 'bluetooth', 'headSetInfo', 'sound_player', 'global', 'systemInfo']
        const has = want.filter(function (k) { return !!j[k] })
        const miss = want.filter(function (k) { return !j[k] })
        log('jsapi 探测', '关键模块有: ' + (has.join(',') || '(无)'))
        log('jsapi 探测', '关键模块缺: ' + (miss.join(',') || '(无)'))
        // cvplayer 的方法面
        const cv = j.cvplayer
        if (cv) {
          log('jsapi 探测', 'cvplayer 方法: ' + Object.keys(cv).join(','))
          const mgrFn = cv.getCVPlayerManager
          log('jsapi 探测', 'getCVPlayerManager 类型: ' + (typeof mgrFn))
          if (typeof mgrFn === 'function') {
            try {
              const mgr = mgrFn()
              log('jsapi 探测', '管理器方法: ' + (mgr ? Object.keys(mgr).join(',') : 'null'))
            } catch (e2) { log('jsapi 探测', '取管理器失败: ' + (e2 && e2.message ? e2.message : e2)) }
          }
        }
      }
    } catch (e) { log('jsapi 探测', '异常: ' + (e && e.message ? e.message : e)) }
    log('应用', '启动完成 · ' + storeStatus())
    $falcon.useDefaultBasePageClass(BasePage)
  }
  onShow() {
    superCall(this, 'onShow')
    // 注意: 这里**不要**做"没有页面就回首页"的兜底.
    // 之前加过, 结果 $falcon.getPage 不存在时 p 恒为 null,
    // 于是每次回前台 (例如输入法关闭后) 都 navTo('index'),
    // 把登录页/详情页直接顶掉 —— 用户表现为"输入完 IP 就自己跳回首页".
  }
  onHide() { superCall(this, 'onHide') }
  onDestroy() { superCall(this, 'onDestroy') }
}

export default App
