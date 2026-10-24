# -*- coding: utf-8 -*-
"""本地生成 emoji 图集 (零联网)

为什么用图集而不是一堆小图:
    573 个 36px PNG 独立存放 = 762 KB, 而同样内容打成一张 864x864 图集只要 137 KB (省 82%).
    原因: PNG 每文件都有头/块开销, 且每图独立压缩无法共享调色板.
    做法上这也更贴近设备系统自己: 它的加载动画就是把 28 帧 PNG 交给原生 <image-frame> 序列播放,
    属于"一张大图 + 偏移取样"的同一思路.

素材来源: 本机 Windows 的 Segoe UI Emoji (C:/Windows/Fonts/seguiemj.ttf).
渲染 -> 裁到内容 -> 居中 -> 拼成 COLS 列的图集 -> PNG8 量化(256 色) -> 出一份坐标索引.

用法:
    python tools/gen-emoji.py            # 生成
    python tools/gen-emoji.py --check    # 只检查缺哪些

产物:
    src/assets/emoji/atlas.png          图集 (每格 CELL x CELL)
    src/assets/emoji/index.json         { "1F600": [col,row], ... }
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "emoji")
FONT = "C:/Windows/Fonts/seguiemj.ttf"

CELL = 36          # 单格像素; 界面显示 16-18px, 36 够 2x
COLS = 24          # 每行格数
SIZE = CELL

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emoji_list import EMOJI  # noqa: E402


def render_cell(font, ch):
    """把一个 emoji 渲染成 CELL x CELL 的 RGBA 小图 (居中, 等视觉大小)"""
    im = Image.new("RGBA", (SIZE * 2, SIZE * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ok = False
    try:
        d.text((0, 0), ch, font=font, embedded_color=True)
        ok = True
    except Exception:
        try:
            d.text((0, 0), ch, font=font)
            ok = True
        except Exception:
            ok = False
    if not ok:
        return None
    bbox = im.getbbox()
    if not bbox:
        return None
    cropped = im.crop(bbox)
    w, h = cropped.size
    scale = min(1.0, (CELL - 2) / float(max(w, h)))
    if scale < 1.0:
        cropped = cropped.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    canvas.paste(cropped, ((CELL - cropped.size[0]) // 2, (CELL - cropped.size[1]) // 2), cropped)
    return canvas


def main():
    check_only = "--check" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    atlas_path = os.path.join(OUT, "atlas.png")
    idx_path = os.path.join(OUT, "index.json")

    if check_only:
        if not os.path.exists(atlas_path) or not os.path.exists(idx_path):
            print("图集缺失, 需要先运行 python tools/gen-emoji.py")
            return 1
        idx = json.load(open(idx_path, encoding="utf-8"))
        print("图集就绪, 索引 %d 条" % len(idx))
        return 0

    font = ImageFont.truetype(FONT, SIZE)
    cells = []
    index = {}
    missing = []
    for ch in EMOJI:
        key = "-".join("%04X" % ord(c) for c in ch)
        if key in index:
            continue
        img = render_cell(font, ch)
        if img is None:
            missing.append(ch)
            continue
        index[key] = [len(cells) % COLS, len(cells) // COLS]
        cells.append(img)

    rows = (len(cells) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, img in enumerate(cells):
        atlas.paste(img, ((i % COLS) * CELL, (i // COLS) * CELL))
    # PNG8: emoji 是扁平色块, 256 色量化几乎无损, 体积再降一半
    try:
        q = atlas.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        q.save(atlas_path, "PNG", optimize=True)
    except Exception:
        atlas.save(atlas_path, "PNG", optimize=True)

    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump({"cell": CELL, "cols": COLS, "map": index}, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(atlas_path)
    print("图集 %dx%d, %d 格, %d 个 emoji, %d KB, 失败 %d"
          % (COLS * CELL, rows * CELL, len(cells), len(index), size // 1024, len(missing)))
    if missing:
        print("失败:", "".join(missing[:30]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
