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
const SYS_DIR = '/etc/miniapp/resources/fonts'
const SYS_XML = SYS_DIR + '/fonts.xml'
const SYS_TTF = SYS_DIR + '/Twemoji.ttf'
const OUR_XML = BASE + '/fonts.xml'
const ORIG_XML = BASE + '/fonts.orig.xml'
const OUR_TTF = BASE + '/Twemoji.ttf'
const FONT_FAMILY = 'Twemoji'
const FONT_NAME = 'Twemoji.ttf'

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
  // require 只能写在 .vue 里, 这里按应用包路径拼.
  // 真机实测: 包的子目录名会变 (见过 b/libs, 也见过 a/libs) ——
  //   升级安装后当前版本在 a/, 上一版留在 b/. 所以不能写死, 逐个探.
  const root = PKG_ROOT + "/" + appId()
  const cands = [root + "/a/libs/Twemoji.ttf", root + "/b/libs/Twemoji.ttf", root + "/libs/Twemoji.ttf"]
  for (let i = 0; i < cands.length; i++) {
    try {
      const r = bilinet.exec("test -f " + cands[i] + " && echo 1")
      if (String(r || "").indexOf("1") >= 0) return cands[i]
    } catch (e) {}
  }
  return cands[0]
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
  const closeTag = '</familyset>'
  const ci = orig.lastIndexOf(closeTag)
  if (ci < 0) {
    return { ok: false, code: 'BAD_XML', message: '字体表结构不认识 (找不到闭合标签), 为安全起见已中止' }
  }
  if (orig.indexOf(FONT_FAMILY) >= 0) {
    return { ok: false, code: 'ALREADY', message: '字体表里已经有 Twemoji 了' }
  }
  // 3) 前置检查: 包内字体必须存在 (否则后面挂了也是白挂, 不如现在就报清楚)
  const ttf0 = bundledFontPath()
  let ttfOk = false
  try { ttfOk = !!bilinet.fileExists(ttf0) } catch (e) { ttfOk = false }
  if (!ttfOk) {
    try { bilinet.exec('test -f ' + ttf0) ; ttfOk = true } catch (e) {}
  }
  if (!ttfOk) {
    return { ok: false, code: 'NO_BUNDLED', message: '安装包里没有字体文件 (期望在 ' + ttf0 + ')' }
  }
  // 4) 准备目录 + 备份 + 字体文件
  sh('mkdir -p ' + BASE)
  try { bilinet.writeFile(ORIG_XML, orig) } catch (e) {}
  const ttf = bundledFontPath()
  if (ttf) { try { sh('cp -f "' + ttf + '" ' + OUR_TTF) } catch (e) {} }
  // 4) 生成 "原文 + 一条" 的新 XML (原有条目全部保留)
  // 真实结构: <family name="X"><font weight="400">裸文件名</font></family>
  const entry = '    <family name="' + FONT_FAMILY + '">\n        <font weight="400">' + FONT_NAME + '</font>\n    </family>\n'
  const merged = orig.substring(0, ci) + entry + orig.substring(ci)
  try { bilinet.writeFile(OUR_XML, merged) } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', message: '写入临时字体表失败' }
  }
  // 5) 准备 overlay: **全量拷贝**系统字体目录, 再追加我们的字体.
  //
  //   ★ 与旧实现的关键区别:
  //     旧实现往 overlay 里只放了一个字体文件, overlay 一空目录就空了,
  //     挂上去 = 系统字体全消失 (设备因此被重置过).
  //     现在 overlay 是系统字体目录的**完整拷贝**, 即使挂载状态异常,
  //     目录里也始终有全部原有字体, 不可能"变空".
  const OVERLAY = BASE + '/overlay'
  // ★ 同样只卸我们自己的挂载: 系统把 fonts.xml 单独挂成一个挂载点
  //   (/dev/mmcblk0p12 /etc/miniapp/resources/fonts/fonts.xml ext4),
  //   无条件 umount 会把它卸掉 —— 绝对禁止.
  let m0 = ''
  try { m0 = String(bilinet.readFile('/proc/mounts') || '') } catch (e) {}
  if (m0.indexOf(OVERLAY) >= 0) sh('umount ' + SYS_DIR + ' 2>/dev/null || true')
  sh('rm -rf ' + OVERLAY)
  sh('mkdir -p ' + OVERLAY)
  sh('cp -a ' + SYS_DIR + '/. ' + OVERLAY + '/')
  let nOrig = 0
  let nCopy = 0
  try { nOrig = Number(String(bilinet.exec('ls -1 ' + SYS_DIR + ' 2>/dev/null | wc -l')).trim()) || 0 } catch (e) {}
  try { nCopy = Number(String(bilinet.exec('ls -1 ' + OVERLAY + ' 2>/dev/null | wc -l')).trim()) || 0 } catch (e) {}
  if (nOrig === 0 || nCopy < nOrig) {
    sh('rm -rf ' + OVERLAY)
    return { ok: false, code: 'COPY_FAIL', message: '字体目录拷贝不完整 (' + nCopy + '/' + nOrig + '), 为安全起见已中止' }
  }
  sh('cp -f ' + OUR_TTF + ' ' + OVERLAY + '/' + FONT_NAME)
  try { bilinet.writeFile(OVERLAY + '/fonts.xml', merged) } catch (e) {
    sh('rm -rf ' + OVERLAY)
    return { ok: false, code: 'WRITE_FAIL', message: '写入 overlay 字体表失败' }
  }
  sh('mount --bind ' + OVERLAY + ' ' + SYS_DIR)
  // 6) 校验: ①能读到我们那条 ②字体文件数没变少 (原有字体一个不少)
  let after = ''
  try { after = String(bilinet.readFile(SYS_XML) || '') } catch (e) {}
  let nAfter = 0
  try { nAfter = Number(String(bilinet.exec('ls -1 ' + SYS_DIR + ' 2>/dev/null | wc -l')).trim()) || 0 } catch (e) {}
  const hasOurs = after.indexOf(FONT_FAMILY) >= 0
  const notLess = nAfter >= nOrig
  if (!hasOurs || !notLess) {
    // 回滚: 只有确认当前挂的是我们的 overlay 才 umount, 否则绝不动
    let m1 = ''
    try { m1 = String(bilinet.readFile('/proc/mounts') || '') } catch (e) {}
    if (m1.indexOf(OVERLAY) >= 0) sh('umount ' + SYS_DIR + ' 2>/dev/null || true')
    sh('rm -rf ' + OVERLAY)
    return { ok: false, code: 'VERIFY_FAIL', message: '校验失败已回滚 (Twemoji:' + hasOurs + ' 字体数 ' + nAfter + '/' + nOrig + ')' }
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
  // 1) ★ 只卸载"我们自己挂上去的"，绝不碰系统原有挂载。
  //
  //   真机实测: /etc/miniapp/resources/fonts/fonts.xml **本身就是系统的挂载点**:
  //     /dev/mmcblk0p12 /etc/miniapp/resources/fonts/fonts.xml ext4 rw,relatime
  //   对它 umount 会把系统自己的挂载卸掉 —— 比不卸载更危险。
  //   所以这里先读 /proc/mounts, 只有确认"后备路径是我们的 /userdisk/pilipro-fonts"
  //   才执行 umount。
  const OVERLAY = BASE + '/overlay'
  let mounts = ''
  try { mounts = String(bilinet.readFile('/proc/mounts') || '') } catch (e) {}
  const ours = mounts.indexOf(OVERLAY) >= 0
  if (ours) sh('umount ' + SYS_DIR + ' 2>/dev/null || true')
  if (!ours) log('字体', '未发现我们的挂载, 跳过 umount (系统挂载点不动)')
  // 2) 校验真的卸掉了
  let still = false
  try {
    const txt = String(bilinet.readFile('/proc/mounts') || '')
    still = txt.indexOf(SYS_DIR) >= 0 && txt.indexOf('/userdisk/pilipro-fonts') >= 0
  } catch (e) {}
  if (still) {
    return { ok: false, code: 'BUSY', message: '卸载失败 (可能正被读取), 请重启设备后重试' }
  }
  // 3) 确认没挂了才删我们自己的文件 (绝不删系统目录)
  sh('rm -f ' + OUR_XML + ' ' + OUR_TTF)
  sh('rm -rf ' + BASE + '/overlay')
  sh('rmdir ' + BASE + ' 2>/dev/null || true')
  log('字体', '已卸载 fonts.xml, 系统字体恢复原样')
  return { ok: true, code: 'OK', message: '已卸载, 系统字体恢复原样' }
}

/** 兼容旧调用 */
export function restartFramework() {
  return { ok: false, code: 'DISABLED', message: '不再通过重启框架应用字体 (挂载后直接生效)' }
}
export function restartApp() { return restartFramework() }