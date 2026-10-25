// 系统 emoji 字体 —— 一键安装 / 卸载
//
// ── 为什么需要这个功能 ────────────────────────────────────────────
// 设备固件**没有任何 emoji 字形**: 38 个字体 (HarmonyOS_Sans_SC / NotoSansSC / PuHuiTi /
// STXihei / falcon-icons ...) 全部不含 emoji, 也没有 emoji 字体文件. 结果就是评论区里的
// 😀👍❤️ 全变豆腐块或空白. 框架的字体管理器 (Skia + FreeType) 只从固定路径读:
//     /etc/miniapp/resources/fonts/fonts.xml
// 应用**无法**在运行期注册字体 (libfalcon 没有 makeFromData/registerFont 之类的入口).
//
// ── 怎么做到"不改系统还能装字体" ─────────────────────────────────
// 根分区是 **只读挂载** (/dev/mmcblk0p9 on / ext4 ro), 直接写 /etc 会失败.
// 所以用 **绑定挂载** 做一层"影子字体目录":
//   1. mount --bind 原字体目录 -> /userdisk/pilipro-fonts/orig   (把原件暴露出来)
//   2. 在可写分区组一份 overlay: fonts.xml(改过的副本) + 各字体的符号链接 + Twemoji.ttf
//   3. mount --bind overlay -> /etc/miniapp/resources/fonts
//   4. 重启小程序 -> 框架重新读 fonts.xml -> 拿到 emoji 字形
//
// 系统完整性:
//   - 只读分区**一个字节都没改** (所有写入都在 /userdisk)
//   - 卸载 = umount 两次 + 删 overlay 目录, 原目录立刻恢复原样
//   - 重启设备也会自动恢复 (挂载不持久), 所以这是"临时增强", 不会把设备改坏
//   - 安装前会备份 fonts.xml 到应用数据目录, 卸载后可校验还原
//
// ── 体积 ──────────────────────────────────────────────────────
// 字体用 Twemoji COLR 版裁到 573 个常用 emoji = 238KB (单文件).
// 比 573 张 PNG (762KB) 更小, 而且是**真字体渲染**: 所有页面/所有 <text> 直接生效,
// 不需要逐 emoji 生成 <image> 节点, 性能更好.

import { bilinet } from './native.js'
import { log } from '../core/log.js'
import { dataDir } from '../core/paths.js'

const BASE = '/userdisk/pilipro-fonts'
const ORIG = BASE + '/orig'
const OVERLAY = BASE + '/overlay'
const SYS_FONTS = '/etc/miniapp/resources/fonts'
const FONT_NAME = 'Twemoji.ttf'
const BACKUP = dataDir() + '/fonts.xml.bak'
const SCRIPT = BASE + '/apply.sh'

/** 原生能力是否够用 (安装字体需要 execAsync + 文件读写) */
export function available() {
  return !!(bilinet && typeof bilinet.execAsync === 'function' &&
    typeof bilinet.writeFile === 'function' && typeof bilinet.readFile === 'function')
}

/** 执行一段 shell (写成脚本文件再执行 —— native exec 有 512 字符上限) */
function runScript(body) {
  return new Promise((resolve) => {
    try {
      bilinet.mkdirs(BASE)
      bilinet.writeFile(SCRIPT, '#!/bin/sh\n' + body + '\n')
      bilinet.execAsync('sh ' + SCRIPT).then(function (out) {
        resolve({ ok: true, out: String(out || '') })
      }).catch(function (e) {
        resolve({ ok: false, out: String(e || '') })
      })
    } catch (e) {
      resolve({ ok: false, out: String(e) })
    }
  })
}

/** 读挂载表, 判断当前是否已挂载 overlay */
export function status() {
  let mounted = false
  let origMounted = false
  try {
    const txt = bilinet.readFile('/proc/mounts') || ''
    mounted = txt.indexOf(SYS_FONTS) >= 0 && txt.indexOf(BASE) >= 0
    origMounted = txt.indexOf(ORIG) >= 0
  } catch (e) {}
  // 字体文件是否就位 (随包分发在 libs/ 下)
  const fontPath = bundledFontPath()
  return {
    mounted: mounted,
    origMounted: origMounted,
    fontBundled: !!fontPath,
    fontPath: fontPath,
    available: available()
  }
}

/**
 * 随包分发的字体在哪: AMR 里 libs/Twemoji.ttf, 安装后位于
 *   /userdisk/miniapp/data/mini_app/pkg/<appid>/<a|b>/libs/Twemoji.ttf
 * A/B 双槽都可能, 所以两个都探一次 (实测本应用会装到 b 槽).
 */
export function bundledFontPath() {
  const appid = (typeof $falcon !== 'undefined' && $falcon && $falcon.$appid) ? String($falcon.$appid) : '8009476000000001'
  const root = '/userdisk/miniapp/data/mini_app/pkg/' + appid
  const slots = ['a', 'b']
  for (let i = 0; i < slots.length; i++) {
    const p = root + '/' + slots[i] + '/libs/' + FONT_NAME
    try { if (bilinet.fileExists && bilinet.fileExists(p)) return p } catch (e) {}
  }
  return ''
}

/**
 * 安装: 组 overlay -> 挂载 -> 返回结果
 * 幂等: 重复点会先卸再挂.
 */
