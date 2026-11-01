// BlueZ D-Bus 输出的纯解析 (无任何原生依赖, 可被 Node 门禁直接 import 做行为测试).
//
// 为什么单独成文件: services/audio.js 要 import bilinet (原生模块), Node 里跑不起来;
// 而这段解析恰恰是最容易出错、最需要拿真样本回归的部分, 必须能脱离设备测.
//
// 真实样本见 tools/fixtures/bluez-managed-objects.txt (2026-11-01 从设备抓的).
//
// 坑 (PenMusic 被单测抓过, 我们这份样本也印证了): 属性是
//     string "Connected"
//     variant                         boolean false
// 这样成对出现的, 而且**同一台设备后面还有 org.bluez.MediaControl1 的 Connected**.
// 判值时窗口必须**卡在下一个属性名之前**, 否则真实样本里 Connected=false 后面紧跟的
// Paired=true 会被读成"连着", 于是又走回蓝牙、扬声器继续哑.

/** 从 dbus-send 原始输出里取「已连接」的蓝牙 MAC 列表 (可能为空) */
export function parseManagedObjects(txt) {
  const s = String(txt || '')
  const marks = []
  const re = /dev_([0-9A-Fa-f]{2}(?:_[0-9A-Fa-f]{2}){5})/g
  let m
  while ((m = re.exec(s)) !== null) {
    marks.push({ mac: m[1].split('_').join(':').toUpperCase(), at: m.index })
  }
  const out = []
  for (let i = 0; i < marks.length; i++) {
    const end = (i + 1 < marks.length) ? marks[i + 1].at : s.length
    const block = s.slice(marks[i].at, end)
    // 同一台设备在 block 里可能有多处 Connected (Device1 / MediaControl1) —— 任意一处为真即算连上
    let from = 0
    let hit = false
    for (;;) {
      const ci = block.indexOf('"Connected"', from)
      if (ci < 0) break
      let win = block.slice(ci, ci + 240)
      const nxt = win.indexOf('string "', 12)   // 跳过 "Connected" 自身
      if (nxt > 0) win = win.slice(0, nxt)
      if (win.indexOf('true') >= 0) { hit = true; break }
      from = ci + 11
    }
    if (hit && out.indexOf(marks[i].mac) < 0) out.push(marks[i].mac)
  }
  return out
}

export default { parseManagedObjects }
