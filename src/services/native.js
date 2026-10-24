// 原生模块桥 (bilinet) —— 全应用唯一的原生依赖入口
//
// 为什么单独一层: bilinet 是设备侧的 .so (HTTP / 文件 / sqlite / exec), 换机型或固件时
// 只有这一层需要改. 页面与业务模块永远 import 这里, 不直接 import 'bilinet'.
//
// ★ 加载方式 (已用固件符号验证, 别再改):
//   Falcon 只提供原生侧 registerCModuleLoader, JS 侧**没有** requireModule/loadModule,
//   所以原生模块只能靠静态 import 链接 —— 这是唯一正确路径.
//   曾经试过"运行期探测 + 降级", 结果框架没那个 API, 探测必然失败,
//   所有原生能力被误判不可用 (日志/数据库/网络全部静默失效), 白屏照旧.
//
// ★ 缺 .so 会怎样: 静态 import 在链接期失败 -> 整个应用起不来 (白屏 + 无日志).
//   这一条**不能**在 JS 里兜底, 必须由构建链保证:
//     - app.json 的 options.external 声明 ["bilinet"]
//     - CI 出包前断言 AMR 内含 libjsapi_bilinet.so (见 .github/workflows/build.yml)
import { bilinet } from 'bilinet'

export { bilinet }
export default bilinet

/** 原生能力状态 (设置页排障用): 有对象即视为可用, 再逐项探测方法 */
export function nativeStatus() {
  const has = (k) => !!(bilinet && typeof bilinet[k] === 'function')
  const methods = ['httpGetAsync', 'httpPostAsync', 'readFile', 'writeFile', 'mkdirs', 'dbOpen', 'dbQuery', 'execAsync']
  const missing = methods.filter((m) => !has(m))
  return {
    ok: missing.length === 0,
    error: missing.length ? ('缺少方法: ' + missing.join(',')) : '',
    methods: methods
  }
}
