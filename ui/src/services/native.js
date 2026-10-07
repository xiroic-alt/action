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

// ★ 这里**不能** import log.js. 原来为了记一行「句柄失效」引了它, 结果是
//   native.js -> log.js -> native.js 的循环依赖: log.js 顶层的
//   import { bilinet } from './native.js' 会在 native.js 还没求值完时拿到未初始化绑定,
//   启动期就变成一整片 JSAPI 不可用. 这一层是最底层的, 不许依赖上层任何模块.
function warn(msg) {
  try { console.warn('[native] ' + msg) } catch (e) {}
}

var METHODS = [
  'exec', 'execAsync',
  'httpGet', 'httpGetAsync', 'httpPost', 'httpPostAsync',
  'readFile', 'writeFile', 'deleteFile', 'fileExists', 'mkdirs',
  'dbOpen', 'dbExec', 'dbQuery', 'dbClose'
]

var cur = rawBilinet

// 取一份**当前上下文**的原生模块.
//
// ★ 这里是这个 bug 的关键: 用户复现方式是"返回桌面再进入", 不是杀进程重开 ——
//   进程活着, 但小程序的 JS 上下文会重建; 上一次上下文里的原生对象此时已经
//   isJSCallDisabled() (SDK: !((intptr_t)_ctx & 0x01), 判的就是有没有绑到活上下文).
//   模块级的 cur 缓存 + 框架对 external 模块的 require 缓存都可能**跨上下文复用**,
//   于是一进应用就是一片 disabled, 再退再进才好 —— 正是用户描述的现象.
//
// 所以: 每次调用都重新取, 而且优先走框架的 $falcon.jsapi 表 (auth.js 用的
// $falcon.jsapi.storage 就是这条路), 它是按上下文活的; 取不到再退回 require.
var diagOnce = false
function acquire() {
  // 1) 框架 JSAPI 表 (按上下文活)
  try {
    var j = $falcon && $falcon.jsapi
    if (j) {
      var b = j.bilinet
      if (!b && typeof j.get === 'function') b = j.get('bilinet')
      if (b && typeof b.readFile === 'function') {
        if (!diagOnce) { diagOnce = true; warn('原生模块取自 $falcon.jsapi.bilinet') }
        cur = b
        return cur
      }
      if (!diagOnce) {
        diagOnce = true
        var ks = []
        for (var k in j) { try { ks.push(k) } catch (e0) {} }
        warn('$falcon.jsapi 里没有 bilinet, 现有键: ' + ks.join(','))
      }
    } else if (!diagOnce) {
      diagOnce = true
      warn('$falcon.jsapi 不存在, 退回 require(bilinet)')
    }
  } catch (e1) {}
  // 2) 退回 require (每次重新要, 不吃模块级缓存)
  try {
    // eslint-disable-next-line
    var m = require('bilinet')
    if (m) cur = m
  } catch (e2) { /* 拿不到就继续用旧的, 下面会自然失败 */ }
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
      if (deadCtx) return neutralFor(name)
      var lastErr = null
      // 每次都重新取: 跨上下文复用旧绑定是这次问题的根, 不能省这一步
      for (var attempt = 0; attempt < 2; attempt++) {
        var mod = attempt === 0 ? acquire() : acquire()
        if (!mod || typeof mod[name] !== 'function') {
          lastErr = new Error('native.' + name + ' 不可用')
          continue
        }
        var out
        try {
          out = mod[name].apply(mod, args)
        } catch (e) {
          lastErr = e
          if (!isDisabled(e)) throw e
          warn(name + ' 句柄未绑定, 重新获取原生模块后重试')
          continue
        }
        // ★ 异步方法必须单独兜: 它的失败是 **promise 拒绝**, 外面的 try/catch 抓不到 ——
        //   真机上看到的正是 Possibly unhandled promise rejection: InternalError:
        //   this object js call is disabled, 栈是 at apply (native), 同步 catch 一行都进不去.
        if (out && typeof out.then === 'function') {
          return out.then(null, function (e) {
            if (!isDisabled(e)) throw e
            var m2 = acquire()
            if (!m2 || typeof m2[name] !== 'function') { markDead(name); return neutralFor(name) }
            return m2[name].apply(m2, args).then(null, function (e2) {
              if (!isDisabled(e2)) throw e2
              markDead(name)
              return neutralFor(name)
            })
          })
        }
        return out
      }
      // 两次都 disabled -> 上下文已死, 不再抛 (抛出去只会变 unhandled rejection)
      if (lastErr && isDisabled(lastErr)) { markDead(name); return neutralFor(name) }
      throw lastErr || new Error('native.' + name + ' 失败')
    }
  })(METHODS[i])
}

// 上下文作废的判定与降级.
// 真机实测 (返回桌面再进入, 不杀进程): acquire() 取回来的**还是**那个 disabled 对象 ——
// 说明重取本身发生在一个已经作废的 JS 上下文里 (旧页面的 setTimeout / promise 回调在
// 上下文销毁后仍在跑). 这种情况下再往外抛, 只会变成框架日志里的
// "Possibly unhandled promise rejection: InternalError: this object js call is disabled".
// 所以: 连试两次都 disabled -> 认定这个上下文已死, 后续原生调用直接走中性值,
// 不再制造噪音; 下一次真正重新进入应用会拿到新上下文, 一切照常.
var deadCtx = false
var deadLogged = false
// 各原生方法在"上下文已死"时的中性返回值 (读操作给空, 写操作给 false, 异步给 resolve)
var NEUTRAL = {
  readFile: '', writeFile: false, deleteFile: false, fileExists: false, mkdirs: false,
  exec: '', execAsync: '', httpGet: '', httpPost: '',
  httpGetAsync: '', httpPostAsync: '',
  dbOpen: false, dbExec: false, dbQuery: []
}
function neutralFor(name) {
  var v = NEUTRAL[name]
  if (v === undefined) return undefined
  if (name.indexOf('Async') > 0) return Promise.resolve(v)
  return v
}
function markDead(name) {
  deadCtx = true
  if (!deadLogged) {
    deadLogged = true
    warn('原生上下文已作废 (连试两次仍 disabled), 后续原生调用走中性值. 下次进入应用会自动恢复. 触发点: ' + name)
  }
}
// 只给离线回归用: 清掉"上下文已死"标记, 免得一个用例把后面所有用例都带成中性值
export function __resetDeadForTest() { deadCtx = false; deadLogged = false }

// 判断一个错误是不是「对象没绑到活上下文」(this object js call is disabled).
// 导出给上层用: 启动期的原生调用失败要能识别出来并重试, 而不是当成业务错误丢掉.
export function isJSApiNotReady(e) {
  var m = e && e.message !== undefined ? String(e.message) : String(e)
  return m.indexOf('disabled') >= 0
}
// 全仓库原来的写法是 import { bilinet } from 'bilinet' —— 保持同名导出,
// 这样替换只是换 import 路径, 调用点一行都不用动.
export var bilinet = api
export default api
