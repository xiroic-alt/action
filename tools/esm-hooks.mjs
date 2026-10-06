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
  if (url.startsWith('file:') && url.split('?')[0].endsWith('.vue')) {
    const src = fs.readFileSync(new URL(url), 'utf8')
    const m = /<script>([\s\S]*?)<\/script>/.exec(src)
    if (!m) throw new Error('没有 <script> 块: ' + url)
    const head = "const require = (p) => p;\n"
    return { format: 'module', source: head + m[1], shortCircuit: true }
  }
  return next(url, context)
}
