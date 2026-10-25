#!/usr/bin/env python3
# 生成 libs/Twemoji.ttf —— 设备可渲染的 emoji 字体
#
# 真机结论 (2026-10-25, 反复上机验证):
#   框架的文本渲染只认 **glyf 轮廓字形**, 以下两种彩色格式都渲染不出来:
#     - COLR/CPAL (Twemoji)      -> 字形轮廓是空的, 屏幕上什么都没有
#     - CBDT/CBLC (NotoColorEmoji)-> 纯位图字体没有 glyf, 全部落到 .notdef (⊠ 缺字框)
#   所以必须用"单色轮廓"字体. 选 OpenMoji-black-glyf:
#     - 纯 glyf, 1426 个 emoji 码位, 1.4MB
#     - 形状与 Noto/Twemoji 同一套 Unicode 语义, 只是单色描边
#
# 字体族名固定为 "Twemoji": 与 resources/fonts/fonts.xml 里注册的 name 必须**完全一致**,
# 否则框架按内部名匹配失败, 文本会退化成豆腐块 (踩过).
#
# 用法: python tools/build-emoji-font.py <OpenMoji-black-glyf.ttf>
import sys, os, shutil
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'libs', 'Twemoji.ttf')
FAMILY = 'Twemoji'

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if not src or not os.path.exists(src):
        print('用法: python tools/build-emoji-font.py <OpenMoji-black-glyf.ttf>')
        return 1
    f = TTFont(src)
    if 'glyf' not in f:
        print('错误: 源字体没有 glyf 表, 设备上无法渲染')
        return 2
    for rec in f['name'].names:
        if rec.nameID in (1, 4, 16, 6):
            rec.string = FAMILY.encode('utf-16-be') if rec.platformID == 3 else FAMILY.encode('latin-1')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    f.save(OUT)
    f2 = TTFont(OUT, lazy=True)
    cmap = f2.getBestCmap()
    print('生成 %s: %.0f KB, %d 个码位, glyf=%s' % (
        OUT, os.path.getsize(OUT) / 1024, len(cmap), 'glyf' in f2))
    return 0

if __name__ == '__main__':
    sys.exit(main())
