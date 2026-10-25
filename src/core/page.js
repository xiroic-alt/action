// 页面基类 —— 统一资源生命周期
//
// 设备侧两条硬事实:
//   1. **组件**里只有 onShow 会被框架转发 (组件的 onLoad/created 不触发);
//      但 **页面类**(BasePage) 的 onLoad 会被调用 —— 页面参数只能从那里拿
//   2. timer / 订阅 / native 对象没收干净, 第二次进页面就会叠加 (内存与行为双泄漏)
//
// 所以所有页面都从这里继承, 用 this.setTimer / this.setInterval / this.onFalcon 登记资源,
// onUnload 里统一释放. 页面自己不需要写清理代码.

export class BasePage extends $falcon.Page {
  constructor() {
    super()
    this._timers = []
    this._intervals = []
    this._subs = []
    this._unloaded = false
    // Vue2 的 methods 会被挂到实例上; 框架调用的是 $page 钩子, 所以这里做一层转发
    if (typeof this.onShow !== 'function') this.onShow = function () {}
  }

  /**
   * 页面参数入口 —— 这是 navTo(target, options) 的参数真正落地的地方.
   *
   * ★ 之前基类没实现 onLoad, 于是 $page.options 永远是 {} ——
   *   真机日志 "缺少 bvid 参数 (options={})" 就是这么来的.
   *   参考实现 (references/miniapp) 的做法: onLoad/onNewOptions 里把 options 存到 this.options,
   *   页面组件随后用 this.$page.options 就能读到.
   */
  onLoad(options) {
    this.options = options || {}
    const p = Object.getPrototypeOf(BasePage.prototype)
    try { if (p && typeof p.onLoad === 'function') p.onLoad.call(this, options) } catch (e) {}
  }

  /** 页面被再次拉起 (navTo 到已存在的页面) 时的新参数 */
  onNewOptions(options) {
    this.options = options || {}
    const p = Object.getPrototypeOf(BasePage.prototype)
    try { if (p && typeof p.onNewOptions === 'function') p.onNewOptions.call(this, options) } catch (e) {}
  }

  /** 登记一次性定时器 (自动释放) */
  setTimer(fn, ms) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter((t) => t !== id)
      if (!this._unloaded) fn()
    }, ms)
    this._timers.push(id)
    return id
  }

  /** 登记周期定时器 (自动释放) */
  setInterval(fn, ms) {
    const id = setInterval(() => { if (!this._unloaded) fn() }, ms)
    this._intervals.push(id)
    return id
  }

  /** 登记 Falcon 订阅 (自动 off) */
  onFalcon(target, event, handler) {
    if (!target || typeof target.on !== 'function') return null
    target.on(event, handler)
    this._subs.push({ target, event, handler })
    return handler
  }

  clearTimer(id) {
    if (id == null) return
    clearTimeout(id)
    this._timers = this._timers.filter((t) => t !== id)
  }
  clearInterval(id) {
    if (id == null) return
    clearInterval(id)
    this._intervals = this._intervals.filter((t) => t !== id)
  }

  /** 框架在页面卸载时调用 */
  onUnload() {
    this._unloaded = true
    for (const id of this._timers) clearTimeout(id)
    for (const id of this._intervals) clearInterval(id)
    for (const s of this._subs) {
      try { if (s.target && typeof s.target.off === 'function') s.target.off(s.event, s.handler) } catch (e) {}
    }
    this._timers = []
    this._intervals = []
    this._subs = []
    if (typeof this.onPageUnload === 'function') this.onPageUnload()
  }
}
