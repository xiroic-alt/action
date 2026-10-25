// 电脑端服务自动发现 —— 让"电脑同步登录"不需要用户手填 IP
//
// 为什么需要:
//   笔和电脑在同一 WiFi 下, 但笔上输 IP 很难用 (960x266 屏 + 系统输入法).
//   这里在局域网里扫一遍, 找到跑着 pc-cookie-server.py 的那台机器.
//
// 识别方式: 请求 http://<ip>:9527/api/info, 返回里有 "port" 字段就是我们的服务
//          (只匹配端口不够, 得确认是自家服务).
//
// 性能: 254 个地址 / 每批 40 并发 / 单请求 1s 超时 —— 实测 9 秒扫完.
//       扫描用 execAsync 跑, 不阻塞 UI; 结果缓存到设置里, 下次直接命中.
import { bilinet } from './native.js'
import { getCfg, setCfg } from '../core/config.js'
import { log } from '../core/log.js'

export const PORT = 9527

/** 上次成功发现的电脑 IP (设置项, 跨启动记住) */
export function cachedIp() {
  const v = getCfg('pcIp')
  return typeof v === 'string' ? v : ''
}

export function saveIp(ip) {
  if (!ip) return
  try { setCfg('pcIp', ip) } catch (e) {}
}

/** 设备自己所在网段, 例如 192.168.1 */
function ownSubnet() {
  try {
    const out = bilinet.exec('ip -4 addr show wlan0 2>/dev/null')
    const s = String(out || '')
    const m = s.match(/inet\s+(\d+\.\d+\.\d+)\.\d+/)
    if (m) return m[1]
  } catch (e) {}
  try {
    const out = bilinet.exec('ifconfig wlan0 2>/dev/null')
    const m = String(out || '').match(/inet addr:(\d+\.\d+\.\d+)\.\d+/)
    if (m) return m[1]
  } catch (e) {}
  return ''
}

/** 探测单个地址是不是我们的电脑端服务 */
export async function probe(ip, port) {
  const p = port || PORT
  const url = 'http://' + ip + ':' + p + '/api/info'
  try {
    if (typeof bilinet.httpGetAsync === 'function') {
      const body = await bilinet.httpGetAsync(url, 2, undefined)
      if (String(body || '').indexOf('"port"') >= 0) return true
    } else if (typeof bilinet.httpGet === 'function') {
      const body = bilinet.httpGet(url, 2, undefined)
      if (String(body || '').indexOf('"port"') >= 0) return true
    }
  } catch (e) {}
  return false
}

/**
 * 在局域网里找电脑端服务.
 * 先试缓存 IP (最快, 一次请求), 再整段扫描.
 * @returns {Promise<string>} 找到的 IP, 没找到返回 ''
 */
export async function discover() {
  const hit = cachedIp()
  if (hit && (await probe(hit))) {
    log('电脑同步', '使用缓存 IP ' + hit)
    return hit
  }
  const net = ownSubnet()
  if (!net) { log('电脑同步', '读不到本机网段, 无法自动发现'); return '' }
  log('电脑同步', '开始扫描 ' + net + '.1-254 :' + PORT)
  // 用 shell 并行扫: 每批 40 个, 单请求 1s 超时. 实测 9 秒.
  const script = [
    'P=' + net,
    'n=0',
    'for i in $(seq 1 254); do',
    '  ( curl -s -m 1 "http://$P.$i:' + PORT + '/api/info" 2>/dev/null | grep -q \'"port"\' && echo "HIT:$P.$i" ) &',
    '  n=$((n+1))',
    '  if [ $((n % 40)) -eq 0 ]; then wait; fi',
    'done',
    'wait'
  ].join('\n')
  let out = ''
  try {
    if (typeof bilinet.execAsync === 'function') out = await bilinet.execAsync(script)
    else out = bilinet.exec(script)
  } catch (e) {
    log('电脑同步', '扫描失败: ' + (e && e.message ? e.message : e))
    return ''
  }
  const m = String(out || '').match(/HIT:(\d+\.\d+\.\d+\.\d+)/)
  if (!m) { log('电脑同步', '没有找到电脑端服务'); return '' }
  saveIp(m[1])
  log('电脑同步', '找到电脑端服务 ' + m[1])
  return m[1]
}
