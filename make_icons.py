# アイコンを作る：Clawd が ○ と × の札を両手で上げている絵（本人用）
# （前の平らな絵。今のアイコンは make_icon_soft.py）python -X utf8 make_icons.py → icon.svg・icon-180.png・icon-512.png
# 座標は 512×512。PNG は4倍で描いてから縮める（ふちをなめらかに）。
from PIL import Image, ImageDraw

BG = '#F6F1E7'
BODY = '#D97757'
INK = '#1F1A17'
RED = '#E53935'
BLUE = '#1E63C8'
STICK = '#9A7356'
BOARD = '#FFFFFF'

# Clawd（元の絵を 0.42 倍）
body = (144, 250, 369, 412)
legs = [(x, 397, x + 25, 466) for x in (144, 194, 294, 344)]
# 目は笑顔（^ ^）。元の「できた！」の目を 0.42 倍
smile = [[(162, 334), (183, 304), (204, 334)], [(309, 334), (330, 304), (351, 334)]]
smile_w = 13
BLUSH = '#EE9C86'
cheeks = [(150, 346, 182, 362), (331, 346, 363, 362)]  # ほっぺ
arms = [(119, 210, 144, 312), (369, 210, 394, 312)]
# 札（左が ○、右が ×）
signs = [(56, 62, 206, 188), (306, 62, 456, 188)]
sticks = [(127, 184, 135, 214), (377, 184, 385, 214)]
o_center, o_r, o_w = (131, 125), 38, 15
x_center, x_half, x_w = (381, 125), 32, 16
shadow = (130, 458, 383, 478)


def svg():
    r = lambda b, fill, extra='': f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]-b[0]}" height="{b[3]-b[1]}" fill="{fill}"{extra}/>'
    parts = [f'<rect width="512" height="512" fill="{BG}"/>',
             f'<ellipse cx="{(shadow[0]+shadow[2])/2}" cy="{(shadow[1]+shadow[3])/2}" rx="{(shadow[2]-shadow[0])/2}" ry="{(shadow[3]-shadow[1])/2}" fill="{INK}" opacity="0.1"/>']
    parts += [r(s, STICK) for s in sticks]
    for s in signs:
        parts.append(f'<rect x="{s[0]}" y="{s[1]}" width="{s[2]-s[0]}" height="{s[3]-s[1]}" rx="10" fill="{BOARD}" stroke="{INK}" stroke-width="8"/>')
    cx, cy = o_center
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{o_r}" fill="none" stroke="{RED}" stroke-width="{o_w}"/>')
    cx, cy = x_center
    h = x_half
    parts.append(f'<path d="M{cx-h} {cy-h}L{cx+h} {cy+h}M{cx+h} {cy-h}L{cx-h} {cy+h}" stroke="{BLUE}" stroke-width="{x_w}" stroke-linecap="round"/>')
    parts += [r(a, BODY) for a in arms]
    parts += [r(l, BODY) for l in legs]
    parts.append(r(body, BODY))
    for c in cheeks:
        parts.append(f'<ellipse cx="{(c[0]+c[2])/2}" cy="{(c[1]+c[3])/2}" rx="{(c[2]-c[0])/2}" ry="{(c[3]-c[1])/2}" fill="{BLUSH}"/>')
    for pts in smile:
        parts.append('<polyline points="' + ' '.join(f'{x},{y}' for x, y in pts) + f'" fill="none" stroke="{INK}" stroke-width="{smile_w}" stroke-linecap="round" stroke-linejoin="round"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" shape-rendering="geometricPrecision">'
            + ''.join(parts) + '</svg>\n')


def png(size):
    k = 4
    S = 512 * k
    im = Image.new('RGB', (S, S), BG)
    d = ImageDraw.Draw(im, 'RGBA')
    sc = lambda b: [v * k for v in b]
    d.ellipse(sc(shadow), fill=(31, 26, 23, 26))
    for s in sticks:
        d.rectangle(sc(s), fill=STICK)
    for s in signs:
        d.rounded_rectangle(sc((s[0] - 4, s[1] - 4, s[2] + 4, s[3] + 4)), radius=14 * k, fill=INK)
        d.rounded_rectangle(sc((s[0] + 4, s[1] + 4, s[2] - 4, s[3] - 4)), radius=7 * k, fill=BOARD)
    cx, cy = o_center
    R = o_r + o_w / 2
    d.ellipse(sc((cx - R, cy - R, cx + R, cy + R)), outline=RED, width=o_w * k)
    cx, cy = x_center
    h = x_half
    for a, b in (((cx - h, cy - h), (cx + h, cy + h)), ((cx + h, cy - h), (cx - h, cy + h))):
        d.line(sc(a + b), fill=BLUE, width=x_w * k)
        for p in (a, b):
            rr = x_w / 2
            d.ellipse(sc((p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr)), fill=BLUE)
    for b in arms + legs + [body]:
        d.rectangle(sc((b[0], b[1], b[2] - 1, b[3] - 1)), fill=BODY)
    for pts in smile:
        d.line([v * k for p in pts for v in p], fill=INK, width=smile_w * k, joint='curve')
    for c in cheeks:
        d.ellipse(sc(c), fill=BLUSH)
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    open('icon.svg', 'w', encoding='utf-8').write(svg())
    for n in (180, 512):
        png(n).save(f'icon-{n}.png')
    print('icon.svg icon-180.png icon-512.png')
