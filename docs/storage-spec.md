# PiliPRO 存储落盘规范

依据: 目标设备固件实测规范 (VM 工作区 `SPEC-miniapp-data-layout.md`, 证据等级全部标注了已证/推断)。

## 结论

| 项 | 位置 | 说明 |
|---|---|---|
| 应用数据根 | `/userdisk/miniapp/data/mini_app/pkg/<appid>/data/` | 覆盖安装**不替换**; 系统「空间清理」按包统计 |
| 数据库 | `<appid>/data/database/pilipro.db` | 规范实测形态 database/*.db |
| 运行日志 | `<appid>/data/pilipro.log` (+ .1 轮转) | 与数据库同目录 |
| 键值兜底 | `<appid>/data/kv.json` | 仅 sqlite 不可用时 |
| 登录态兜底 | `<appid>/data/auth.json` | 仅 sqlite 不可用时 |

## 明确禁止

- **不写安装体 `<appid>/a/`** —— 升级/覆盖安装时会被整体替换 (规范 §3.2 适配要点 2)
- **不写 /userdata/** —— 只有 125MB (实测已用 80%), 且跟系统服务共用
- **不写旧的 /userdisk/pilipro/** —— 那是旧架构 (bilibilipan) 的遗留位置

## 实现

- `src/core/paths.js` 是唯一路径来源: appid 运行时取 `$falcon.$appid`, 退回构建期常量
- `store.js / log.js / auth.js` 全部消费 paths.js, 禁止散落字符串路径
- package.json 的 appid 与 paths.js 的 APPID_FALLBACK 由 check-design.mjs 门禁强制一致

## 清理页适配 (R6)

`src/app.json` 声明:

```json
"props": { "supportCleanUp": true, "cleanUpThreshold": 30 }
```

这样系统设置 → 空间清理 能按包扫到 PiliPRO 的数据目录。
