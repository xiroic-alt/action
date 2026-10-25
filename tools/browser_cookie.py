# -*- coding: utf-8 -*-
"""
浏览器 Cookie 读取器 (Windows / Linux 通用, 只用标准库)
=======================================================

为什么需要它:
  用户不想手动从 F12 复制 Cookie。网页 JS 受同源策略限制**读不到** bilibili.com 的
  Cookie, 所以只能由本机进程直接读浏览器的 Cookie 数据库。

支持的浏览器:
  - Chromium 系 (Chrome / Edge / Brave / Vivaldi / Chromium): Cookies 是 SQLite,
    encrypted_value 用 v10/v11 前缀: AES-256-GCM, 密钥在 Local State 里由系统
    DPAPI 保护 (Windows) 或固定口令 "peanuts" (Linux)。
  - Firefox: cookies.sqlite 明文, 直接读。

实现要点:
  - 不依赖任何第三方库。AES-GCM 走 Windows 自带的 bcrypt.dll (ctypes),
    没有 cryptography 也能解密。
  - 数据库被浏览器独占时先复制到临时目录再读 (WAL 也要一起复制)。
  - 只取 .bilibili.com 的 SESSDATA / bili_jct / DedeUserID 三个字段。

对外:
  read_bilibili_cookie() -> (cookie_str, source) 或 (None, 失败原因)
"""

import base64
import ctypes
import glob
import json
import os
import shutil
import sqlite3
import sys
import tempfile

WANT = ("SESSDATA", "bili_jct", "DedeUserID")


# ---------------------------------------------------------------- Windows 解密

def _dpapi_unprotect(data):
    """用 DPAPI 解出 Chromium 的 master key (仅 Windows)"""
    if not sys.platform.startswith("win"):
        return None

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong),
                    ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
        return None
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


