// 设备全局桩件 —— 在 import 被测模块之前装好
// $falcon.$appid / $falcon.jsapi 在门禁里需要存在, 否则 paths.js 会走兜底分支而测不到真实路径.
globalThis.$falcon = {
  $appid: '8009476000000001',
  Page: class Page {},
  App: class App {},
  navTo() {}, navBack() {}, finish() {},
  useDefaultBasePageClass() {},
  jsapi: {}
}
globalThis.$page = { options: {}, finish() {}, setTimeout, clearTimeout, setInterval, clearInterval }
