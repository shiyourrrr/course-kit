"""生成二次函数三张示意图

用法： python tools/figures/parabolas.py
输出： examples/images/parabola-points.png / parabola-family.png / parabola-trend.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[2] / "examples" / "images"

INK = "#111827"
MUTED = "#6b7280"
GRID = "#e5e7eb"
ACCENT = "#1d4ed8"
RUST = "#c2410c"
GREEN = "#15803d"

W, H = 1000, 760
OX, OY = 500, 650          # 原点
UX, UY = 62, 34            # 每单位像素（y 方向压扁，9 个单位也放得下）


def px(x, y):
    return (OX + x * UX, OY - y * UY)


def font(size, bold=False):
    name = "msyhbd.ttc" if bold else "msyh.ttc"
    return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)


def base(title=None):
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    for i in range(-6, 7):
        x, _ = px(i, 0)
        d.line([(x, OY - 11 * UY), (x, OY + 2 * UY)], fill=GRID, width=1)
    for j in range(0, 11):
        _, y = px(0, j)
        d.line([(OX - 6 * UX, y), (OX + 6 * UX, y)], fill=GRID, width=1)
    d.line([(OX - 6 * UX - 24, OY), (OX + 6 * UX + 34, OY)], fill=INK, width=2)
    d.line([(OX, OY + 46), (OX, OY - 11 * UY - 34)], fill=INK, width=2)
    d.polygon([(OX + 6 * UX + 44, OY), (OX + 6 * UX + 30, OY - 6), (OX + 6 * UX + 30, OY + 6)], fill=INK)
    d.polygon([(OX, OY - 11 * UY - 46), (OX - 6, OY - 11 * UY - 32), (OX + 6, OY - 11 * UY - 32)], fill=INK)
    d.text((OX + 6 * UX + 50, OY + 8), "x", font=font(24), fill=INK)
    d.text((OX + 12, OY - 11 * UY - 66), "y", font=font(24), fill=INK)
    d.text((OX - 28, OY + 12), "O", font=font(22), fill=MUTED)
    for i in [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]:
        x, _ = px(i, 0)
        d.line([(x, OY - 5), (x, OY + 5)], fill=INK, width=2)
        d.text((x, OY + 14), str(i), font=font(17), fill=MUTED, anchor="ma")
    for j in [2, 4, 6, 8, 10]:
        _, y = px(0, j)
        d.line([(OX - 5, y), (OX + 5, y)], fill=INK, width=2)
        d.text((OX - 12, y), str(j), font=font(17), fill=MUTED, anchor="rm")
    if title:
        d.text((40, 30), title, font=font(30, bold=True), fill=INK)
    return img, d


def curve(d, a, xr=(-5.1, 5.1), color=ACCENT, width=4):
    pts = []
    x = xr[0]
    while x <= xr[1]:
        pts.append(px(x, a * x * x))
        x += 0.03
    d.line(pts, fill=color, width=width)


# ---------- 图 1：y=x² 的五个描点 ----------
img, d = base()
curve(d, 1)
for x in (-3, -2, -1, 0, 1, 2, 3):
    cy = x * x
    if cy > 10:
        continue
    cx, cyy = px(x, cy)
    d.ellipse([cx - 7, cyy - 7, cx + 7, cyy + 7], fill="#ffffff", outline=ACCENT, width=3)
    label = f"({x}, {cy})"
    if x == 0:
        d.text((cx + 16, cyy + 10), label, font=font(20), fill=ACCENT, anchor="lm")
    elif x < 0:
        d.text((cx - 12, cyy - 12), label, font=font(20), fill=ACCENT, anchor="rm")
    else:
        d.text((cx + 12, cyy - 12), label, font=font(20), fill=ACCENT, anchor="lm")
img.save(OUT / "parabola-points.png")

# ---------- 图 2：四条曲线对比 ----------
img, d = base()
curve(d, 2, color=ACCENT)
curve(d, 1, color=MUTED, width=3)
curve(d, 0.35, color=GREEN)
curve(d, -1, color=RUST)
labels = [
    ("y = 2x²", ACCENT, 3.4, 6.5, "lm"),
    ("y = x²", MUTED, 2.4, 5.2, "lm"),
    ("y = 0.35x²", GREEN, -3.6, 4.2, "rm"),
    ("y = -x²", RUST, -4.2, -2.6, "rm"),
]
for text, color, lx, ly, anchor in labels:
    x, y = px(lx, ly)
    d.text((x, y), text, font=font(24, bold=True), fill=color, anchor=anchor)
img.save(OUT / "parabola-family.png")

# ---------- 图 3：增减趋势 ----------
img, d = base()
curve(d, 1)


def arrow(d, p1, p2, color, w=6):
    d.line([p1, p2], fill=color, width=w)
    import math
    ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    size = 18
    d.polygon(
        [
            p2,
            (p2[0] - size * math.cos(ang - 0.4), p2[1] - size * math.sin(ang - 0.4)),
            (p2[0] - size * math.cos(ang + 0.4), p2[1] - size * math.sin(ang + 0.4)),
        ],
        fill=color,
    )


arrow(d, px(-4.6, 8.2), px(-2.2, 4.6), RUST)
arrow(d, px(2.2, 4.6), px(4.6, 8.2), GREEN)
d.text(px(-4.8, 9.0), "x 增大，y 减小", font=font(23, bold=True), fill=RUST)
d.text(px(2.0, 9.0), "x 增大，y 增大", font=font(23, bold=True), fill=GREEN)
cx, cy = px(0, 0)
d.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=ACCENT)
d.text((cx + 16, cy + 8), "最低点 (0, 0)", font=font(22), fill=ACCENT)
img.save(OUT / "parabola-trend.png")

for name in ("parabola-points.png", "parabola-family.png", "parabola-trend.png"):
    print(name, (OUT / name).stat().st_size // 1024, "KB")
