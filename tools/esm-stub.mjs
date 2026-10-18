// Node 侧的模块解析钩子 —— 把设备专有模块名映射到本地桩件
//
// 为什么需要: src/core/* 与 services/native.js 会 import 'bilinet' (设备侧 .so 模块),
// Node 里没有这个包, 门禁会直接 ERR_MODULE_NOT_FOUND. 这里用 loader hook 指向内存桩件,
// 于是门禁测的是**同一份源码**, 而不是被改过的副本.
//
// ★ 路径用 new URL('./x.mjs', import.meta.url) 解析: 直接拼 pathname 在 Windows 上会变成
//   D:\D:\... (pathname 已带盘符), 这个坑在两种平台上都必须避开.
const STUB = new URL('./stub-bilinet.mjs', import.meta.url).href

export async function resolve(specifier, context, next) {
  if (specifier === 'bilinet') return { url: STUB, shortCircuit: true }
  // 其它设备侧模块名 (输入法/亮度/包管理) 也指向同一个桩件
  if (specifier === 'brightness' || specifier === 'global' || specifier === 'pm') {
    return { url: STUB + '?name=' + specifier, shortCircuit: true }
  }
  return next(specifier, context)
}
