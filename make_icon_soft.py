# ふっくらした立体の Clawd（角の丸い箱をなめらかにつなぎ、光を当てて描く）
# 2026-11-25 に一度だけ使ったふっくらした立体のアイコン（今のアイコンは make_icon_bulb.py）
# python -X utf8 make_icon_soft.py → icon-180.png・icon-512.png（2 分ほどかかる）
import math, sys
import numpy as np
from PIL import Image, ImageFilter

YAW = math.radians(-22)
PITCH = math.radians(12)
N = 1024

BG = np.array([246, 241, 231]) / 255
BODY = np.array([217, 119, 87]) / 255
INK = np.array([31, 26, 23]) / 255
RED = np.array([229, 57, 53]) / 255
BLUE = np.array([30, 99, 200]) / 255
STICK = np.array([154, 115, 86]) / 255
BOARD = np.array([253, 251, 247]) / 255
BLUSH = np.array([240, 150, 128]) / 255


def W(x, y, z=0.0):
    return np.array([x - 256.0, 256.0 - y, z])


# 部品：(中心, 半分の大きさ, 角の丸み, 材質)  材質 0=体 1=棒 2=札
D = 62
parts = []
def box(x0, y0, x1, y1, z0, z1, r, m):
    c = W((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    h = np.array([(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2])
    parts.append((c, h, r, m))

box(144, 250, 369, 412, -D, D, 30, 0)                 # 胴
for x in (144, 194, 294, 344):
    box(x, 380, x + 25, 466, -26, 26, 12, 0)          # 足
box(122, 212, 158, 318, -20, 20, 15, 0)               # 腕
box(355, 212, 391, 318, -20, 20, 15, 0)
for sx in (127, 377):
    box(sx - 1, 178, sx + 9, 222, -5, 5, 4, 1)        # 棒
for bx in (56, 306):
    box(bx, 62, bx + 150, 188, -9, 9, 9, 2)           # 札


def sd_box(p, c, h, r):
    q = np.abs(p - c) - (h - r)
    return np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(q.max(axis=-1), 0) - r


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def scene(p, want_mat=False):
    body = None
    others = []
    for c, h, r, m in parts:
        d = sd_box(p, c, h, r)
        if m == 0:
            body = d if body is None else smin(body, d, 14)
        else:
            others.append((d, m))
    dist = body
    mat = np.zeros(len(p), dtype=int)
    for d, m in others:
        closer = d < dist
        mat[closer] = m
        dist = np.minimum(dist, d)
    return (dist, mat) if want_mat else dist


def rot(v, inv=False):
    x, y, z = v[..., 0], v[..., 1], v[..., 2]
    cy, sy, cp, sp = math.cos(YAW), math.sin(YAW), math.cos(PITCH), math.sin(PITCH)
    if not inv:
        x, z = cy * x + sy * z, -sy * x + cy * z
        y, z = cp * y - sp * z, sp * y + cp * z
    else:
        y, z = cp * y + sp * z, -sp * y + cp * z
        x, z = cy * x - sy * z, sy * x + cy * z
    return np.stack([x, y, z], axis=-1)


# カメラ（平行投影）
HALF = 238.0
CEN = np.array([0.0, -8.0])
u = (np.arange(N) + 0.5) / N * 2 - 1
U, V = np.meshgrid(u * HALF + CEN[0], -u * HALF + CEN[1])
scr = np.stack([U.ravel(), V.ravel(), np.full(N * N, 600.0)], axis=-1)
ro = rot(scr, inv=True)
rd = rot(np.array([[0.0, 0.0, -1.0]]), inv=True)[0]

t = np.zeros(N * N)
hit = np.zeros(N * N, bool)
alive = np.arange(N * N)
for _ in range(140):
    p = ro[alive] + rd * t[alive, None]
    d = scene(p)
    t[alive] += d
    h = d < 0.05
    hit[alive[h]] = True
    alive = alive[(~h) & (t[alive] < 1300)]
    if not len(alive):
        break

idx = np.where(hit)[0]
P = ro[idx] + rd * t[idx, None]
_, MAT = scene(P, want_mat=True)
e = 0.4
nrm = np.stack([scene(P + np.array([e, 0, 0])) - scene(P - np.array([e, 0, 0])),
                scene(P + np.array([0, e, 0])) - scene(P - np.array([0, e, 0])),
                scene(P + np.array([0, 0, e])) - scene(P - np.array([0, 0, e]))], axis=-1)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)

# 色（体・棒・札）と、前の面の模様
base = np.where(MAT[:, None] == 0, BODY, np.where(MAT[:, None] == 1, STICK, BOARD))
px, py, pz = P[:, 0] + 256, 256 - P[:, 1], P[:, 2]

def seg_dist(x, y, a, b):
    ax, ay = a; bx, by = b
    vx, vy = bx - ax, by - ay
    tt = np.clip(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(x - ax - tt * vx, y - ay - tt * vy)

def poly_dist(x, y, pts):
    return np.min([seg_dist(x, y, pts[i], pts[i + 1]) for i in range(len(pts) - 1)], axis=0)

def soft(d, w):  # 模様のふちをなめらかに
    return np.clip((w - d) / 1.2 + 0.5, 0, 1)[:, None]

front_body = (MAT == 0) & (nrm[:, 2] > 0.55)
cheek = np.minimum(np.hypot((px - 166) / 17, (py - 356) / 9), np.hypot((px - 347) / 17, (py - 356) / 9))
a = soft((cheek - 1) * 10, 0) * front_body[:, None] * 0.9
base = base * (1 - a) + BLUSH * a
eye = np.minimum(poly_dist(px, py, [(162, 334), (183, 304), (204, 334)]), poly_dist(px, py, [(309, 334), (330, 304), (351, 334)]))
a = soft(eye, 7) * front_body[:, None]
base = base * (1 - a) + INK * a

front_board = (MAT == 2) & (nrm[:, 2] > 0.6)
ring = np.abs(np.hypot(px - 131, py - 125) - 38)
a = soft(ring, 7.5) * front_board[:, None]
base = base * (1 - a) + RED * a
cross = np.minimum(seg_dist(px, py, (349, 93), (413, 157)), seg_dist(px, py, (413, 93), (349, 157)))
a = soft(cross, 8) * front_board[:, None]
base = base * (1 - a) + BLUE * a

# 光：主光・補助光・まわりの光・つや・ふちの光・へこみの陰
def norm(v): v = np.array(v, float); return v / np.linalg.norm(v)
Lk = rot(norm([-0.45, 0.6, 0.75])[None], inv=True)[0]
Lf = rot(norm([0.7, 0.1, 0.5])[None], inv=True)[0]
VW = -rd
dif = np.clip(nrm @ Lk, 0, 1) * 0.62 + np.clip(nrm @ Lf, 0, 1) * 0.16
amb = 0.42 + 0.12 * nrm[:, 1] + np.where(MAT == 2, 0.14, 0)
Hh = (Lk + VW) / np.linalg.norm(Lk + VW)
gloss = np.where(MAT == 2, 0.12, 0.32)
spec = gloss * np.clip(nrm @ Hh, 0, 1) ** 36
rim = 0.10 * (1 - np.clip(nrm @ VW, 0, 1)) ** 3
ao = np.ones(len(P))
for i, s in enumerate((4, 10, 20, 34)):
    ao -= np.clip(s - scene(P + nrm * s), 0, None) / s * (0.5 ** i) * 0.55
ao = np.clip(ao, 0.45, 1)
col = base * ((dif + amb) * ao)[:, None] + (spec + rim)[:, None]
col = np.clip(col, 0, 1)

img = np.tile(BG, (N * N, 1))
# 足もとの影（床にやわらかく）
gx, gy = U.ravel(), V.ravel()
shadow_c = rot(W(256, 470, 0)[None])[0]
sd = np.hypot((gx - shadow_c[0]) / 170, (gy - shadow_c[1]) / 30)
img = img * (1 - 0.16 * np.clip(1.15 - sd, 0, 1)[:, None])
img[idx] = col
im = Image.fromarray((img.reshape(N, N, 3) * 255).astype(np.uint8))
for n in (180, 512):
    im.resize((n, n), Image.LANCZOS).save(f'icon-{n}.png')
print('icon-180.png icon-512.png')