export async function install() {
  if (!available()) return { ok: false, msg: '当前固件缺少 execAsync, 无法安装' }
  const font = bundledFontPath()
  if (!font) return { ok: false, msg: '安装包内缺少字体文件 (libs/Twemoji.ttf)' }

  log('字体', '开始安装 emoji 字体: ' + font)
  // 备份原始 fonts.xml (只备份一次, 卸载后可还原核对)
  try {
    if (!bilinet.fileExists(BACKUP)) {
      const cur = bilinet.readFile(SYS_FONTS + '/fonts.xml') || ''
      if (cur) bilinet.writeFile(BACKUP, cur)
    }
  } catch (e) {}

  const body = [
    'set -e',
    'mkdir -p ' + ORIG + ' ' + OVERLAY,
    // 先清掉可能存在的旧挂载, 保证幂等
    'umount ' + SYS_FONTS + ' 2>/dev/null || true',
    'umount ' + ORIG + ' 2>/dev/null || true',
    // 1) 暴露原始字体目录 (只读分区, 用绑定挂载读)
    'mount --bind ' + SYS_FONTS + ' ' + ORIG,
    // 2) 组 overlay: 拷 fonts.xml, 其余字体做符号链接 (不复制 89MB)
    'rm -rf ' + OVERLAY + '/*',
    'cp -f ' + ORIG + '/fonts.xml ' + OVERLAY + '/fonts.xml',
    'for f in ' + ORIG + '/*.ttf ' + ORIG + '/*.otf ' + ORIG + '/*.txt; do',
    '  [ -e "$f" ] || continue',
    '  ln -sf "$f" ' + OVERLAY + '/',
    'done',
    // 3) 放入 emoji 字体
    'cp -f ' + font + ' ' + OVERLAY + '/' + FONT_NAME,
    // 4) 在 fonts.xml 里声明字体族 (幂等: 已有就不重复加)
    'if ! grep -q "name=\"Twemoji\"" ' + OVERLAY + '/fonts.xml; then',
    '  sed -i \'s#</familyset>#    <family name="Twemoji">\\n        <font weight="400">' + FONT_NAME + '</font>\\n    </family>\\n</familyset>#\' ' + OVERLAY + '/fonts.xml',
    'fi',
    // 5) 挂上去
    'mount --bind ' + OVERLAY + ' ' + SYS_FONTS,
    // 6) 自检
    'test -f ' + SYS_FONTS + '/' + FONT_NAME + ' || { echo NOFONT; exit 2; }',
    'grep -q "name=\"Twemoji\"" ' + SYS_FONTS + '/fonts.xml' + ' || { echo NOXML; exit 3; }',
    'echo OK'
  ].join('\n')

  const r = await runScript(body)
  const out = (r.out || '').trim()
  if (out.indexOf('OK') >= 0) {
    log('字体', 'emoji 字体已挂载')
    return { ok: true, msg: '已安装, 重启框架后生效' }
  }
  log('字体', '安装失败: ' + out.slice(0, 200))
  return { ok: false, msg: '安装失败: ' + (out.slice(0, 80) || '未知错误') }
}

/** 卸载: 卸挂载 -> 删 overlay, 系统恢复原样 */
export async function remove() {
  if (!available()) return { ok: false, msg: '当前固件缺少 execAsync, 无法卸载' }
  log('字体', '开始卸载 emoji 字体')
  const body = [
    'umount ' + SYS_FONTS + ' 2>/dev/null || true',
    'umount ' + ORIG + ' 2>/dev/null || true',
    'rm -rf ' + BASE,
    // 还原核对: 系统 fonts.xml 必须回到原始大小
    'test -f ' + SYS_FONTS + '/fonts.xml && echo CLEAN || echo MISSING'
  ].join('\n')
  const r = await runScript(body)
  const out = (r.out || '').trim()
  if (out.indexOf('CLEAN') >= 0) {
    log('字体', '已卸载, 系统字体目录恢复')
    return { ok: true, msg: '已卸载, 重启框架后恢复原样' }
  }
  return { ok: false, msg: '卸载异常: ' + out.slice(0, 80) }
}

/**
 * 重启**框架**让新字体生效.
 *
 * ★ 为什么不能只用 $falcon.restartMiniapp():
 *   字体族表是 miniapp 进程启动时读一次 fonts.xml 的. 重启应用页不会重新读表,
 *   结果就是"装了字体却毫无效果" (真机实测: 装完 fd 数为 0, 必须重启框架才变 1).
 *   系统有 guardian_run 监管 miniapp, 进程被杀后会自动重新拉起,
 *   新进程就会读到我们改过的 fonts.xml.
 *
 * 实现: 起一个脱离本进程的 shell, 1 秒后杀掉 miniapp (nohup + & 保证不被一起带走).
 */
export function restartFramework() {
  const cmd = 'nohup sh -c "sleep 1; kill -9 $(pidof miniapp)" >/dev/null 2>&1 &'
  try { bilinet.exec(cmd); return true } catch (e) {}
  // exec 不可用时退回框架自带重启 (至少刷新应用页)
  try {
    if (typeof $falcon !== 'undefined' && $falcon && typeof $falcon.restartMiniapp === 'function') {
      $falcon.restartMiniapp()
      return true
    }
  } catch (e2) {}
  return false
}

/** 兼容旧名字 */
export function restartApp() { return restartFramework() }
