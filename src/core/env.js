// 设备画像与几何 —— 全应用唯一的"屏幕真相"
//
// 为什么单独一层: 笔的屏幕是 960x266 的横带 (面板 480x960 旋转 270°), 顶部还有 44px 的
// 系统条; 一旦页面各自写死坐标, 换机型/换固件就是全量返工. 这里把几何/触控/能力探测收口,
// 页面只问 env.contentRect() 这类语义问题.
//
// 事实来源: 目标设备的 /etc/miniapp/resources/cfg.json 与触控实测
//   logical 960x266, direction 270, tp_direction 270
//   合成触摸映射: touchX = displayY + 107, touchY = 959 - displayX (斜率 1, 位移可直接用差值)

import { SCREEN } from '../design/tokens.js'

const PROFILE = {
  id: 'youdao-melon-rk3562',
  model: 'YoudaoDictionaryPen (RK3562 / Melon)',
  logical: { width: 960, height: 266 },
  direction: 270,
  panel: { width: 480, height: 960 },
  touch: { direction: 270, xoffset: 107, yoffset: 0 },
  topBar: SCREEN.topBar
}

// 能力探测结果只算一次 (探测本身有开销)
let caps = null

export function profile() { return PROFILE }

/** 内容区矩形 (顶部 44px 系统条之下) */
export function contentRect() {
  return { x: 0, y: PROFILE.topBar, w: PROFILE.logical.width, h: PROFILE.logical.height - PROFILE.topBar }
}

/**
 * 显示坐标 -> 合成触摸坐标.
 * 只在"自动化注入触摸"(send_event touch ...)时需要; 真手指事件原生就是显示坐标.
 */
export function displayToTouch(x, y) {
  return { x: y + PROFILE.touch.xoffset, y: 959 - x }
}

/** 触摸坐标 -> 显示坐标 (逆映射, 用于把注入点换算成屏幕位置) */
export function touchToDisplay(tx, ty) {
  return { x: 959 - ty, y: tx - PROFILE.touch.xoffset }
}

/**
 * 能力探测: 只问"是否存在", 不假定行为.
 * 结论缓存: 同一进程内不重复探测 (每次 typeof 也有成本, 且日志会重复).
 */
export function capabilities() {
  if (caps) return caps
  const b = (typeof bilinet !== 'undefined' && bilinet) ? bilinet : (globalThis.bilinet || null)
  const has = function (k) { return !!(b && typeof b[k] === 'function') }
  caps = {
    bilinet: !!b,
    httpAsync: has('httpGetAsync') && has('httpPostAsync'),
    httpSync: has('httpGet') && has('httpPost'),
    fs: has('readFile') && has('writeFile'),
    sqlite: has('dbOpen') && has('dbExec') && has('dbQuery'),
    execAsync: has('execAsync'),
    execSync: has('exec'),
    falcon: typeof $falcon !== 'undefined' && !!$falcon,
    page: typeof $page !== 'undefined' && !!$page
  }
  return caps
}

/** 只给测试用例: 丢掉缓存重新探测 */
export function __resetCaps() { caps = null }
