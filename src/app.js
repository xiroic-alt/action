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
import { installConsoleBridge, initLog, setLogLevel, log } from './core/log.js'
import { initStore, storeStatus } from './core/store.js'
import { initAuth } from './core/auth.js'
import { getCfg } from './core/config.js'
import { runFeatureInits } from './features/index.js'

const BUILD_TAG = 'PiliPRO-0.1.0001'

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
    installConsoleBridge()
    initLog(BUILD_TAG + ' appid=8009476000000001')
    try { initStore() } catch (e) { log('应用', '存储初始化异常: ' + e) }
    try { initAuth() } catch (e) { log('应用', '登录态初始化异常: ' + e) }
    setLogLevel(getCfg('logLevel'))
    try { runFeatureInits() } catch (e) { log('应用', '功能初始化异常: ' + e) }
    log('应用', '启动完成 · ' + storeStatus())
    $falcon.useDefaultBasePageClass(BasePage)
  }
  onShow() { superCall(this, 'onShow') }
  onHide() { superCall(this, 'onHide') }
  onDestroy() { superCall(this, 'onDestroy') }
}

export default App
