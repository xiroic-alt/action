# PiliNara → PiliPRO 功能对照表

上游: https://github.com/Starfallan/PiliNara (Flutter, forked from PiliPlus)
上游 `lib/pages/` 共 **115 个页面目录**; PiliPRO 落地 **14 个页面**。

这份表是**验收用**的: 每一项给状态、给依据、给"为什么不做"的原因。
图例: ✅ 已实现并真机验证 / 🟡 已实现未逐项验证 / ⬜ 未做 / 🚫 平台做不到

## 一、顶层导航 (上游 nav_bar_config.dart 定义 home / dynamics / mine 三个一级页)

| 上游 | PiliPRO | 状态 | 依据 |
|---|---|---|---|
| home (推荐/热门/番剧/直播) | pages/index | ✅ | 真机截图: 4 列卡片 / 封面铺满 / 上滑自动加载 |
| dynamics (动态) | pages/dynamics | 🟡 | 已实现列表+详情跳转, 未逐项验证 |
| mine (我的) | pages/mine | ✅ | 真机截图: 登录态/收藏/历史/稍后再看三个分栏 |

## 二、核心功能

| 上游 | PiliPRO | 状态 | 说明 |
|---|---|---|---|
| video (视频详情) | pages/video | ✅ | 双栏: 左信息/右评论; 真机截图验证 |
| video (播放) | pages/play | 🟡 | H5 口优先取流 (避 Referer 403); 待逐项验证倍速/清晰度/记忆播放 |
| search / search_panel / search_result | pages/search | 🟡 | 搜索+历史; BV/AV 直达详情页 |
| member (UP 主页) | pages/member | 🟡 | 从详情页 UP 行进入; 投稿列表 |
| fav / fav_detail / fav_panel | pages/fav | 🟡 | 收藏夹两层; 详情页收藏可选收藏夹 |
| msg_feed_top (消息) | pages/msg | 🟡 | 回复/私信 (Web API) |
| article / article_list | pages/article | 🟡 | 专栏阅读 |
| login / login_devices | pages/login | ✅ | 扫码 + **电脑同步一键取 Cookie**; 真机截图验证 |
| setting / settings_search | pages/settings | ✅ | 横屏左分组右条目; 真机截图验证 |
| clean (清除) | pages/clean | 🟡 | 上游无对应页, 为本机 /userdata 123MB 限制新增 |

## 三、未做 / 待做

| 上游 | 状态 | 原因或计划 |
|---|---|---|
| history / history_search | ⬜ | 观看历史页; 数据接口已通 (historyCursor), 页面未写 |
| later / later_search (稍后再看) | ⬜ | 同上, toViewList 已通 |
| follow / follow_search / follow_tag_sort | ⬜ | 关注列表; relationList 已通 |
| live / live_room / live_area | ⬜ | 直播播放已通 (liveRoomPlayUrl), 直播列表页未写 |
| pgc / pgc_index / pgc_review (番剧) | ⬜ | bangumiList 已通, 页面未写 |
| rank / hot / popular_* | ⬜ | popular 已通 (首页热门 tab), 独立榜单页未写 |
| danmaku / danmaku_block / live_dm_block | 🟡 | 弹幕渲染已实现, 屏蔽词/设置页未写 |
| download | 🚫 | 笔上无下载管理器, 且 /userdata 仅 123MB |
| music / audio | 🚫 | 无独立音频播放器组件 |
| dlna / webdav | 🚫 | 无网络文件协议栈 |
| webview | 🚫 | 框架无 webview 组件 |
| share (分享) | 🚫 | 用户明确要求不做 |
| whisper / whisper_* (悄悄关注) | 🚫 | 上游私有能力, 非 B 站公开 Web API |
| ai_chat | 🚫 | 上游接入第三方 AI, 与"只做 B 站 Web API"约束冲突 |
| emote / live_emote | ✅ | 573 张本地 PNG (340KB) + emoji-img.vue 静态映射 |
| sponsor_block | 🚫 | SponsorBlock 服务在本网络不可达 (实测) |
| coin_log / exp_log / log_table / match_info | ⬜ | 记录类页面, 优先级低 |

## 四、平台做不到的 (已实测确认, 非遗漏)

| 能力 | 为什么做不到 |
|---|---|
| 运行时加载字体 | 字体表只在框架启动时读一次; 且字体目录是系统挂载点, 改它会危及整机 (已三次事故) |
| 分享 / b23 短链 | 框架无系统分享入口 |
| 画中画 / 系统媒体控制 / 投屏 / 超分 | 无对应 JSAPI |
| 图片导入 (相册) | 无文件选择器 |
| 拉起系统播放器 | 无 startApp 能力 (且有白屏风险) |
| 音频焦点 API | 无; 改用 `killall -9 SoundPlayer` 让 guardian 重启 (系统其它播放器的做法) |
| 蓝牙音频路由 | 播放器元素无 setAudioDeviceType; 改用系统 `hal-audio -b <MAC>` |

## 五、已知未修

| 项 | 状态 |
|---|---|
| 播放"卡在缓存中" | 未复现; 需要具体画面或日志抓手 |
| ZWJ 组合 emoji (如 👨‍👩‍👧) | 退化成第一个基础码位 (图片方案绕不开) |
| 详情页顶栏"看封面" | 已实现, 未真机点过 |

## 六、本机特有的硬约束 (与上游的最大差异)

| 项 | 值 | 影响 |
|---|---|---|
| 屏幕 | 960x266 (超宽横屏), 顶栏 44 + 内容 222 | 必须左右分栏, 不能照搬上游竖屏布局 |
| 导航 | NavigationRail 侧栏 64px | 用户明确要求不用底部栏 |
| 内存 | 1GB | 列表页需分页, 不能一次拉全 |
| /userdata | 123MB | 必须有清除页; 图片缓存需可清 |
| 字体 | 无字形回退, 一个 text 一种字体 | emoji 必须走图片 |
