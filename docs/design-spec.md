# PiliPRO 设计规格 (对齐 PiliNara)

> 来源全部是 **Starfallan/PiliNara 仓库源码**，不是目测。每条都标了文件与行号出处。
> PiliPRO 是词典笔 (960x266 横带) 上的重制版，凡与手机规格冲突处，都以"笔屏物理约束"覆盖，
> 并在下表写明覆盖理由。

## 1. 布局骨架：侧栏 (NavigationRail)，**不使用底栏**

用户要求：使用平板/横屏设备的侧栏形态。

出处 `lib/pages/main/view.dart`：
- 底栏三分支：`FloatingNavigationBar` / `NavigationBar`(M3) / `BottomNavigationBar` (line 159-243)
- 侧栏分支：`NavigationDrawer`(平板, 宽 130 + padding, tilePadding 垂直5/水平12, indicator 圆角 16)
  与 `NavigationRail` (line 285-303)
- 切换开关：`Pref.useSideBar` (默认 false, storage_pref.dart:1204)、`Pref.optTabletNav` (默认 true, :1033)
- 主壳内容：`PageView` 承载各导航页 (line 323-328)

**PiliPRO 落地**：固定走 `NavigationRail` 分支。
| 规格 | PiliNara | PiliPRO (笔屏) | 理由 |
|---|---|---|---|
| 侧栏形态 | NavigationRail | NavigationRail | 与"横屏设备侧栏"一致 |
| 侧栏宽度 | M3 默认 (~80) | 84px | 笔屏总宽 960，84 后内容区 876 仍够 3 列卡片 |
| 侧栏垂直对齐 | `groupAlignment: 0.5` | 居中 | 直接沿用 |
| 标签显示 | `labelType: .selected` | 仅选中项显示 | 直接沿用 |
| 侧栏背景 | `Colors.transparent` | surfaceContainerLow | 笔屏无模糊层，透明会与内容糊在一起 |
| 侧栏顶部 | `leading: userAndSearchVertical()` | 头像 + 搜索 (竖排) | 直接沿用其语义 |
| 底栏 | 可选 | **不实现** | 用户明确要求 |

## 2. 导航项：只有 3 项

出处 `lib/models/common/nav_bar_config.dart`：`NavigationBarType` = **首页 / 动态 / 我的**，
每项 = (label, 线性图标, 选中实心图标, 目标页面)。

PiliPRO 落地：侧栏 3 项 —— 首页(推荐/热门/番剧/直播 由页内 tab 承担)、动态、我的。
图标沿用"线框未选 / 实心选中"两态 (与 PiliNara 一致，不是所有项都实心)。

## 3. 首页顶部 TabBar

出处 `lib/pages/home/view.dart` (line 55-80)：
- 外层 `Padding(top: 4)`，`SizedBox(height: 42)`，`isScrollable: true`
- `dividerColor: Colors.transparent`、`dividerHeight: 0`、`tabAlignment: TabAlignment.center`
- `splashBorderRadius: Style.mdRadius` = 圆角 10
- 点击选中 tab 时：已是当前页 -> 回顶/刷新 (`toTopAndRefresh`)

PiliPRO 落地：顶部 tab 条 **高 42**、上间距 **4**、无分隔线、选中态用圆角 10 的 primaryContainer 药丸、
指示器为 M3 primary 下划线。点击当前 tab = 回顶刷新（沿用其行为）。

## 4. 尺寸与圆角常量 (`lib/common/style.dart`)

| 名称 | PiliNara | PiliPRO | 说明 |
|---|---|---|---|
| cardSpace | 8.0 | 8 | 卡片间距，原样 |
| safeSpace | 12.0 | 12 | 安全边距，原样 |
| mdRadius / imgRadius | 10 | 10 | 卡片/图片圆角，原样 |
| bottomSheetRadius | 28 (顶部圆角) | 28 | 底部面板，原样 |
| radiusMenu | 16 | 16 | 弹出菜单圆角，原样 |
| coverRatio | 16/10 | 16/10 | 视频封面比例，原样 (比 16:9 更"厚"，是其视觉特征) |
| imgMaxRatio | 2.6 | 2.6 | 图片最大宽高比 |
| topBarHeight | 52 | 44 | ⚠覆盖：笔屏系统条就是 44，52 会让内容区只剩 214 |
| dialog 宽 | 420 | 480 | 笔屏 960 宽，对话框按 50% 走 |
| buttonStyle 密度 | density(-2,-1.25), tapTarget shrinkWrap | 最小命中区 44px | ⚠覆盖：笔是触摸设备，命中区不得小于 44 |

## 5. 主题 (`lib/utils/theme_utils.dart`)

- `useMaterial3: true`（M3 全套）
- AppBar：`elevation: 0`、`titleSpacing: 0`、`centerTitle: false`、背景 = `colorScheme.surface`、
  标题 **16px**、`scrolledUnderElevation: 0`（滚动不变色 —— 这条很容易被忽略，它决定了"滚动时顶栏不浮起"）
- SnackBar：`elevation: 20`、背景 = `secondaryContainer`、文字 = `onSecondaryContainer`、动作色 = `primary`
- PopupMenu：背景 `surfaceContainerLow`、`elevation: 3`、圆角 16、`menuPadding: 4`、标签 14px/w500
- 主色种子：B 站粉 `#FB7299`（PiliPRO 的 `SEEDS[0] = ('bili', '#FB7299')`）

## 6. 笔屏几何与触控 (设备实测，非 PiliNara)

- 逻辑分辨率 960x266，顶部系统条 44px，内容区 222px
- 面板 480x960 旋转 270°；合成触摸映射 `touchX = displayY + 107`、`touchY = 959 - displayX`
- 无 CSS 自定义属性：颜色只能来自 JS 计算后内联到 style
- transition 只支持 `transform`（opacity 动画会卡在透明态）
- 点击事件必须挂在**有尺寸**的元素上；richtext 内部元素不可点
- 文本无 `max-lines`，限行用 `lines: N`；`lines: 0` = 不限

## 7. 待补 (`docs/design-spec.md` 会随实现继续补)

- 视频详情页的操作栏按钮顺序（点赞/投币/收藏/转发）与位置 —— 取自 `lib/pages/video/introduction/ugc/`
- 搜索页顶栏与热搜组织 —— 取自 `lib/pages/search/view.dart`
- 播放器控制层 —— 取自 `lib/pages/video/` 播放相关 widget
