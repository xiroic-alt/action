#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PiliPRO 电脑端登录 / Cookie 同步服务 (配套词典笔「电脑同步」登录方式)
=====================================================================

用法 (电脑需与词典笔同一 WiFi 局域网):
  1. 电脑运行:  python pc-cookie-server.py        (默认端口 9527, 可传参改端口)
  2. 启动后命令行打印局域网地址, 例如 http://192.168.1.100:9527
  3. 电脑浏览器打开 http://127.0.0.1:9527 :
       点「① 一键从浏览器获取」自动读取 (推荐); 读不到再手动粘贴 Cookie 整行点「② 保存」
       获取方法: 浏览器登录 bilibili.com -> F12 -> Network -> 任一
       api.bilibili.com 请求 -> Request Headers -> 复制整行 Cookie:
  4. 词典笔: 登录页 -> 电脑同步 -> 输入电脑局域网 IP -> 「获取并登录」

对外契约 (不要改):
  - 端口 9527
  - 路径 GET /pilipro/cookie 返回 {"ok":true, "sessdata":..., "bili_jct":..., "dede_userid":...}

安全说明:
  - Cookie 等于登录凭证, 请只在本机局域网内使用
  - Cookie 只保存在本服务进程内存中, 不落盘; 停服即消失
  - 用完按 Ctrl+C 关闭; 笔端拿到后即可关

仅使用 Python 标准库, 无需 pip 安装任何东西.
"""
import http.server

# 浏览器 Cookie 数据库读取器 (同目录). 缺了也不影响手动粘贴那条路.
try:
    import browser_cookie
except Exception:
    browser_cookie = None
import json
import socket
import sys
import threading
import webbrowser

# Windows 控制台默认 GBK, 直接 print 中文会乱码; 统一成 UTF-8 并容错
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9527

# 内存中的 Cookie 状态 (不落盘)
state = {"raw": "", "sessdata": "", "bili_jct": "", "dede_userid": ""}


def apply_raw(raw, source):
    """把一整行 Cookie 解析后写入 state. 返回 (ok, message)"""
    parsed = parse_cookie(raw)
    if not parsed["sessdata"]:
        return False, "未识别到 SESSDATA"
    state.update(parsed)
    print("[+] Cookie 已就绪 (%s): SESSDATA %d 字符, csrf %s, UID %s" % (
        source, len(parsed["sessdata"]), "有" if parsed["bili_jct"] else "无",
        parsed["dede_userid"] or "?"))
    return True, "已就绪"


def read_from_browser():
    """从本机浏览器数据库里直接读 bilibili 登录 Cookie.
    返回 (ok, message, source)"""
    if browser_cookie is None:
        return False, "缺少 browser_cookie.py, 请与 pc-cookie-server.py 放在同一目录", ""
    try:
        ck, info = browser_cookie.read_bilibili_cookie()
    except Exception as e:
        return False, "读取浏览器 Cookie 失败: %s" % e, ""
    if not ck:
        return False, info, ""
    ok, msg = apply_raw(ck, "浏览器/" + info)
    return ok, msg, info


def parse_cookie(raw):
    """从整行 Cookie (或 URL 参数形态) 中提取三个关键字段, 大小写不敏感"""
    out = {"sessdata": "", "bili_jct": "", "dede_userid": ""}
    for part in str(raw or "").replace("&", ";").replace("?", ";").split(";"):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        k = k.strip().strip('"').lower()
        v = v.strip().strip('"')
        if k == "sessdata" and not out["sessdata"]:
            out["sessdata"] = v
        elif k == "bili_jct" and not out["bili_jct"]:
            out["bili_jct"] = v
        elif k == "dedeuserid" and not out["dede_userid"]:
            out["dede_userid"] = v
    return out


def get_lan_ip():
    """获取本机局域网 IP (用 UDP 连接公网地址让内核选路由, 不发数据).

    拿不到时按主机名解析兜底; 最后退回 127.0.0.1.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
        finally:
            s.close()
    except Exception:
        pass
    try:
        infos = socket.gethostbyname_ex(socket.gethostname())
        for ip in infos[2]:
            if not ip.startswith("127.") and ":" not in ip:
                return ip
    except Exception:
        pass
    return "127.0.0.1"


