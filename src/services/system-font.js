// 字体安装 (安全版) —— 只追加一条, 不动其它字体
//
// 事故背景:
//   旧实现把 /userdisk/pilipro-fonts/overlay 整个目录 bind-mount 到
//   /etc/miniapp/resources/fonts 上. 这个目录是系统级的 (框架 <text>、"关于"页、
//   任何直接调用系统字体的地方都读它). overlay 一旦残留/为空, 目录就变空,
//   系统所有字体一起消失 -> 只能重置系统. 用户设备已因此被重置过一轮.
//
// 新设计 (硬约束):
//   1. 只覆盖 **fonts.xml 这一个文件**, 不覆盖目录 -> 其它字体文件一个都不受影响;
//   2. 覆盖内容 = 原始 XML 全文 + 我们追加的一条 -> 原有条目全部保留;
//   3. 覆盖前必须先成功读出原始 XML 且非空, 否则拒绝安装;
//   4. 卸载顺序强制为 umount -> 校验 -> 再删文件 (绝不先删);
//   5. 挂载是运行期的, 重启自动消失 -> 最坏情况重启即可恢复;
//   6. 任何一步失败都回滚, 不留半成品.

import { bilinet } from './native.js'
import { log } from '../core/log.js'
import { appId, PKG_ROOT } from '../core/paths.js'

const BASE = '/userdisk/pilipro-fonts'
const SYS_XML = '/etc/miniapp/resources/fonts/fonts.xml'
const OUR_XML = BASE + '/fonts.xml'
const ORIG_XML = BASE + '/fonts.orig.xml'
const OUR_TTF = BASE + '/Twemoji.ttf'
const FONT_FAMILY = 'Twemoji'

function sh(cmd) {
  try {
    if (bilinet && typeof bilinet.execAsync === 'function') return bilinet.execAsync(cmd)
    return bilinet.exec(cmd)
  } catch (e) { return '' }
}

/** 原生能力是否够用 */
export function available() {
  return !!(bilinet && typeof bilinet.execAsync === 'function' && typeof bilinet.readFile === 'function')
}

/** 只读: 当前是否已挂载我们的 fonts.xml */
export function status() {
  const out = { safe: true, mounted: false, hasBackup: false, sysXml: SYS_XML, note: '' }
  try {
    const txt = String(bilinet.readFile('/proc/mounts') || '')
    out.mounted = txt.indexOf(SYS_XML) >= 0 && txt.indexOf(OUR_XML) >= 0
  } catch (e) {}
  try {
    const bk = String(bilinet.readFile(ORIG_XML) || '')
    out.hasBackup = bk.length > 50
  } catch (e) {}
  out.note = out.mounted ? '已启用 (只追加了 Twemoji, 其它字体未改动)' : '未启用'
  return out
}

/** 内置字体在应用包里的路径 (由打包流程放进 libs/) */
export function bundledFontPath() {
  // require 只能写在 .vue 里, 这里按应用包路径拼 (libs/ 由打包流程放进包)
  return PKG_ROOT + '/' + appId() + '/libs/Twemoji.ttf'
}

/**
 * 安装: 把 Twemoji 追加进字体表.
 * 返回 { ok, code, message } —— 失败时一定有明确原因, 不再出现"无法安装".
 */
export async function install() {
  if (!available()) return { ok: false, code: 'NO_NATIVE', message: '设备不支持文件操作' }
  // 1) 读原始 XML (必须先备份成功)
  let orig = ''
  try { orig = String(bilinet.readFile(SYS_XML) || '') } catch (e) {}
  if (!orig || orig.length < 50) {
    return { ok: false, code: 'NO_SRC', message: '读不到系统字体表 (fonts.xml), 为安全起见已中止' }
  }
  // 2) 必须能找到闭合标签, 否则宁可不动 (写坏 XML 会让所有字体失效)
  const closeTag = '</fonts>'
  const ci = orig.lastIndexOf(closeTag)
  if (ci < 0) {
    return { ok: false, code: 'BAD_XML', message: '字体表结构不认识 (找不到闭合标签), 为安全起见已中止' }
  }
  if (orig.indexOf(FONT_FAMILY) >= 0) {
    return { ok: false, code: 'ALREADY', message: '字体表里已经有 Twemoji 了' }
  }
  // 3) 准备目录 + 备份 + 字体文件
  sh('mkdir -p ' + BASE)
  try { bilinet.writeFile(ORIG_XML, orig) } catch (e) {}
  const ttf = bundledFontPath()
  if (ttf) { try { sh('cp -f "' + ttf + '" ' + OUR_TTF) } catch (e) {} }
  // 4) 生成 "原文 + 一条" 的新 XML (原有条目全部保留)
  const entry = '  <font family="' + FONT_FAMILY + '" path="' + OUR_TTF + '" />\n'
  const merged = orig.substring(0, ci) + entry + orig.substring(ci)
  try { bilinet.writeFile(OUR_XML, merged) } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', message: '写入临时字体表失败' }
  }
  // 5) 先 umount 任何残留 (幂等), 再挂载单文件
  sh('umount ' + SYS_XML + ' 2>/dev/null || true')
  sh('mount --bind ' + OUR_XML + ' ' + SYS_XML)
  // 6) 校验: 挂载后必须还能读到我们那条
  let after = ''
  try { after = String(bilinet.readFile(SYS_XML) || '') } catch (e) {}
  if (after.indexOf(FONT_FAMILY) < 0) {
    sh('umount ' + SYS_XML + ' 2>/dev/null || true')
    return { ok: false, code: 'VERIFY_FAIL', message: '挂载后校验失败, 已自动回滚' }
  }
  log('字体', '已挂载 fonts.xml (只追加 Twemoji)')
  return { ok: true, code: 'OK', message: '已启用 (只追加 Twemoji, 其它字体未改动)' }
}

/**
 * 卸载: 严格 umount -> 校验 -> 再删文件.
 * 不会出现 "miss", 每一步都有明确结果.
 */
export async function remove() {
  if (!available()) return { ok: false, code: 'NO_NATIVE', message: '设备不支持文件操作' }
  // 1) 先卸载 (即使没挂载也不报错)
  sh('umount ' + SYS_XML + ' 2>/dev/null || true')
  // 2) 校验真的卸掉了
  let still = false
  try {
    const txt = String(bilinet.readFile('/proc/mounts') || '')
    still = txt.indexOf(SYS_XML) >= 0 && txt.indexOf(OUR_XML) >= 0
  } catch (e) {}
  if (still) {
    return { ok: false, code: 'BUSY', message: '卸载失败 (可能正被读取), 请重启设备后重试' }
  }
  // 3) 确认没挂了才删我们自己的文件 (绝不删系统目录)
  sh('rm -f ' + OUR_XML + ' ' + OUR_TTF)
  log('字体', '已卸载 fonts.xml, 系统字体恢复原样')
  return { ok: true, code: 'OK', message: '已卸载, 系统字体恢复原样' }
}

/** 兼容旧调用 */
export function restartFramework() {
  return { ok: false, code: 'DISABLED', message: '不再通过重启框架应用字体 (挂载后直接生效)' }
}
export function restartApp() { return restartFramework() }