# PiliPRO

有道词典笔（Falcon / QuickJS mini-app，RK3562，960x266 横屏）上的哔哩哔哩客户端。

- **全量重做**：代码与页面全部重构，不沿用旧 bilibilipan 源码
- **PiliNara 同款设计**：色板/圆角/间距/封面比例/导航结构均取自 PiliNara 源码（出处见 docs/design-spec.md）
- **侧栏导航**：用 NavigationRail（首页 / 动态 / 我的），不使用底栏
- **只做 Web API**：不碰 App API / appkey；私信与消息走 Web 链路
- **Cookie 登录**：扫码登录 + 电脑局域网同步（tools/pc-cookie-server.py）
- **存储落盘**：数据写 `/userdisk/miniapp/data/mini_app/pkg/<appid>/data/`，符合设备固件规范（docs/storage-spec.md）

## 设备与构建

| 项 | 值 |
|---|---|
| 设备 | 有道词典笔 Melon / RK3562 / aarch64 / Buildroot，序列号 9E11700007500215 |
| appid | 8009476000000001 |
| 构建 | 本地不可构建（无 aarch64 工具链）→ 全部走 GitHub Actions（分支 pilipro） |
| 产物 | `PiliPRO` → 8009476000000001.<版本>.amr |

## 目录

```
src/
  app.js              入口: 日志/存储/登录态/功能钩子/页面基类
  core/               env(设备画像) page(基类) net(网络) store(存储)
                      auth(登录态) log(日志) config(设置) paths(落盘路径) feature(功能注册)
  design/             tonal(色板生成) tokens(设计 token) ui(样式工厂)
  components/         nav-rail(侧栏) app-bar(顶栏) video-card(卡片)
  services/           api(Web 接口) wbi(签名) md5(摘要) ime(输入法) qrcode(二维码)
                      danmaku(弹幕) subtitle(字幕) format(格式化) bv(BV/av)
  features/           功能模块(弹幕/字幕…), 每个自注册设置与钩子
  pages/              index(首页) play(播放器) video(详情) search(搜索)
                      mine(我的) login(登录) settings(设置)
tools/                make-icons(图标) validate(体检) check-design(设计/存储门禁) check-core(核心逻辑门禁)
native/bilinet/       原生桥 (HTTP/文件/sqlite), 构建期交叉编译
```

## 开发约定

- 全中文注释与文案
- 颜色/字号/间距一律走 `design/ui.js`，页面不写死色值
- 异步请求必须带世代守卫（`++this._gen`）
- 提交前跑三个门禁：`node tools/validate.mjs`、`node tools/check-design.mjs`、`node tools/check-core.mjs`
