// 桩件: 设备上的 'global' JSAPI (ime.js 用它的 startTextEdit 拉起系统输入法)
const noop = () => undefined
export default {
  startTextEdit: noop,
  closeTextEdit: noop,
  on: noop,
  off: noop
}
