# bilinet 原生实例生命周期修复

## 结论

修复提交：e417daa86821ce4375db8120c773cb371d139d66。
构建：GitHub Actions 37572791962，build/probe 均成功。
包版本保持 0.9.62；运行标记为 P37-native-context。
AMR：543911 字节，SHA-256 为
534f4977f8e4467219ce67fb8e79187c9b76fae69ffe37f6def2a86b0d9438ad。

## 复现与根因

真实路径是短按设备返回键退出应用，看到桌面后点击 bilibilipan 图标重新进入。
本次复现、覆盖安装、修复后验收期间 miniapp 宿主 PID 一直为 2629；未杀宿主进程。
修复前该路径在首页显示 this object js call is disabled，文件、SQLite、HTTP 同时失败。

native/bilinet/src/BiliNet.cpp 的 createBiliNet() 使用进程级 static BiliNet*，
并额外 REF() 永久持有它。不同模块/上下文的 objectCreator() 返回同一个原生对象。
SDK 的 JQObjectTemplate::NewInstance() 会给对象写入当前 _objTpl，随后
JQBaseObject::NewObject() 会 attach 当前 context。该对象只有一套 _ctx/_objTpl/_valuePtr，
因此不能同时代表多个 JS 包装实例：重新 attach 会覆盖状态，旧包装的 finalizer/detach
还会清除 _ctx。SDK Caller 在调用方法前检测 isJSCallDisabled()，所有方法一起报错。

证据位置：
- native/bilinet/src/BiliNet.cpp：createBiliNet() 的 objectCreator。
- SDK src/jqutil_v2/JQObjectTemplate.cpp:485：创建对象、设置 _objTpl、NewObject。
- SDK src/jqutil_v2/JQBaseObject.cpp:47：detach 清除 _ctx；:90 重新 attach。
- SDK src/jqutil_v2/JQBaseObject.cpp:300：JS 包装 finalizer 执行 detach 和 UNREF。
- SDK src/jqutil_v2/JQObjectTemplate.cpp:311：disabled 检查。

## 修复

objectCreator 每次 return new BiliNet()；引用和回收交由 SDK 管理，删除单例及额外 REF。
SDK JQAsyncInfo 保留对象的弱引用，旧异步调用继续关联自己的实例，避免回调串到新实例。
没有修改 SDK 的 disabled 检查，也没有强行重新启用旧对象。

services/native.js 仅转出真实原生模块；删除 require 重取、伪造空响应、永久 dead 标记、
自动重放请求等 JS 补丁。删除启动阶段针对该错误的退避计时器。
保留低频 attach/detach 生命周期日志，供真机确认对象与 context 的对应关系。

此前关于“框架自身 JSAPI 是活的”“循环 import 就是根因”“只能用 HTTP fallback”
均未被证明；本次修复以生产 C++ 单例及真实桌面复现为依据。

## 回归与验收

本地执行：

- node tools/check-native-lifecycle.mjs
- node tools/validate.mjs
- node tools/check-ui.mjs

生命周期回归提取生产 objectCreator lambda 并编译执行，使用最小生命周期模型检查
实例隔离、旧实例延迟 detach、creator 未额外持有 REF。修复前确实失败：
NATIVE-LIFECYCLE FAIL: reused disabled native instance across contexts。
修复后通过。它是工厂级回归；完整 SDK 行为仍由真机验收覆盖。
静态检查 27 页 / 115 图标通过；服务及页面链接 142 项断言通过。

真机证据（设备时间 2026-10-07）：
- 12:26:15：旧包，实际桌面图标进入，文件/dbOpen/httpGetAsync 均报 disabled。
- 13:04:18、13:04:33、13:04:47：三个完整返回桌面/图标重进循环；每轮截图看到新推荐内容。
- 对应原生实例分别为 0x558411af50、0x5584b7a320、0x5583cb3010，宿主 PID 同为 2629。
- 设置页点击蓝色改为 teal，SQLite 行读回 teal；返回桌面重进后首页仍为 teal。
  随后通过设置 UI 恢复原来的 blue，最终数据库确认原设置恢复。
- 13:25：退出前进程列表仍有 curl；截图确认退出到了实际桌面；图标重进后为新实例，
  再次取得非空 HTTP 响应并显示真实推荐内容。
- 13:26：miniapp_cli memoryUsageGC 后进入热门页，取得新的列表并截图确认。
- 新包验收窗口内 disabled、空响应、unhandled promise 记录均为 0；auth 行仍为 1，
  settings JSON 长度 460，独立 cfg.json 保持不存在。

未将两次 ADB 往返导致的误长按（打开语音助手）当作退出成功。
最终短按使用设备内连续命令：send_event menu press; usleep 80000; send_event menu release。
每次进入都实际点击桌面图标，并用截图、启动记录及原生返回共同验证。

## 证据与保留产物

工作区根目录 ci-out/native-lifecycle/ 保存 baseline-app、desktop-cycle-1、
reenter-cycle-1/2/3、settings-persisted-home、async-desktop、async-reentry、post-gc-hot 截图。
工作区根目录 backup/bilibilipan-0.9.62-e417daa.amr 为固定校验产物；设备同名包位于
/userdisk/xiro/backup/。同时保留改动前包及原 0.9.57 回滚包。

本记录仅覆盖 native 生命周期故障；其他页面和体验迭代不属于本包的验收声明。
