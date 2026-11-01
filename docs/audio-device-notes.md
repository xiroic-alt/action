# 设备侧音频笔记 (词典笔 / RK3562 / PenOS)

本文记录**设备层面**的音频事实与我们对系统做过的唯一一处改动.
应用侧代码见 `ui/src/services/audio.js` 与 `ui/src/pages/player/player.vue`.

来源分三类, 每条都标了出处:
- **[实测]** 我们自己在这台设备上跑出来的 (命令与输出都可复现)
- **[同设备项目]** 同一台设备上的 PenMusic / PiliPRO 项目文档中的实测结论
- **[推断]** 由上两条推出的结论, 标注了验证方式

---

## 1. 播放器元素的音频设备类型 (跳转表取证) [实测]

`libfalcon` 播放器元素有 `setAudioDeviceType(type, mac)`, 内部按跳转表选 ALSA sink:

| type | 设备 |
|---|---|
| 0 / 3 | 扬声器 (speaker) |
| 1 | tc_digital |
| 2 | tc_analog |
| 4 | `bluealsa:DEV=<mac>` |
| >4 | 回落到扬声器 |

**这是二进制里读出来的, 不是猜的**: `VideoPlayer::getAudioDeviceStr()` 的跳转表在 0x4bbc10,
字符串常量在 .rodata 0x4ba8ad/8b5/8bf/8ca.

> 踩过的坑: 0.9.64 按 `type=1` 当"蓝牙"猜了一次 —— 实际选到 tc_digital, 真机直接报
> `Could not open audio device for playback`, 而且**这个错误是全局的**, 之后连扬声器播放也一起挂.
> 所以代码里有一条断言专门钉死"绝不使用 type=1".

**时序硬约束**: `setAudioDeviceType` 内部是 `unInstallAlsasink() / installAlsasink()`,
**只能在 state=4 (管线已 PLAYING) 之后调用**. 管线未建时调用 → 同一个全局错误.
(0.9.64 与 0.9.71 两次真机回归都是这么来的; 门禁里有一条断言禁止它出现在 `play(0)` 之前.)

---

## 2. 蓝牙: 固件会关掉板载扬声器通路 [同设备项目]

PenMusic 文档「关键设计 10」的实测结论: **蓝牙连上之后, 固件会关掉板载扬声器通路 (rk817)**,
声音必须走蓝牙通路; 反过来, 系统层如果还留着 bluealsa 绑定, 蓝牙断开后扬声器也可能是哑的.

系统级的处理工具是 `hal-audio` (本机 `/bin/hal-audio` 存在, 已核对 `--help`):

```
hal-audio -l            列出声音设备 / 数字音频设备        <- 能用, 留作诊断
hal-audio -g/-s         音量读 / 写
hal-audio -b <MAC>      a2dp dev mac addr                  <- ★ 见下面的证伪
```

### ★ 订正: `hal-audio -b` **不是**系统层路由接口 [实测, 2026-11-01 证伪]

PiliPRO 的 `services/audio.js` 写着 `hal-audio -b <MAC>` 是"系统层路由", 并推测
"这是系统其它播放器 (网易云) 的做法". 我们照着写进代码后做了核对, **这条不成立**:

```
# binary 里 getopt 串是 hlD:t:r:c:b:gs:m -> -b: 确实要参数; 帮助也写 "-b, --bluealsa=# a2dp dev mac addr"
# 但它的用法行是:  Usage: hal-audio [OPTION]... [FILE/Value]...   <- 它是个「喂文件播放」的工具

hal-audio -b 41:42:7B:07:23:A7            -> file:(null) + usage, 什么都没做
hal-audio --bluealsa=41:42:7B:07:23:A7    -> 同上
hal-audio -b41:42:7B:07:23:A7             -> 同上
hal-audio -b 41:42:7B:07:23:A7 <file>     -> 能喂文件播放, 但输出里**没有** binary 里那条
                                             "A2DP dev = %s, mac=%s." -> 是否真送到蓝牙无证据
```

**结论**: 不带 FILE 调用 `hal-audio -b` 是彻底的 no-op, 不能当"设置路由"用.
`hal-audio -b ""` 同理.**蓝牙/扬声器的切换只认播放器元素的 `setAudioDeviceType`**
(见本文第 1 节: type=4 + 设备串). 应用侧那两个 `routeBt()/routeSpeaker()` 已删除,
元素没有 `setAudioDeviceType` 的固件上如实记"本固件无法切音频输出", 不假装切过了.

> 这条订正也应当回填给 PiliPRO —— 它那边仍在使用这个假设.
> 本文最初就是照着它写的, 属于"抄了未核实的结论", 记在这里以免再犯.

---

## 3. bluez 会谎报连接状态 [实测]

2026-10-17 真机实测: `hcitool con` 显示 ACL 链路是活的
(`state 1 lm MASTER AUTH ENCRYPT`), 而 `bluetoothctl info` 对**同一台设备**报 `Connected: no`.
后果很隐蔽: 我们以为"没连蓝牙"就不切输出, 声音其实还在扬声器上; 而 bluealsa 也因为 bluez
的状态建不出 A2DP PCM (`aplay` 报 `PCM not found`).

修法是两级判据 + 纠偏:
1. bluez 扫 (`bluetoothctl` 逐个查, 不能偷懒写成 `info` 不带地址或 `devices Connected`, 本机 bluez 5.58 两种都报错)
2. 扫不到就取 `hcitool con` 的链路层真相, 并对该设备补一次 `bluetoothctl connect <mac>`
   (人工验过: 纠正后 `aplay` 立刻能建出 `/org/bluealsa/hci0/dev_xxx/a2dpsrc/sink`)

