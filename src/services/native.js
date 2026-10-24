// 原生模块桥 (bilinet) —— 全应用唯一的原生依赖入口
//
// 为什么单独一层: bilinet 是设备侧的 .so (HTTP / 文件 / sqlite / exec), 换机型或固件时
// 只有这一层需要改. 页面与业务模块永远 import 这里, 不直接 import 'bilinet'.
//
// ★ 血泪教训 (真机实测): ES 静态 import 一个不存在的原生模块, 会让**整个应用**在链接阶段挂掉
//   —— 表现是页面 Elm=0 (白屏)、连日志文件都不生成, 排查时看不到任何报错.
//   所以这里做 **防御式加载**: 拿不到就返回 null, 应用照常启动,
//   由 core/env.js 的 capabilities() 报告能力缺失, 业务层按能力降级.

let impl = undefined
let loadErr = ''

/** 尝试获取原生模块; 失败返回 null. 结果会被缓存. */
export function native() {
  if (impl !== undefined) return impl
  const tryOne = (name) => {
    // 1) 框架模块注册表 (与静态 import 等价, 但失败可捕获)
    try {
      if (typeof $falcon !== 'undefined' && $falcon && typeof $falcon.requireModule === 'function') {
        const m = $falcon.requireModule(name)
        if (m) return (m.default || m)
      }
    } catch (e) { loadErr = String(e) }
    // 2) 全局注入式 (部分固件把原生模块挂到全局)
    try {
      const g = (typeof globalThis !== 'undefined') ? globalThis : null
      if (g && g[name]) return g[name]
    } catch (e) { loadErr = String(e) }
    return null
  }
  impl = tryOne('bilinet')
  if (!impl && !loadErr) loadErr = '原生模块 bilinet 未注册'
  return impl
}

/** 原生能力状态 (给设置页 / 排障用) */
export function nativeStatus() {
  const m = native()
  return { ok: !!m, error: m ? '' : loadErr }
}

/**
 * 直接取对象 —— 模块缺失时**返回安全的空实现**, 而不是抛异常.
 *
 * 为什么不做成 undefined: log / store / auth 这些模块在应用最早期就要用,
 * 如果每次调用都要判空, 调用点会遍布 if, 一旦漏一个就是白屏.
 * 返回 null 的空函数可以让各模块既有的"失败降级"分支自然生效
 * (日志写不进去 -> 丢弃; 数据库打不开 -> 退回文件; 网络失败 -> 报网络错误).
 */
const NOOP = function () { return null }
export const bilinet = new Proxy({}, {
  get(_t, key) {
    const m = native()
    if (!m) return NOOP
    const v = m[key]
    if (typeof v === 'function') return v.bind(m)
    if (v === undefined) return NOOP
    return v
  }
})

export default bilinet