class _AuthInfo(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_ulong),
        ("dwInfoVersion", ctypes.c_ulong),
        ("pbNonce", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbNonce", ctypes.c_ulong),
        ("pbAuthData", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbAuthData", ctypes.c_ulong),
        ("pbTag", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbTag", ctypes.c_ulong),
        ("pbMacContext", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbMacContext", ctypes.c_ulong),
        ("cbAAD", ctypes.c_ulong),
        ("cbData", ctypes.c_ulonglong),
        ("dwFlags", ctypes.c_ulong),
    ]


def _aes_gcm_decrypt(key, nonce, cipher, tag):
    """AES-256-GCM 解密 (走 bcrypt.dll, 无需第三方库)"""
    if not sys.platform.startswith("win"):
        return None
    bcrypt = ctypes.windll.bcrypt
    h_alg = ctypes.c_void_p()
    h_key = ctypes.c_void_p()
    try:
        if bcrypt.BCryptOpenAlgorithmProvider(ctypes.byref(h_alg), "AES", None, 0) != 0:
            return None
        mode = "ChainingModeGCM".encode("utf-16-le")
        if bcrypt.BCryptSetProperty(h_alg, "ChainingMode", mode, len(mode), 0) != 0:
            return None
        if bcrypt.BCryptGenerateSymmetricKey(h_alg, ctypes.byref(h_key), None, 0,
                                            key, len(key), 0) != 0:
            return None

        info = _AuthInfo()
        info.cbSize = ctypes.sizeof(_AuthInfo)
        info.dwInfoVersion = 1
        info.cbNonce = len(nonce)
        info.pbNonce = (ctypes.c_ubyte * len(nonce)).from_buffer_copy(nonce)
        info.cbTag = len(tag)
        info.pbTag = (ctypes.c_ubyte * len(tag)).from_buffer_copy(tag)
        info.cbAuthData = 0
        info.cbAAD = 0
        info.cbData = 0
        info.dwFlags = 0

        out_len = ctypes.c_ulong(0)
        # 第一次取长度
        bcrypt.BCryptDecrypt(h_key, cipher, len(cipher), ctypes.byref(info),
                             None, 0, None, 0, ctypes.byref(out_len), 0)
        buf = ctypes.create_string_buffer(out_len.value or 1)
        if bcrypt.BCryptDecrypt(h_key, cipher, len(cipher), ctypes.byref(info),
                                None, 0, buf, out_len.value,
                                ctypes.byref(out_len), 0) != 0:
            return None
        return buf.raw[:out_len.value]
    finally:
        if h_key:
            bcrypt.BCryptDestroyKey(h_key)
        if h_alg:
            bcrypt.BCryptCloseAlgorithmProvider(h_alg, 0)


def _master_key(local_state_path):
    """从 Local State 取出 Chromium 的加密密钥"""
    try:
        with open(local_state_path, "r", encoding="utf-8") as f:
            state = json.load(f)
        enc = base64.b64decode(state["os_crypt"]["encrypted_key"])
    except Exception:
        return None
    if enc[:5] == b"DPAPI":
        enc = enc[5:]
        return _dpapi_unprotect(enc)
    return None


def _decrypt_value(blob, key):
    """解一条 encrypted_value (v10/v11 = AES-GCM; v20 = 应用绑定加密, 暂不支持)"""
    if not blob:
        return ""
    if blob[:3] in (b"v10", b"v11"):
        if not key:
            return ""
        nonce = blob[3:15]
        payload = blob[15:]
        if len(payload) < 16:
            return ""
        cipher, tag = payload[:-16], payload[-16:]
        raw = _aes_gcm_decrypt(key, nonce, cipher, tag)
        return raw.decode("utf-8", "replace") if raw else ""
    if blob[:3] == b"v20":
        return ""       # Chrome 127+ 应用绑定加密, 需要额外授权, 走手动兜底
    # 老版本或未加密
    try:
        return blob.decode("utf-8", "replace")
    except Exception:
        return ""


# ---------------------------------------------------------------- 浏览器目录

def _chromium_roots():
    out = []
    if sys.platform.startswith("win"):
        la = os.environ.get("LOCALAPPDATA") or ""
        for name in ("Google/Chrome", "Microsoft/Edge", "BraveSoftware/Brave-Browser",
                     "Vivaldi", "Chromium"):
            p = os.path.join(la, *name.split("/"), "User Data")
            if os.path.isdir(p):
                out.append((name.split("/")[0], p))
    else:
        home = os.path.expanduser("~")
        for rel, name in ((".config/google-chrome", "Chrome"),
                          (".config/microsoft-edge", "Edge"),
                          (".config/chromium", "Chromium"),
                          (".config/BraveSoftware/Brave-Browser", "Brave")):
            p = os.path.join(home, rel)
            if os.path.isdir(p):
                out.append((name, p))
    return out


def _read_chromium(name, root):
    """读一个 Chromium 配置目录, 返回 (cookie_str, 来源) 或 (None, 原因)"""
    key = _master_key(os.path.join(root, "Local State"))
    # 优先 Default, 其余 Profile * 也扫
    profiles = []
    d = os.path.join(root, "Default")
    if os.path.isdir(d):
        profiles.append(d)
    for p in sorted(glob.glob(os.path.join(root, "Profile *"))):
        profiles.append(p)

    for prof in profiles:
        db = os.path.join(prof, "Network", "Cookies")
        if not os.path.isfile(db):
            db = os.path.join(prof, "Cookies")
        if not os.path.isfile(db):
            continue
        tmpdir = tempfile.mkdtemp(prefix="pilipro-ck-")
        try:
            tmp = os.path.join(tmpdir, "Cookies")
            shutil.copy2(db, tmp)
            for suffix in ("-wal", "-shm"):
                if os.path.exists(db + suffix):
                    shutil.copy2(db + suffix, tmp + suffix)
            con = sqlite3.connect(tmp)
            try:
                rows = con.execute(
                    "SELECT name, value, encrypted_value FROM cookies "
                    "WHERE host_key LIKE '%bilibili.com'").fetchall()
            finally:
                con.close()
        except Exception as e:
            shutil.rmtree(tmpdir, ignore_errors=True)
            continue
        shutil.rmtree(tmpdir, ignore_errors=True)

        found = {}
        for cname, val, enc in rows:
            if cname not in WANT:
                continue
            v = val if val else _decrypt_value(enc, key)
            if v:
                found[cname] = v
        if "SESSDATA" in found:
            return _join(found), "%s (%s)" % (name, os.path.basename(prof))
    return None, "%s: 未找到 bilibili 登录 Cookie" % name


def _read_firefox():
    home = os.path.expanduser("~")
    if sys.platform.startswith("win"):
        base = os.path.join(os.environ.get("APPDATA") or "", "Mozilla", "Firefox", "Profiles")
    else:
        base = os.path.join(home, ".mozilla", "firefox")
    for prof in sorted(glob.glob(os.path.join(base, "*"))):
        db = os.path.join(prof, "cookies.sqlite")
        if not os.path.isfile(db):
            continue
        tmpdir = tempfile.mkdtemp(prefix="pilipro-ff-")
        try:
            tmp = os.path.join(tmpdir, "cookies.sqlite")
            shutil.copy2(db, tmp)
            con = sqlite3.connect(tmp)
            try:
                rows = con.execute(
                    "SELECT name, value FROM moz_cookies WHERE host LIKE '%bilibili.com'").fetchall()
            finally:
                con.close()
        except Exception:
            shutil.rmtree(tmpdir, ignore_errors=True)
            continue
        shutil.rmtree(tmpdir, ignore_errors=True)
        found = {k: v for k, v in rows if k in WANT and v}
        if "SESSDATA" in found:
            return _join(found), "Firefox (%s)" % os.path.basename(prof)
    return None, "Firefox: 未找到 bilibili 登录 Cookie"


def _join(found):
    return "; ".join("%s=%s" % (k, found[k]) for k in WANT if found.get(k))


def read_bilibili_cookie():
    """返回 (cookie 整行, 来源说明) 或 (None, 失败原因)"""
    reasons = []
    for name, root in _chromium_roots():
        ck, why = _read_chromium(name, root)
        if ck:
            return ck, why
        reasons.append(why)
    ck, why = _read_firefox()
    if ck:
        return ck, why
    reasons.append(why)
    if not reasons:
        reasons.append("没有找到已安装的浏览器")
    return None, "; ".join(reasons)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    cookie, info = read_bilibili_cookie()
    if cookie:
        print("来源:", info)
        print("Cookie:", cookie)
    else:
        print("失败:", info)
