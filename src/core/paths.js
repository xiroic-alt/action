// 落盘路径 —— 全应用唯一的路径来源 (依据设备固件的 miniapp 数据落盘规范)
//
// 规范依据 (设备固件实测, 见 VM 工作区 SPEC-miniapp-data-layout.md):
//   - 每个 app 的**数据体**在 /userdisk/miniapp/data/mini_app/pkg/<appid>/data/
//     这一层会被系统「空间清理」按包统计, 且**覆盖安装/升级时不会被替换**
//     (安装体 a/ 会被整体替换, 所以业务数据绝对不能写那里)
//   - 键值/数据库的实测形态: <appid>/data/sharedpreferences/preferences.json 与 <appid>/data/database/*.db
//   - /userdata 只有 125MB(实测已用 80%), 不适合放大文件; /userdisk 是 54GB 主分区
//
// ★ appid 运行时从 $falcon.$appid 取, 不在代码里散落第二处 —— 否则改 appid 要改 N 个文件.
//   取不到时退回构建期常量 (与 package.json 的 appid 必须一致, 由门禁校验).

export const APPID_FALLBACK = '8009476000000001'
export const PKG_ROOT = '/userdisk/miniapp/data/mini_app/pkg'

/** 当前应用 appid (运行时优先) */
export function appId() {
  try {
    if (typeof $falcon !== 'undefined' && $falcon && $falcon.$appid) return String($falcon.$appid)
  } catch (e) {}
  return APPID_FALLBACK
}

/** 应用数据根目录 (规范位置) */
export function dataDir() { return PKG_ROOT + '/' + appId() + '/data' }

/** 数据库目录 (规范里 database/*.db 的位置) */
export function dbDir() { return dataDir() + '/database' }
export function dbPath() { return dbDir() + '/pilipro.db' }

/** 运行日志 */
export function logPath() { return dataDir() + '/pilipro.log' }
export function logPrevPath() { return dataDir() + '/pilipro.log.1' }

/** 兜底文件 (数据库不可用时) */
export function kvFilePath() { return dataDir() + '/kv.json' }
export function authFilePath() { return dataDir() + '/auth.json' }

/** 统一的"确保目录存在" */
export function ensureDirs(bilinet) {
  if (!bilinet || typeof bilinet.mkdirs !== 'function') return false
  try {
    bilinet.mkdirs(dataDir())
    bilinet.mkdirs(dbDir())
    return true
  } catch (e) { return false }
}
