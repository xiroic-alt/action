// 应用入口
// 参考 references/miniapp 与 skill falcon-runtime.md:
// - 不调用 setViewPort, 使用固件 cfg.json 中的屏幕几何 (960x266, direction 270)
// - 统一注册 BasePage 管理事件/timer 资源
import { BasePage } from './base-page.js'

// 构建标记: 每批改动换一次. install 不重启宿主时最容易"跑的还是旧包",
// 有这行日志就能一眼确认当前跑的到底是哪一版 (index.vue 里也有一份, 这里进日志首行)
const BUILD_TAG = 'P36-m3'

// 注册 bilinet 原生模块 (bili.js 的 httpGet 依赖它)
import { bilinet, isJSApiNotReady } from './services/native.js'
try {
  console.log('[app] bilinet.httpGet=' + (typeof bilinet.httpGet))
} catch (e) {
  console.warn('[app] bilinet import check failed: ' + (e && e.message ? e.message : e))
}

// 启动即载入登录态到内存 (数据库 -> KV -> memory), 各页面同步读取
import { initAuth } from './services/auth.js'

// 运行日志: 落盘到 /userdisk/xiro/bilibili.log
import { initLog, log, setLogLevel } from './services/log.js'
import { getCfg } from './services/config.js'

// 启动期的原生调用要能重试.
// 真机现象: 反复打开应用时偶发 this object js call is disabled; 重开一次就好.
// 成因: 那是一个启动竞态 —— 宿主还没把 JSAPI 对象绑到当前上下文
// (SDK: isJSCallDisabled() = !((intptr_t)_ctx & 0x01)), 而我们在 onLaunch 里就开始调用.
// 框架日志里同一时刻还有 getAppDataDir() failed, no package installed, 是同一次启动期未就绪.
// 做法: 识别出这类错误就退避重试; 业务错误照旧直接报出来, 不做无意义的重试.
var RETRY_DELAYS = [200, 600, 1500]
function initWithRetry(label, fn) {
  var i = 0
  function attempt() {
    try { fn(); return } catch (e) {
      var msg = e && e.message ? String(e.message) : String(e)
      if (!isJSApiNotReady(e) || i >= RETRY_DELAYS.length) {
        try { console.warn('[app] ' + label + ' 失败: ' + msg) } catch (e2) {}
        return
      }
      var d = RETRY_DELAYS[i++]
      try { console.warn('[app] ' + label + ' JSAPI 未就绪, ' + d + 'ms 后重试') } catch (e3) {}
      setTimeout(attempt, d)
    }
  }
  attempt()
}
class App extends $falcon.App {
  constructor() {
    super()
  }

  /**
   * 应用生命周期:应用启动. 初始化完成时回调,全局只触发一次.
   * @param {Object} options 启动参数
   */
  onLaunch(options) {
    super.onLaunch(options)
    // ★ 顺序不能反: initAuth() 里会 initStore() 打开 bilibili.db, 而设置也存同一个库.
    //   原来先 setLogLevel(getCfg('logLevel')) 再 initAuth() —— getCfg 在数据库打开**之前**
    //   就把配置读进来了, 于是走了"文件兜底"分支并缓存; 等数据库就绪时缓存已经填满,
    //   迁移逻辑再也没机会跑. 真机现象: kv 表建出来了却一行数据没有, cfg.json 一直留着.
    // initAuth 里面会 initStore 开 bilibili.db; 设置也存同一个库, 所以它必须先跑
    initWithRetry('initAuth', initAuth)
    // 日志级别来自设置 (config.logLevel); 先 initLog 再设级别, 保证"日志不可用"这类
    // 启动期问题无论如何都留下痕迹
    initWithRetry('initLog', function () {
      initLog(BUILD_TAG + ' appid=8001812345678901')
      setLogLevel(getCfg('logLevel'))
    })
    // 设置页面基类,应用全局的$falcon.Page将被替换成此处指定的BasePage.
    $falcon.useDefaultBasePageClass(BasePage)
  }

  /**
   * 应用生命周期,应用启动或应用从后台切换到前台时触发
   */
  onShow() {
    super.onShow()
  }

  /**
   * 应用生命周期:应用退出前或者应用从前台切换到后台时触发
   */
  onHide() {
    super.onHide()
  }

  /**
   * 应用生命周期:应用销毁前触发
   */
  onDestroy() {
    super.onDestroy()
  }
}

export default App
