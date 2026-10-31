// 字体安装 —— 已彻底移除 (只保留只读状态查询)
//
// 这里记录为什么这个功能被整块删除, 以免后来者再"优化"回来:
//
//   设备实测的关键机制 (踩了三次才发现):
//     /etc/miniapp/resources/fonts  **本身就是一个挂载点**
//     /dev/mmcblk0p12 -> /etc/miniapp/resources/fonts  ext4 rw
//     字体"存在"是因为这个挂载在; 而这个挂载依附于框架进程的挂载命名空间.
//
//   三次事故:
//     1) overlay 里只放一个字体文件, overlay 一空 -> 挂上去 = 系统字体全消失;
//     2) 无条件 umount 把**系统自己的** fonts.xml 挂载卸掉;
//     3) 重启框架进程想"让它重读字体表" -> 挂载命名空间销毁 -> 字体目录变空,
//        必须重启设备才能恢复.
//
//   结论: 只要碰挂载, 就一定会遇到"挂载状态与预期不一致"的窗口;
//   而这里的代价是整机字体消失. 收益(emoji 字形)远小于风险.
//
// 现在的硬约束 (代码层面已无任何实现, 且被静态门禁守着):
//   1. 本文件不含挂载/卸载/写系统目录的任何代码;
//   2. 全仓禁止重启框架进程 (那会连带销毁字体挂载);
//   3. emoji 改用**本地图片**方案 (tools/gen-emoji.py 产 PNG + 静态 require 映射),
//      不依赖任何系统字体改动.

/** 设备是否支持 (已停用) */
export function available() { return false }

/**
 * 只读状态: 仅用于设置页展示, 不产生任何副作用.
 */
export function status() {
  return {
    safe: true,
    supported: false,
    mounted: false,
    note: 'emoji 已改为本地图片方案, 不再修改系统字体'
  }
}

/** 安装: 功能已移除 (永久拒绝) */
export function install() {
  return {
    ok: false,
    code: 'REMOVED',
    message: '字体安装功能已移除: 它依赖修改系统字体挂载, 曾三次导致系统字体异常. emoji 现使用本地图片, 无需安装字体.'
  }
}

/** 卸载: 功能已移除 (永久拒绝) */
export function remove() {
  return {
    ok: false,
    code: 'REMOVED',
    message: '字体安装功能已移除, 系统字体未被本应用修改, 无需卸载.'
  }
}

/** 兼容旧调用: 已移除 (绝不再重启框架) */
export function restartFramework() {
  return { ok: false, code: 'REMOVED', message: '已移除 (重启框架会连带销毁系统字体挂载)' }
}
export function restartApp() { return restartFramework() }
/** 兼容旧调用 */
export function bundledFontPath() { return '' }
