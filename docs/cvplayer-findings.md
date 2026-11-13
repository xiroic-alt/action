# cvplayer 接入结论（PiliPRO / X6 Pro）

> 结论摘要：**固件里确实有 cvplayer，但当前 app 拿不到真正的原生绑定。**
> 已确认可用的是旧 `<video>` 元素；cvplayer 集成因此默认关闭（设置里 `useCVPlayer`）。

## 1. 已证实的事实

### 1.1 原生模块确实在固件里（二进制证据）

`/etc/miniapp/jsapis/libjsapi_export.so` 的注册块（offset 1106790~1106930，连续 130 字节）：

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
_ZN15JSCVPlayerProxy12initObserverEv initObserver()  <- 非 JS 可见, 内部调用
```

### 1.2 官方播放器用的接口（字节码原子表，保序）

```text
612 getVideoManager
615 getSoundPlayerManager
616 getButtonEventManager
617 getBrightnessManager
618 CVPlayer + getCVPlayerManager      <- ★ 统一模式: 每个模块配 getXxxManager()
630 onState / 631 onCvplayerState       <- 左: 注册属性名; 右: 组件方法名
632 onInfo  / 633 onCvplayerInfo
637 onPosition / onCvplayerPosition
638 onComplete / onCvplayerComplete
640 onResume  / onCvplayerResume
641 play / 643 pause / 644 resume / 645 seek
```

官方管线（逆向文档 §6.2）：**一个 uridecodebin 同时出音视频** = 合并解码：

```
uridecodebin ─┬─ video: mymppvideodec ! videoconvert ! videoscale -> waylandsink
              └─ audio: audioconvert ! resample -> alsasink
```

## 2. 卡住的地方

`import * as CV from 'cvplayer'` **能拿到东西**（`top=[default] default=[CVPlayer]`），
`new CVPlayer()` 也能建实例且带 11 个方法，但：

```text
setVideoSurface(243,0,266) -> undefined
setDataSource(https://upos-sz-...bilivideo.com/...) -> undefined
play(0) -> undefined
（之后 onState / onInfo / onPosition 一个都不来, 画面停在"缓冲中…"）
```

### 根因（2026-11-14 定位）

```text
getCVPlayerManager: in=false typeof=undefined own=[length,name,prototype]
```

`own=[length,name,prototype]` 是**普通 ES 函数**的特征 —— 原生绑定对象不会是这三个键。
**所以 import 到的 `cvplayer` 不是固件里那个原生模块**，调用根本没到达原生层。
这完整解释了"11 个方法齐全 + 调用全返回 undefined + 事件一个都不回"。

两条路都验证过，都拿不到原生绑定：

| 路径 | 结果 |
|------|------|
| `import * as CV from 'cvplayer'` | 拿到 JS 影子对象（无 getCVPlayerManager）|
| `$falcon.jsapi['cvplayer']` | 不存在（该表只有 22 项：http.* / modal.* / storage.*）|

`native.js` 里那条既有结论也印证：Falcon 只提供**原生侧** `registerCModuleLoader`，
JS 侧没有 `requireModule`/`loadModule`，原生模块只能靠静态 import 链接 ——
而 `bilinet` 能用是因为它的 `.so` **打在我们的 AMR 里**并声明了 `external`；
`cvplayer` 的 `.so` 在固件 `libjsapi_export.so` 里，不在包里。

## 3. 当前策略

- `useCVPlayer` **默认 false** → 走已验证的 `<video>` 元素，播放稳定
- 设置页 → 音频分组 → 「使用官方 cvplayer 后端」可随时打开联调
- 打开时仍有 8 秒看门狗：无 `onState` 自动退回 `<video>`

## 4. 要继续推进需要什么

1. **框架的模块解析源码** —— 看它如何把裸 `import 'cvplayer'` 映射到 `.so`
2. **或** 确认有没有声明式加载 `libjsapi_export.so` 的途径（类似 `external` 但指向固件）
3. **或** 拿到 `libjsapi_export.so` 里 `cvplayer_module_init_jsapis` 的反汇编，
   看它注册时依赖什么前置条件

## 5. 顺带沉淀的坑

- **命名导入会黑屏**：`import { CVPlayer } from 'cvplayer'` 在**链接期**就失败，
  JS 的 try/catch 兜不住。必须用 `import * as X from ...`。
- **命名空间导入会包一层 default**：形状是 `top=[default] default=[CVPlayer]`。
- **`Object.getOwnPropertyNames` 对原生绑定对象不可靠**：拿不到非枚举/继承属性。
  这次就是靠 `in` 运算符 + `typeof` 才看清真相。
- **形状判断只能有一处**：`cvAvailable` 与 `Ctor` 各判一次时曾出现
  「app.js 报可用、play.vue 报不可用」。现已统一到 `Ctor()`。
