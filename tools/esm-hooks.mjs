// Node 原生 ESM 解析/加载钩子 —— 只给 tools/check-ui.mjs 用, 不进 ui/src, 不参与打包.
//
// 做两件事:
//  1) 把设备侧的原生 JSAPI 模块名映射到本地桩件 (bilinet / pm / brightness / systemInfo);
//  2) 让 Node 能直接 import 一个 .vue: 取它的 <script> 块, 补一个 require 桩
//     (页面的图标是用 require('../../assets/mi/x.png') 声明的, aiot-cli 在打包时
//      把它编成 images/<hash>.png; 运行时没有 require, 所以我们这里补一个返回占位串的).
//
// 这样页面脚本能走**真实的 ES 链接**: 少写一个命名导出、写错模块名, 这里立刻报,
// 而不是等到装机黑屏 (HANDOVER §25.7 就是这类事故, 当时只有真机能发现).

import fs from 'node:fs'

const HERE = import.meta.url

const STUB = {
  bilinet: './stubs/bilinet.mjs',
  pm: './stubs/pm.mjs',
  brightness: './stubs/brightness.mjs',
  systemInfo: './stubs/systemInfo.mjs',
  global: './stubs/global.mjs',
  gstplayer: './stubs/empty.mjs'
}

export async function resolve(specifier, context, next) {
  if (specifier in STUB) return { url: new URL(STUB[specifier], HERE).href, shortCircuit: true }
  return next(specifier, context)
}

export async function load(url, context, next) {
  // ui/src 下的 .js 一律按 ESM 解析.
  // 为什么必须显式声明: CI 用 Node 18, 它**没有**模块语法自动探测 (那是 Node 22.7+ 的默认行为,
  // 本机 Node 24 会"猜"成 ESM 所以本地看起来没问题) —— 不写这条, CI 上 import m3-scheme.js
  // 会直接 SyntaxError: Unexpected token 'export'.
  if (url.startsWith('file:') && url.split('?')[0].endsWith('.js') && url.indexOf('/ui/src/') >= 0) {
    return { format: 'module', source: fs.readFileSync(new URL(url), 'utf8'), shortCircuit: true }
  }
  if (url.startsWith('file:') && url.split('?')[0].endsWith('.vue')) {
    const src = fs.readFileSync(new URL(url), 'utf8')
    const m = /<script>([\s\S]*?)<\/script>/.exec(src)
    if (!m) throw new Error('没有 <script> 块: ' + url)
    const head = "const require = (p) => p;\n"
    return { format: 'module', source: head + m[1], shortCircuit: true }
  }
  return next(url, context)
}
