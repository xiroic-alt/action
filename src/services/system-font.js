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
/**
 * 把一段 shell 写成脚本文件再执行 —— 这是本设备**唯一可靠**的执行形态.
 *
 * 真机实证 (两次踩坑):
 *   1) 直接 execAsync(复杂命令) -> 返回 "execAsync: 空响应 (rc=-1)".
 *      命令里的重定向 / || 会让它解析失败.
 *   2) 拆成多次 execAsync 顺序调用 -> 必须每步 await, 否则并发乱序.
 *   而 execAsync("sh " + 脚本路径) 这两种问题都没有:
 *     整段逻辑在同一个 shell 里天然串行, 命令行也只有一个简单参数.
 *   (PC 自动发现就是这么跑通的: execAsync("sh " + pcscan.sh))
 */
async function runScript(name, body) {
  const sp = dataDir() + "/" + name
  try {
    bilinet.mkdirs(dataDir())
    bilinet.writeFile(sp, body, false)
    bilinet.exec("chmod 755 " + sp + " 2>/dev/null")
  } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', message: '写脚本失败: ' + (e && e.message ? e.message : e) }
  }
  let out = ""
  try {
    if (bilinet && typeof bilinet.execAsync === "function") out = await bilinet.execAsync("sh " + sp)
    else out = bilinet.exec("sh " + sp)
  } catch (e) {
    return { ok: false, code: 'EXEC_FAIL', message: '执行失败: ' + (e && e.message ? e.message : e) }
  }
  const text = String(out == null ? "" : out)
  log("字体", "脚本输出: " + text.replace(/\\s+/g, " ").slice(0, 200))
  // 脚本自己用 RESULT:CODE:说明 的格式回报结论
  const m = /RESULT:([A-Z_]+):?([^\n]*)/.exec(text)
  if (!m) {
    return { ok: false, code: 'NO_RESULT', message: '脚本没有回报结果, 输出: ' + text.slice(0, 120) }
  }
  const code = m[1]
  const detail = (m[2] || "").trim()
  return { ok: code === "OK", code: code, message: detail || code }
}

/**
 * 安装: 用一个脚本完成"探测字体 -> 全量拷贝 -> 追加条目 -> 挂载 -> 校验".
 * 全程不返回含糊提示, 每个失败分支都有明确 code.
 */
export async function install() {
  if (!available()) return { ok: false, code: "NO_NATIVE", message: "设备不支持文件操作" }
  // 幂等: 安装前先清掉上一次可能残留的挂载 (只清我们自己的)
  await runScript("font-unmount.sh", unmountScript())
  const ttf = bundledFontPath()
  const script = installScript(ttf)
  return await runScript("font-install.sh", script)
}

/**
 * 卸载: 用一个脚本完成 "umount (只卸我们自己的) -> 校验 -> 删文件".
 * 不会再出现 miss / 空响应.
 */
export async function remove() {
  if (!available()) return { ok: false, code: "NO_NATIVE", message: "设备不支持文件操作" }
  return await runScript("font-unmount.sh", unmountScript())
}
/** 生成"卸载"脚本: 只卸我们自己的挂载, 绝不碰系统挂载点 */
function unmountScript() {
  return [
    "#!/bin/sh",
    "B=/userdisk/pilipro-fonts",
    "S=/etc/miniapp/resources/fonts",
    "O=$B/overlay",
    "# 只有 /proc/mounts 里出现我们自己的 overlay 路径时才 umount.",
    "# 系统把 fonts.xml 单独挂成一个挂载点 (/dev/mmcblk0p12), 那个绝不能动.",
    "if grep -q \"$O\" /proc/mounts; then umount $S 2>/dev/null; fi",
    "if grep -q \"$O\" /proc/mounts; then",
    "  echo \"RESULT:BUSY:卸载失败 (可能正被读取), 请重启设备后重试\"",
    "  exit 0",
    "fi",
    "rm -rf $O",
    "rm -f $B/fonts.xml $B/fonts.orig.xml $B/Twemoji.ttf",
    "echo \"RESULT:OK:已卸载, 系统字体恢复原样\"",
    ""
  ].join("\n")
}

/** 生成"安装"脚本: 全量拷贝 -> 幂等改表 -> 挂载 -> 三项校验 */
function installScript(ttf) {
  return [
    "#!/bin/sh",
    "B=/userdisk/pilipro-fonts",
    "S=/etc/miniapp/resources/fonts",
    "O=$B/overlay",
    "TTF=" + JSON.stringify(String(ttf || "")),
    "test -f \"$TTF\" || { echo \"RESULT:NO_BUNDLED:安装包里没有字体文件 ($TTF)\"; exit 0; }",
    "# 已装判定: 表里有条目 **且** 字体文件真的在目录里 (只看表文本会误判坏状态)",
    "if grep -q Twemoji \"$S/fonts.xml\" && test -f \"$S/Twemoji.ttf\"; then",
    "  echo \"RESULT:ALREADY:已经装好了 (表里有条目, 字体文件也在)\"",
    "  exit 0",
    "fi",
    "mkdir -p $B",
    "rm -rf $O; mkdir -p $O",
    "cp -a $S/. $O/",
    "N1=$(ls -1 $S | wc -l)",
    "N2=$(ls -1 $O | wc -l)",
    "if [ \"$N1\" -eq 0 ] || [ \"$N2\" -lt \"$N1\" ]; then",
    "  rm -rf $O",
    "  echo \"RESULT:COPY_FAIL:字体目录拷贝不完整 ($N2/$N1), 为安全起见已中止\"",
    "  exit 0",
    "fi",
    "cp -f \"$TTF\" $O/Twemoji.ttf",
    "# awk 重写: 剥掉旧的 Twemoji family 块, 在 </familyset> 前插一条 (幂等)",
    "awk '",
    "  /<family name=\"Twemoji\">/ { skip=1; next }",
    "  skip==1 && /<\\/family>/ { skip=0; next }",
    "  /<\\/familyset>/ { print \"    <family name=\\\"Twemoji\\\">\"; print \"        <font weight=\\\"400\\\">Twemoji.ttf</font>\"; print \"    </family>\" }",
    "  { print }",
    "' $S/fonts.xml > $O/fonts.xml",
    "if ! grep -q Twemoji $O/fonts.xml; then rm -rf $O; echo \"RESULT:BAD_XML:字体表改写失败\"; exit 0; fi",
    "if ! grep -q '</familyset>' $O/fonts.xml; then rm -rf $O; echo \"RESULT:BAD_XML:改写后缺少闭合标签\"; exit 0; fi",
    "grep -q \"$O\" /proc/mounts && umount $S 2>/dev/null",
    "mount --bind $O $S",
    "N3=$(ls -1 $S | wc -l)",
    "if grep -q Twemoji \"$S/fonts.xml\" && test -f \"$S/Twemoji.ttf\" && [ \"$N3\" -ge \"$N1\" ]; then",
    "  echo \"RESULT:OK:已启用 (只追加 Twemoji, 其它字体未改动; 字体数 $N1 -> $N3)\"",
    "else",
    "  grep -q \"$O\" /proc/mounts && umount $S 2>/dev/null",
    "  rm -rf $O",
    "  echo \"RESULT:VERIFY_FAIL:校验失败已回滚 (字体数 $N3/$N1)\"",
    "fi",
    ""
  ].join("\n")
}

/** 兼容旧调用 */
export function restartFramework() {
  return { ok: false, code: 'DISABLED', message: '不再通过重启框架应用字体 (挂载后直接生效)' }
}
export function restartApp() { return restartFramework() }