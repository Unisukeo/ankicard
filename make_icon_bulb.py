# アイコン：平らな Clawd をいっぱいに大きく、頭の上で豆電球がピコーンと光っている絵（2026-11-25〜）
# python -X utf8 make_icon_bulb.py [face] [出力先のフォルダー]
#   face：normal（ふだんの目。今のアイコン）・smile（^ ^）  → icon.svg・icon-180.png・icon-512.png
# 座標は 512×512。PNG は4倍で描いてから縮める。
import math, os, sys
from PIL import Image, ImageDraw

FACE = sys.argv[1] if len(sys.argv) > 1 else 'normal'
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'

BG = '#F6F1E7'
BODY = '#D97757'
INK = '#1F1A17'
BLUSH = '#EE9C86'
GLASS = '#FFD34D'
GLOW = '#FFE9A3'
RAY = '#F2B33D'
METAL = '#8D8A86'
METAL2 = '#B9B5AF'

# Clawd：元の絵（胴 144..369）を S 倍して、下の端に寄せる
S = 1.5
OX, OY = 256 - 256.5 * S, 506 - 466 * S   # 足の先が 506 に来るように
def T(x, y): return (OX + x * S, OY + y * S)
def R(x0, y0, x1, y1): return (*T(x0, y0), *T(x1, y1))

shapes = []  # (種類, 引数…)
# 豆電球（頭の上、まん中）
bx, by, br = 256, 84, 34
q = br / 54  # 口金などは電球の大きさに合わせる
for k in range(8):                       # 光の線（下の2本は電球の口金にかかるので省く）
    a = math.radians(-90 + (k - 3.5) * 32)
    if math.sin(a) > 0.35:
        continue
    r0, r1 = br + 12, br + 27
    shapes.append(('line', [(bx + r0 * math.cos(a), by + r0 * math.sin(a)), (bx + r1 * math.cos(a), by + r1 * math.sin(a))], 11, RAY))
shapes.append(('ellipse', (bx - br - 8, by - br - 8, bx + br + 8, by + br + 8), GLOW))
shapes.append(('ellipse', (bx - br, by - br, bx + br, by + br), GLASS))
shapes.append(('poly', [(bx - 30 * q, by + 38 * q), (bx + 30 * q, by + 38 * q), (bx + 22 * q, by + 64 * q), (bx - 22 * q, by + 64 * q)], GLASS))
shapes.append(('ellipse', (bx - 34 * q, by - 34 * q, bx - 12 * q, by - 6 * q), '#FFF6D6'))     # つや
for y0, y1, w, c in ((62, 74, 24, METAL2), (74, 84, 24, METAL), (84, 94, 24, METAL2), (94, 102, 12, METAL)):  # 口金
    shapes.append(('rect', (bx - w * q, by + y0 * q, bx + w * q, by + y1 * q), c))
# Clawd
for x in (144, 194, 294, 344):
    shapes.append(('rect', R(x, 397, x + 25, 466), BODY))
shapes.append(('rect', R(119, 304, 144, 359), BODY))
shapes.append(('rect', R(369, 304, 394, 359), BODY))
shapes.append(('rect', R(144, 250, 369, 412), BODY))
if FACE == 'smile':
    shapes.append(('ellipse', R(150, 346, 182, 362), BLUSH))
    shapes.append(('ellipse', R(331, 346, 363, 362), BLUSH))
    shapes.append(('line', [T(162, 334), T(183, 304), T(204, 334)], 13 * S, INK))
    shapes.append(('line', [T(309, 334), T(330, 304), T(351, 334)], 13 * S, INK))
else:
    shapes.append(('rect', R(176, 296, 193, 336), INK))
    shapes.append(('rect', R(320, 296, 337, 336), INK))


def svg():
    out = [f'<rect width="512" height="512" fill="{BG}"/>']
    f = lambda v: f'{v:.1f}'
    for s in shapes:
        k = s[0]
        if k == 'rect':
            x0, y0, x1, y1 = s[1]
            out.append(f'<rect x="{f(x0)}" y="{f(y0)}" width="{f(x1-x0)}" height="{f(y1-y0)}" fill="{s[2]}"/>')
        elif k == 'ellipse':
            x0, y0, x1, y1 = s[1]
            out.append(f'<ellipse cx="{f((x0+x1)/2)}" cy="{f((y0+y1)/2)}" rx="{f((x1-x0)/2)}" ry="{f((y1-y0)/2)}" fill="{s[2]}"/>')
        elif k == 'poly':
            out.append('<polygon points="' + ' '.join(f'{f(x)},{f(y)}' for x, y in s[1]) + f'" fill="{s[2]}"/>')
        elif k == 'line':
            out.append('<polyline points="' + ' '.join(f'{f(x)},{f(y)}' for x, y in s[1]) + f'" fill="none" stroke="{s[3]}" stroke-width="{f(s[2])}" stroke-linecap="round" stroke-linejoin="round"/>')
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' + ''.join(out) + '</svg>\n'


def png(size):
    k = 4
    im = Image.new('RGB', (512 * k, 512 * k), BG)
    d = ImageDraw.Draw(im)
    sc = lambda b: [v * k for v in b]
    for s in shapes:
        t = s[0]
        if t == 'rect':
            x0, y0, x1, y1 = s[1]
            d.rectangle(sc((x0, y0, x1 - 0.25, y1 - 0.25)), fill=s[2])
        elif t == 'ellipse':
            d.ellipse(sc(s[1]), fill=s[2])
        elif t == 'poly':
            d.polygon([(x * k, y * k) for x, y in s[1]], fill=s[2])
        elif t == 'line':
            pts = [(x * k, y * k) for x, y in s[1]]
            w = s[2] * k
            d.line(pts, fill=s[3], width=int(w), joint='curve')
            for x, y in pts:
                d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=s[3])
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    open(os.path.join(OUT, 'icon.svg'), 'w', encoding='utf-8').write(svg())
    for n in (180, 512):
        png(n).save(os.path.join(OUT, f'icon-{n}.png'))
    print('icon.svg icon-180.png icon-512.png →', OUT)
