// 原生模块安全层 (services/native.js)
//
// 背景: 真机间歇性报 "this object js call is disabled".
// 来源已经定位到 SDK 源码 —— iot-miniapp-sdk/src/jqutil_v2/JQObjectTemplate.cpp:311-314:
//
//     JQBaseObject* thisCppObj = JQUnwrap< JQBaseObject >(this_val);
//     if (thisCppObj && thisCppObj->isJSCallDisabled()) {
//         return JS_ThrowInternalError(ctx, "this object js call is disabled");
//     }
//
// 也就是: 调用的那个原生对象**已经被销毁/停用**了 (页面销毁、上下文重建、上一次启动
// 留下的句柄). 用户侧的现象是"多次打开软件后偶发报错, 重开一次就好" —— 典型的
// 陈旧句柄 (stale handle).
//
// 做法: 不直接 import 原生模块用, 走这一层.
//   1) 第一次用当前缓存的模块实例;
//   2) 抛 "disabled" 就**重新 require 一次**再试 (框架对 external 原生模块可能
//      返回复用的实例, 重新 require 至少能拿到当前生命周期的那一个);
//   3) 两次都失败才把错误抛出去 —— 调用方本来就有 try/catch, 不会把应用带崩.
//
// 为什么用显式方法表而不是 Proxy: QuickJS 20200705 的 Proxy 行为没在本机验证过,
// 而实际用到的原生方法就这十几个 (全仓库 grep 出来的), 枚举比赌特性安全.
import { bilinet as rawBilinet } from 'bilinet'
import { log } from './log.js'

var METHODS = [
  'exec', 'execAsync',
  'httpGet', 'httpGetAsync', 'httpPost', 'httpPostAsync',
  'readFile', 'writeFile', 'deleteFile', 'fileExists', 'mkdirs',
  'dbOpen', 'dbExec', 'dbQuery', 'dbClose'
]

var cur = rawBilinet

function acquire() {
  try {
    // eslint-disable-next-line
    var m = require('bilinet')
    if (m) cur = m
  } catch (e) { /* 拿不到就继续用旧的, 下面会自然失败 */ }
  return cur
}

function isDisabled(e) {
  var m = e && e.message !== undefined ? String(e.message) : String(e)
  return m.indexOf('disabled') >= 0
}

var api = {}
for (var i = 0; i < METHODS.length; i++) {
  (function (name) {
    api[name] = function () {
      var args = Array.prototype.slice.call(arguments, 0)
      var lastErr = null
      for (var attempt = 0; attempt < 2; attempt++) {
        var mod = attempt === 0 ? cur : acquire()
        if (!mod || typeof mod[name] !== 'function') {
          lastErr = new Error('native.' + name + ' 不可用')
          continue
        }
        try {
          return mod[name].apply(mod, args)
        } catch (e) {
          lastErr = e
          if (!isDisabled(e)) throw e
          try { log('native', name + ' 句柄失效, 重新获取原生模块后重试') } catch (e2) {}
        }
      }
      throw lastErr || new Error('native.' + name + ' 失败')
    }
  })(METHODS[i])
}

// 全仓库原来的写法是 import { bilinet } from 'bilinet' —— 保持同名导出,
// 这样替换只是换 import 路径, 调用点一行都不用动.
export var bilinet = api
export default api
