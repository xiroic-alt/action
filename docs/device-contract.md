# 设备契约（实测，代码里依赖的硬事实）

这些是**目标设备实测**得出的硬约束，不是推测。凡在 `src/` 里依赖它们的代码，都在注释里标注了本文件。

## 屏幕与触控

| 项 | 值 | 影响 |
|---|---|---|
| 逻辑分辨率 | 960 × 266 | 页面尺寸、卡片列数、弹幕活动区 |
| 顶部系统条 | 44px | 内容区只剩 222px |
| 面板 | 480 × 960，方向 270° | — |
| 合成触摸映射 | `touchX = displayY + 107`，`touchY = 959 - displayX` | 自动化验证时必须换算（`core/env.js` 提供双向函数） |
| 最小触摸命中区 | 44px | 所有可点元素必须显式给尺寸（只挂 padding 的 div 命中区为 0） |

## 运行时（Falcon / QuickJS 20200705）

- 只有 ES module：无 Node API、无浏览器 DOM、无 `fetch`、无 `localStorage`
- 无 canvas：图片/图形只能用 `<text>`/`<image>`/`<div>` 组合（二维码要用 div 拼）
- CSS transition **只支持 `transform`**：opacity 动画会卡在透明态
- 没有 CSS 自定义属性：颜色必须在 JS 里算好、内联到 style（`design/ui.js`）
- 文本没有 `max-lines`：限行用 `lines: N`，`lines: 0` 为不限
- 组件里**只有 `onShow` 会被转发**（onLoad/created 不触发）
- `richtext` 内部元素**不触发点击**（所以评论里的 BV 号用正文下方的可点快捷栏）
- `require('...png')` 只能写在 `.vue` 里（`.js` 里的 require 在设备上会 ReferenceError）

## 视频播放

| 项 | 契约 |
|---|---|
| 元素 | 框架内置 `<video>`，设备侧做成主 surface 的 subsurface 并 `place_below` → **视频恒在 UI 之下** |
| 挖洞 | `<hole>` 用 CLEAR 把矩形清成透明，视频从下面透出（UI 元素压在画面上） |
| 单位 | `position` 事件 / `info.duration` 是**秒**；`play(sec)`/`seekto(sec)` 也吃秒 |
| 方法 | `play pause resume stop seekto setSrc setRate getRate setAudioDeviceType setVideoSurface` |
| 状态串 | `'pause'` 包含子串 `'play'` → 判断必须先 pause 后 play |
| 暂停后 | `getPosition()` 返回 0 → 暂停必须停轮询，否则进度条被打回 0:00 |
| 事件 | `state info position complete error bufferPercent setRateFailed resumed audioDeviceTypeChanged` |
| 取流 | 只吃单一 mp4（`durl`）：请求固定 `fnval=0`（不要 DASH 双流） |
| 清晰度 | `accept_quality`/`accept_description` 是该稿件可选档位；设备解码上限 **1080P**（`DEVICE_MAX_QN = 80`） |
| 进度条 | 原生 `<seekbar>`：`min/max/step` 单位为秒，`@changing` 拖动中 `@change` 松手 |

## 网络

- 系统 `http` JSAPI **不发自定义 header**（UA/Referer 丢失会被风控）→ 全部走 bilinet（内部 popen 调 `/bin/curl`，带浏览器 UA + Referer + `--compressed`）
- 同步 `exec`/`httpGet` 会阻塞 QuickJS 主线程 → **一律用异步**（`httpGetAsync`/`httpPostAsync`/`execAsync`）
- `comment.bilibili.com/<cid>.xml` 返回 deflate 压缩体：靠 curl 的 `--compressed` 解（已在设备侧开启）

## 防息屏

- 官方 JSAPI（`brightness` 模块的 `startAlwaysScreenOn/stopAlwaysScreenOn`）在部分固件拿不到 → 降级用 `exec('/bin/hal-screen on')` 每 6s 一次
- `hal-screen on` 会注入一次触摸，可能误触控制条 → 播放页调用后需要还原控制条状态

## 存储

见 `docs/storage-spec.md`（数据写 `<appid>/data/`，覆盖安装不丢且在系统清理里可见）。
