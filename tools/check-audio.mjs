// check-audio: 蓝牙音频的纯解析行为 + 播放器接线 (拿真样本回归).
//
// 为什么单独一个文件: 这块最容易出错, 而且有真实样本可以钉死 ——
// tools/fixtures/bluez-managed-objects.txt 是 2026-11-01 从设备上原样抓的
// dbus-send ObjectManager.GetManagedObjects 输出.
import { readFileSync } from 'node:fs'
import { parseManagedObjects } from '../ui/src/services/bluez-parse.js'

let pass = 0
const fails = []
function ok(cond, name) {
  if (cond) pass++
  else fails.push(name)
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + ' (got ' + JSON.stringify(a) + ')') }

const src = (p) => readFileSync(new URL('../ui/src/' + p, import.meta.url), 'utf8')

// ---------------- 1. 真样本 (设备当时未连接) ----------------
const real = readFileSync(new URL('./fixtures/bluez-managed-objects.txt', import.meta.url), 'utf8')
ok(real.indexOf('dev_41_42_7B_07_23_A7') >= 0, '真样本里有设备路径 dev_41_42_7B_07_23_A7')
ok(real.indexOf('org.bluez.Device1') >= 0, '真样本里有 org.bluez.Device1')
eq(parseManagedObjects(real), [], '真样本(未连接): 解析出 0 个已连接设备')
// 真样本里 Paired=true 出现在 Connected 之前 —— 绝不能被当成"连着"
ok(/string "Paired"[\s\S]{0,80}boolean true/.test(real), '真样本: Paired=true 在 Connected 之前 (这就是那个坑)')
ok(/string "Connected"[\s\S]{0,80}boolean false/.test(real), '真样本: Device1.Connected=false')
// 同一台设备后面还有 MediaControl1 的 Connected
ok(real.indexOf('org.bluez.MediaControl1') >= 0, '真样本里有 MediaControl1 (同设备第二处 Connected)')

// ---------------- 2. 真样本·已连接 (耳机真的连上时抓的) ----------------
const realConn = readFileSync(new URL('./fixtures/bluez-managed-objects-connected.txt', import.meta.url), 'utf8')
ok(realConn.indexOf('dev_41_42_7B_07_23_A7') >= 0, '已连接样本里有同一个设备路径')
ok(/string "Connected"[\s\S]{0,80}boolean true/.test(realConn), '已连接样本: Device1.Connected=true')
eq(parseManagedObjects(realConn), ['41:42:7B:07:23:A7'], '真样本(已连接): 解析出 41:42:7B:07:23:A7')
// 两份真样本只差"连没连", 解析结果必须一个空一个命中
ok(parseManagedObjects(real).length === 0 && parseManagedObjects(realConn).length === 1,
  '两份真样本对照: 同一台设备 未连接=[] / 已连接=[MAC]')

// ---------------- 3. 坑位的定向回归 ----------------
// Connected=false 紧接着 Paired=true: 窗口放宽就会误判成"连着"
const trap = 'x /org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF\n' +
  'string "Connected"\nvariant  boolean false\nstring "Paired"\nvariant  boolean true\n'
eq(parseManagedObjects(trap), [], '坑位: Connected=false + Paired=true 不得判为已连接')
// MediaControl1 为 true (Device1 那处为 false) —— 设备确实连着, 应算连上
const mediaOnly = 'x /org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF\n' +
  'string "Connected"\nvariant boolean false\n' +
  'string "org.bluez.MediaControl1"\nstring "Connected"\nvariant boolean true\n'
eq(parseManagedObjects(mediaOnly), ['AA:BB:CC:DD:EE:FF'], 'MediaControl1 Connected=true 也算连上')

// ---------------- 4. 多设备: 只返回已连接的那台 ----------------
const two = 'x /org/bluez/hci0/dev_11_22_33_44_55_66\nstring "Connected"\nvariant boolean false\n' +
  'x /org/bluez/hci0/dev_77_88_99_AA_BB_CC\nstring "Connected"\nvariant boolean true\n'
eq(parseManagedObjects(two), ['77:88:99:AA:BB:CC'], '多设备: 只取已连接的那台')
eq(parseManagedObjects(''), [], '空输入返回空')
eq(parseManagedObjects(null), [], 'null 输入返回空')

// ---------------- 5. 服务契约 (audio.js) ----------------
const audio = src('services/audio.js')
ok(/ObjectManager\.GetManagedObjects/.test(audio), 'audio: 用 D-Bus GetManagedObjects 作权威判据')
ok(/hal-audio -b /.test(audio), 'audio: 系统层 hal-audio -b <MAC> 路由')
ok(/hal-audio -b ""/.test(audio), 'audio: 回扬声器清 bluealsa 绑定 (防断连后扬声器哑)')
ok(/killall -9 SoundPlayer/.test(audio), 'audio: 释放音频焦点 (系统播放器同款)')
ok(/hcitool con/.test(audio), 'audio: 链路层交叉验证')
ok(/bluetoothctl connect ' \+ link/.test(audio), 'audio: 对谎报设备补 connect 纠正')
ok(/bilinet\.execAsync/.test(audio), 'audio: 一律 execAsync (同步 exec 冻死应用)')
ok(!/bilinet\.exec\s*\(/.test(audio), 'audio: 不用同步 bilinet.exec (同步会冻死主线程)')
ok(/import \{ parseManagedObjects \} from '\.\/bluez-parse\.js'/.test(audio), 'audio: 复用纯解析模块')

// ---------------- 6. 播放器接线 ----------------
const player = src('pages/player/player.vue')
ok(/from '\.\.\/\.\.\/services\/audio\.js'/.test(player), 'player: 从 services/audio.js 取音频能力')
ok(/btMac\(\)/.test(player), 'player: 蓝牙判据走 audio.btMac()')
ok(/releaseAudioFocus\(\)/.test(player), 'player: 起播释放一次音频焦点')
ok(!/execAsync\(SCAN_BT_CMD\)/.test(player), 'player: 不再自己扫蓝牙 (逻辑已收敛到服务里)')
ok(/audioWasBt/.test(player), 'player: 记录本次是否切过蓝牙 (决定要不要清系统层绑定)')
ok(/routeSpeaker\(\)/.test(player), 'player: 蓝牙断开回扬声器时清绑定')
ok(/typeof v\.setAudioDeviceType !== 'function'/.test(player), 'player: 元素无 setAudioDeviceType 时兜底到系统层')

// ---------------- 7. bluealsa SBC 档位的修正必须留痕 ----------------
// 设备侧改动必须留痕 (重刷系统后会丢, 靠这份文档恢复)
const doc = readFileSync(new URL('../docs/audio-device-notes.md', import.meta.url), 'utf8')
ok(/sbc-quality/.test(doc), 'docs: 记录了 bluealsa sbc-quality 的修正 (延迟杠杆)')
ok(/hal-audio/.test(doc), 'docs: 记录了 hal-audio 系统层路由')
ok(/audio-bak\/bluealsa.wrapper.bak/.test(doc), 'docs: 记录了备份与回滚命令')
ok(/bluealsa_orig/.test(doc), 'docs: 记录了"进程名是 bluealsa_orig"这个坑')

if (fails.length) {
  console.log('BAD  ' + fails.length + ' 条未通过:')
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('CHECK-AUDIO PASSED (' + pass + ' 断言: D-Bus 真样本解析/坑位回归/服务契约/播放器接线)')