[同设备项目] PenMusic 指出更权威的判据是 **D-Bus**: `Device1.Connected`. 我们采纳它作为第一级:

```
dbus-send --system --print-reply --dest=org.bluez / org.freedesktop.DBus.ObjectManager.GetManagedObjects
```

**解析有个必须小心的坑** (PenMusic 被单测抓到过, 我们的真实样本也印证了): 属性是
`string "Connected"` 紧跟 `variant boolean false` 成对出现, 而同一台设备后面**还有**
`org.bluez.MediaControl1` 的 `Connected`. 判值的窗口必须**卡在下一个属性名之前** ——
真实样本里 `Connected=false` 前面就是 `Paired=true`, 窗口放宽会把 false 读成 true.

真实样本: `tools/fixtures/bluez-managed-objects.txt` (2026-11-01 从设备原样抓取).
解析器: `ui/src/services/bluez-parse.js` (纯函数, 无原生依赖, 因此可被 Node 门禁直接回归).

---

## 4. 音频焦点: 系统常驻 SoundPlayer [同设备项目]

系统有个常驻 `SoundPlayer` 守护进程持有音频焦点:

```
/usr/bin/guardian_run /usr/bin/runSoundPlayer start
/oem/YoudaoDictPen/output/SoundPlayer
```

其它系统播放器的做法是 `killall -9 SoundPlayer` —— **guardian 会立刻把它拉回来**,
等价于「释放并重置音频焦点」, 用来打断别的应用正在播的声音.
我们在起播时调一次 (`releaseAudioFocus()`).

---

## 5. ★ 我们改过的系统文件: /usr/bin/bluealsa (延迟杠杆) [实测]

**这是本次唯一一处设备侧改动**, 记录在此以便重刷系统后恢复.

### 现象
系统脚本 `/usr/bin/runBlueAlsa` 本身是按低延迟档设计的:

```sh
/usr/bin/bluealsa --profile=a2dp-source --sbc-quality=0 > /dev/null 2>&1
```

但 `/usr/bin/bluealsa` **已经不是二进制, 而是被替换成了一个包装脚本**, 它硬编码了
`--sbc-quality=2` 并**丢弃调用方传来的全部参数** —— 于是 `runBlueAlsa` 想用的 0 从来没生效过.

```sh
# 改动前 (包装脚本, 126 字节)
exec /data/local/bluealsa_custom/bluealsa_orig --profile=a2dp-source --profile=hfp-ag --a2dp-volume --sbc-quality=2
```

### 为什么这会增加延迟
A2DP 走 SBC. `--sbc-quality` 档位越高 → bitpool 越大 → 每帧载荷越大 → 接收端需要缓冲
更多包来平滑抖动 → **端到端延迟更大**. [同设备项目] PenMusic 自己拉起 bluealsa 时用的就是
`--sbc-quality=0`. 系统自带脚本也是 0. 只有这个包装脚本把它改成了 2.

### 改动
只把最后一个档位从 2 改成 0, **保留** hfp-ag 与 a2dp-volume (HFP/SCO 低延迟档与 A2DP
绝对音量依赖这两个开关):

```sh
exec /data/local/bluealsa_custom/bluealsa_orig --profile=a2dp-source --profile=hfp-ag --a2dp-volume --sbc-quality=0
```

### 备份与回滚
```
备份: /userdisk/xiro/audio-bak/bluealsa.wrapper.bak
回滚: cp -f /userdisk/xiro/audio-bak/bluealsa.wrapper.bak /usr/bin/bluealsa && killall -9 bluealsa_orig
```

### 生效方式与验证
```
killall -9 bluealsa_orig      # ★ 进程名是 bluealsa_orig, 不是 bluealsa ——
                              #   所以 runBlueAlsa 里的 killall bluealsa 其实一直杀不掉它
sleep 3
ps | grep bluealsa | grep -v grep
# 期望: ... --profile=hfp-ag --a2dp-volume --sbc-quality=0
```
guardian 会自动按新脚本重新拉起 (真的重启过, 见提交记录里的验证输出).

> 注意: 这是**系统级**改动, 重刷系统/OTA 后会丢, 需要按本节重做.

---

## 6. 音画对齐: DELAY 参数 [实测]

`libfalcon` 只会拼 `bluealsa:DEV=<mac>`, 而整条 A2DP 链路 (SBC 编码 + 链路 + 耳机缓冲)
的延迟被少报 → 管线以为声音已经播到 → 画面超前.

`/etc/alsa/conf.d/20-bluealsa.conf` 的 `pcm.bluealsa` 声明 `@args [DEV PROFILE DELAY SRV]`,
默认 `defaults.bluealsa.delay = 20000` (仅 20ms); `libasound_module_pcm_bluealsa.so` 的键名就是
`device/profile/delay` (拼错会报 `Unknown field`). 所以补偿要拼进设备串:
`bluealsa:DEV=<mac>,DELAY=<µs>`.

**负值可用**: aplay 对照实验证明 `DELAY=0` / `-100000` / `2000000` 都能建出
`a2dpsrc/sink` 并正常开播, 所以"声音超前就减小"这个方向存在, 代码里不夹负值.
`PROFILE=sco` 也验证过可解析 (拿 `BOGUS` 做对照时 ALSA 直接报 `Unknown parameter BOGUS`).
