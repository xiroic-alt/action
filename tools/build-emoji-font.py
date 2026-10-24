# -*- coding: utf-8 -*-
"""把 emoji 字体裁剪成本项目需要的子集 (可复现, 零联网)

为什么需要:
    完整 Twemoji COLR 字体 1440 KB, 而本项目只需要 573 个常用 emoji -> 裁完 238 KB.
    体积直接决定安装包大小和笔的闪存占用, 所以这一步必须留在仓库里可复现.

素材来源 (先跑一次 tools/fetch-emoji-font.sh 下载原始字体):
    https://github.com/mozilla/twemoji-colr/releases/download/v0.7.0/Twemoji.Mozilla.ttf

产物:
    libs/Twemoji.ttf        随 AMR 分发, 由设置页"安装表情字体"写到系统字体目录
    (字体落在 libs/ 是因为打包器会整目录打进 AMR; src/ 下只收图片)

用法:
    python tools/build-emoji-font.py <原始字体路径>
"""
import os
import sys

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "libs", "Twemoji.ttf")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emoji_list import EMOJI  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = sys.argv[1]
    if not os.path.exists(src):
        print("找不到原始字体:", src)
        return 2
    # 收集码位 (含 ZWJ 组合里的每个码位)
    cps = set()
    for ch in EMOJI:
        for c in ch:
            cps.add(ord(c))
    uni = ",".join("U+%04X" % c for c in sorted(cps))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    subset.main([src, "--unicodes=" + uni, "--output-file=" + OUT,
                 "--layout-features=*", "--notdef-outline", "--no-hinting"])
    print("生成 %s: %d 字节 (%d 个码位)" % (OUT, os.path.getsize(OUT), len(cps)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
