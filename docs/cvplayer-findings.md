# cvplayer 接入结论（PiliPRO / X6 Pro）

> **结论**：`cvplayer` 能拿到**真正的原生绑定**（已用对照组证明），11 个方法全部可调用，
> 但信号（`onState`/`onInfo`/`onPosition`/`onComplete`/`onResume`）**一个都不回**，
> 管线因此起不来，画面停在"缓冲中…"。
> 当前策略：**默认走已验证的 `<video>` 元素**，cvplayer 作为设置里的可选开关（`useCVPlayer`）。

## 1. 铁证：模块解析与 API 面

### 1.1 原生模块确实在固件里

`/etc/miniapp/jsapis/libjsapi_export.so` 的注册块（offset 1106790~1106930，连续 130 字节，保序）：

```text
cvplayer_module_init_jsapis
CVPlayer
setDataSource / pause / resume / seek / setRate / getRate
setAudioDeviceType / videoCrop / setVideoSurface
onInfo / onState / onComplete / onResume / onPosition
```

符号表（`JSCVPlayerProxy`）：

```text
_ZN15JSCVPlayerProxy6onInfoEiii      onInfo(int,int,int)
_ZN15JSCVPlayerProxy7onStateEi       onState(int)
_ZN15JSCVPlayerProxy10onPositionEi   onPosition(int)
_ZN15JSCVPlayerProxy9onResumedEv     onResume()
_ZN15JSCVPlayerProxy12initObserverEv initObserver()   <- 非 JS 可见, 内部调用
_ZN15JSCVPlayerProxy13setDataSourceER22JQFunctionCallbackInfo
... (setVideoSurface / videoCrop / play / stop / seek / setRate / getRate /
     setAudioDeviceType 同为 SetProtoMethod -> JS 可见)
```

`.so` 里的日志串（用 `puts` 输出）：

```text
JSCVPlayerProxy::stop
JSCVPlayerProxy::setDataSource url: %s
JSCVPlayerProxy::play pos: %s
JSCVPlayerProxy::setVideoSurface %d, %d, %d      <- 三个 int (x, y, h)
```

### 1.2 ★ 对照组证明解析路径是通的

`brightness` 与 `cvplayer` **同样**注册在 `libjsapi_export.so`，而 `brightness` 是我们
`app.json` 早已声明、正常使用的模块。两者的深层形状**完全对称**：

```text
brightness:  root → default → Brightness  (function, own=[length,name,prototype])
cvplayer:    root → default → CVPlayer    (function, own=[length,name,prototype])
```

**所以 `own=[length,name,prototype]` 是框架包装原生类的标准形态，不是"拿到影子对象"。**
（这一条推翻了我中途的一个错误判断，记下来免得再绕。）

### 1.3 官方播放器的用法（字节码原子表，保序）

```text
612 getVideoManager
615 getSoundPlayerManager
616 getButtonEventManager
617 getBrightnessManager
618 CVPlayer + getCVPlayerManager      <- 统一模式: 每个模块配 getXxxManager()
630 onState / 631 onCvplayerState       <- 左: 注册的属性名; 右: 组件方法名
632 onInfo  / 633 onCvplayerInfo
637 onPosition / onCvplayerPosition
638 onComplete / onCvplayerComplete
640 onResume  / onCvplayerResume
641 play / 643 pause / 644 resume / 645 seek
```

> 注意：`getCVPlayerManager` 在真机的 `CVPlayer` 上**不存在**（`in=false`）。
> 本项目采用 `new CVPlayer()`，实例上 11 个方法齐全，与注册块一致。

官方管线（逆向文档 §6.2）：**一个 `uridecodebin` 同时出音视频** = 合并解码：

```
uridecodebin ─┬─ video: mymppvideodec ! videoconvert ! videoscale -> waylandsink
              └─ audio: audioconvert ! resample -> alsasink
```

对比现有 `<video>`（`libjsapi_gstplayer.so`）—— 音频多一层 `decodebin`，两条链不共享缓冲：

```
video: qtdemux>vparse>mppvideodec>vqueue>videoconvert:kmssink
audio: decodebin>acaps_early>audioconvert>audioresample>volume>alsasink
```

**这就是音画错位的结构性来源，也是要用 cvplayer 的理由。**

## 2. 卡点：调用成功，事件不回

```text
setVideoSurface(243,0,266) -> undefined
setDataSource(https://upos-sz-...bilivideo.com/...) -> undefined
play(0) -> undefined
（之后 onState / onInfo / onPosition 一个都不来）
```

- 三个调用都返回 `undefined` —— 原生 void 方法的正常返回，**不是报错**
- 框架日志与 `/userdata/applog/*` 里**搜不到 `JSCVPlayerProxy::` 前缀的 `puts` 输出**
- `cvplayer` 实例**没有 `onError`**（只有 onComplete/onPosition/onState/onInfo/onResume），
  失败**完全静默**，只能靠外部看门狗判

## 3. 已排除的可能

| 假设 | 结论 | 证据 |
|------|------|------|
| 模块解析不到 | ❌ 排除 | 与 brightness 形状完全对称 |
| API 名/参数不对 | ❌ 排除 | 注册块 13 个名字逐一对上；`play(pos)` 签名也实测校正过 |
| `play` 参数错 | ❌ 排除 | 曾报 `pos should be number!`，改成直通后消失 |
| 命名导入导致链接失败 | ❌ 排除 | 那会黑屏；现在是正常起播流程 |
| 默认速率不是 1x | ❌ 排除 | `getRate=1` |

## 4. 剩余怀疑方向（按可能性排序）

1. **视频 surface 的绑定**：官方流程是先 `<hole>` 的 `greenui::Rect` → `setVideoSurface`，
   再 `pad-added` → `prerolled`。我们传的是 `(243, 0, 266)`（`vrect` 默认值，整屏高），
   而官方是在**收到 `onInfo`（拿到真实 video_width/height）之后**才算矩形的。
   可能是"先有尺寸才设 surface"的鸡生蛋问题 —— 需要确认官方到底何时调用。
2. **是否需要 `<hole>` 先完成布局**：`<hole>` 的 rect 可能在首次布局后才有效。
3. **反汇编 `cvplayer_module_init_jsapis`**：看它注册时依赖什么前置条件。

## 5. 当前策略

- `useCVPlayer` **默认 false** → 走已验证的 `<video>`，播放稳定
- 设置页 → 音频分组 → 「使用官方 cvplayer 后端」可随时打开联调
- 打开时仍有 **8 秒看门狗**：无 `onState` 自动退回 `<video>`
- 退回时会先清空 `src` 再设回，强制 Vue 的 diff 触发元素重新加载（否则不加载）

## 6. 顺带沉淀的坑

- **命名导入会黑屏**：`import { CVPlayer } from 'cvplayer'` 在**链接期**就失败，
  JS 的 try/catch 兜不住。必须 `import * as X from ...`。
- **命名空间导入会包一层 `default`**：形状是 `root → default → <类名>`。
- **`Object.getOwnPropertyNames` 对原生包装类只能看到 `length/name/prototype`**，
  判断"是不是原生"不能看这个；`in` 运算符 + 与已知可用模块**做对照**才可靠。
- **形状判断只能有一处**：`cvAvailable` 与 `Ctor` 各判一次时曾出现
  「app.js 报可用、play.vue 报不可用」。现已统一到 `Ctor()`。
- **复杂 shell 命令不能直接交给 `bilinet.execAsync`**（带 `$( )`/管道/重定向会返回空），
  必须写脚本文件再 `execAsync('sh ' + path)`。