PAGE = """<!doctype html>
<html lang="zh">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PiliPRO 登录 · 电脑同步</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#16181c;
     color:#e8edf3;margin:0;display:flex;justify-content:center;padding:36px 16px}
.box{width:720px;max-width:96vw}
h1{font-size:22px;color:#fb7299;margin:0 0 6px}
.sub{color:#8a94a6;font-size:13px;margin:0 0 20px;line-height:1.7}
.card{background:#1d2027;border:1px solid #2b313a;border-radius:14px;padding:20px;margin-bottom:16px}
.card h2{font-size:15px;margin:0 0 12px;color:#c9d3e0;font-weight:600}
textarea{width:100%;height:110px;background:#12151b;color:#d6e4c8;border:1px solid #37404a;
         border-radius:10px;padding:12px;font-size:12px;font-family:Consolas,monospace;resize:vertical}
button{background:#fb7299;color:#fff;border:0;border-radius:20px;padding:10px 26px;
       font-size:14px;cursor:pointer;font-family:inherit;margin-top:12px}
button:disabled{background:#4a525d;cursor:not-allowed}
.tip{color:#8a94a6;font-size:12.5px;line-height:1.8;margin:10px 0 0}
.tip b{color:#c9d3e0}
code{background:#21242b;padding:1px 6px;border-radius:4px;color:#fb7299}
.msg{margin-top:12px;font-size:13.5px;min-height:18px;word-break:break-all}
.ok{color:#3fd67a}.err{color:#ff7a7a}.dim{color:#8a94a6}
.ip{font-size:24px;color:#fb7299;font-weight:700;letter-spacing:1px;font-family:Consolas,monospace}
ol{color:#aab3bf;font-size:13px;line-height:1.9;padding-left:20px;margin:8px 0 0}
</style></head>
<body><div class="box">
<h1>PiliPRO 登录 · 电脑同步</h1>
<p class="sub">把电脑上已登录的 B 站账号 Cookie 同步给词典笔。<b>Cookie 只在进程内存里, 不落盘, 关服务即消失。</b></p>

<div class="card">
  <h2>词典笔获取地址 (待笔端输入)</h2>
  <div class="ip" id="ip">--</div>
  <p class="tip">词典笔上: 登录 → 电脑同步 → 输入上面的局域网 IP → 「获取并登录」</p>
</div>

<div class="card">
  <h2>粘贴 Cookie</h2>
  <textarea id="ck" placeholder="SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx; ...&#10;&#10;获取: 登录 bilibili.com → F12 → Network → 任一 api.bilibili.com 请求 → Request Headers → 复制整行 Cookie:"
            oninput="onEdit()"></textarea>
  <button onclick="grab()" id="gb" style="background:#3fd67a;margin-right:10px">① 一键从浏览器获取</button>
<button onclick="save()">保存并使用</button>
  <div class="msg" id="msg"></div>
  <p class="tip">
    ① 电脑浏览器登录 <code>bilibili.com</code> ② 按 F12 打开开发者工具, 切到 Network
    ③ 刷新页面, 点任一 <code>api.bilibili.com</code> 请求 ④ 在 Request Headers 里找到
    <code>Cookie:</code> 那一整行, 复制回来粘贴到上方。
  </p>
</div>

<div class="card">
  <h2>当前服务状态</h2>
  <div class="msg dim" id="st">启动中…</div>
</div>

<script>
let current = '';
function set(el, t, cls){var e=document.getElementById(el);e.textContent=t;e.className='msg '+(cls||'');}
function onEdit(){ /* 手动编辑时不自动保存 */ }
function grab(){
  // 一键从浏览器数据库读取 bilibili 登录 Cookie.
  // 为什么必须由服务端读: 网页 JS 受同源策略限制, 读不到 bilibili.com 的 Cookie.
  var b=document.getElementById('gb');
  b.disabled=true; var old=b.textContent; b.textContent='正在读取浏览器…';
  fetch('/api/browser-cookie').then(function(r){return r.json();}).then(function(j){
    if(j.ok){
      document.getElementById('ck').value='（已从 '+j.source+' 读取, SESSDATA '+(j.sessdata||'').length+' 字符, UID '+j.uid+'）';
      set('msg','✓ 已从浏览器获取并保存 · 来源 '+j.source,'ok');
      check();
    } else {
      set('msg','✗ '+j.message,'err');
    }
  }).catch(function(e){set('msg','请求失败: '+e,'err');})
    .finally(function(){ b.disabled=false; b.textContent=old; });
}
function save(){
  var v=document.getElementById('ck').value.trim();
  if(!v){set('msg','请先粘贴 Cookie','err');return;}
  fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({cookie:v})}).then(function(r){return r.json();}).then(function(j){
    current=v;
    set('msg',j.ok?('✓ '+j.message):('✗ '+j.message),j.ok?'ok':'err');
    if(j.ok) check();
  }).catch(function(e){set('msg','保存失败: '+e,'err');});
}
function check(){
  fetch('/api/status').then(function(r){return r.json();}).then(function(j){
    var s=document.getElementById('st');
    s.textContent=(j.ok?('✓ 服务正常 · Cookie 已保存 (SESSDATA '+j.sessdata_len+' 字符, csrf '+
      (j.has_jct?'有':'无')+', UID '+j.uid+')'):('✗ 服务正常 · 还没保存 Cookie'));
    s.className='msg '+(j.ok?'ok':'dim');
  }).catch(function(e){set('st','服务异常: '+e,'err');});
}
fetch('/api/info').then(function(r){return r.json();}).then(function(j){document.getElementById('ip').textContent=j.ip;});
check();
setInterval(check,3000);
</script>
</div></body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    """只监听局域网; /save 需要 POST 表单, 其余全 GET"""

    def _send(self, code, body, ctype):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj):
        self._send(200, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif self.path.startswith("/api/info"):
            self._json({"ip": LAN_IP, "port": PORT})
        elif self.path.startswith("/api/status"):
            self._json({
                "ok": bool(state["sessdata"]),
                "sessdata_len": len(state["sessdata"]),
                "has_jct": bool(state["bili_jct"]),
                "uid": state["dede_userid"]
            })
        elif self.path.startswith("/api/browser-cookie"):
            ok, msg, src = read_from_browser()
            print("[i] /api/browser-cookie ->", msg)
            self._json({"ok": ok, "message": msg, "source": src,
                        "sessdata": state["sessdata"], "uid": state["dede_userid"]})
        elif self.path == "/pilipro/cookie":
            # ★ 笔端来取时, 若电脑上还没准备 Cookie, 自动从浏览器数据库读一次 ——
            #   这样用户在笔上点一下"获取并登录"就够了, 不用回电脑粘贴.
            if not state["sessdata"]:
                ok, msg, src = read_from_browser()
                print("[i] 笔端触发自动读取:", msg)
            # ★ 对外契约: 字段名固定 (dede_userid 是下划线形态, 笔端按此解析)
            if state["sessdata"]:
                print("[<-] 笔端取走 Cookie: %s" % self.client_address[0])
            self._json({
                "ok": bool(state["sessdata"]),
                "sessdata": state["sessdata"],
                "bili_jct": state["bili_jct"],
                "dede_userid": state["dede_userid"]
            })
        else:
            self._send(404, "not found", "text/plain")

    def do_POST(self):
        if self.path != "/save":
            self._send(404, "not found", "text/plain")
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = json.loads(self.rfile.read(n).decode("utf-8", "replace")).get("cookie", "")
        except Exception:
            raw = ""
        parsed = parse_cookie(raw)
        if parsed["sessdata"]:
            state.update(parsed)
            print("[+] Cookie 已保存: SESSDATA %d 字符, csrf %s, UID %s" % (
                len(parsed["sessdata"]), "有" if parsed["bili_jct"] else "无", parsed["dede_userid"] or "?"))
            self._json({"ok": True, "message": "已保存, 现在到词典笔上点「获取并登录」"})
        else:
            print("[!] 提交内容里没有 SESSDATA")
            self._json({"ok": False, "message": "未识别到 SESSDATA, 请复制完整的 Cookie 行"})

    def log_message(self, fmt, *args):
        pass  # 静默默认访问日志


def main():
    global LAN_IP
    LAN_IP = get_lan_ip()
    # 绑定 0.0.0.0: 同时监听 127.0.0.1(本机浏览器) 与局域网(词典笔).
    # 只绑 LAN_IP 会导致本机用 127.0.0.1 打不开 —— 而脚本自己的提示正是 127.0.0.1.
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("PiliPRO 登录 / Cookie 同步服务")
    print("  电脑端页面:   http://127.0.0.1:%d" % PORT)
    print("  词典笔输入 IP: %s" % LAN_IP)
    print("  笔端获取地址: http://%s:%d/pilipro/cookie" % (LAN_IP, PORT))
    print("  监听 0.0.0.0:%d (本机回环 + 局域网) · Ctrl+C 退出" % PORT)
    try:
        threading.Timer(0.8, lambda: webbrowser.open("http://127.0.0.1:%d" % PORT)).start()
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("")
        print("已退出 (Cookie 为内存态, 未落盘)")


if __name__ == "__main__":
    main()
