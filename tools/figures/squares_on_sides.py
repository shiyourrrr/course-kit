"""生成「三边上的正方形」示意图（勾股定理的几何意义）

用法： python tools/figures/squares_on_sides.py
输出： examples/images/squares-on-sides.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 52          # 1 个单位 = 52px（a=3, b=4, c=5）
M = 70          # 边距
A_LEG, B_LEG = 3, 4
C_HYP = 5

# 单位坐标系：C 在原点，y 轴向下；A 在 x 正方向，B 在 y 负方向（上方）
C = (0, 0)
A = (B_LEG, 0)
B = (0, -A_LEG)

# 外法线方向（斜边上的正方形朝外）
nx, ny = A_LEG / C_HYP, -B_LEG / C_HYP
AB_square = [A, B, (B[0] + nx * C_HYP, B[1] + ny * C_HYP), (A[0] + nx * C_HYP, A[1] + ny * C_HYP)]
CA_square = [C, A, (A[0], A[1] + B_LEG), (C[0], C[1] + B_LEG)]
CB_square = [C, B, (B[0] - A_LEG, B[1]), (C[0] - A_LEG, C[1] | 0)]

points = CA_square + CB_square + AB_square + [A, B]
min_x = min(p[0] for p in points)
max_x = max(p[0] for p in points)
min_y = min(p[1] for p in points)
max_y = max(p[1] for p in points)

W = int((max_x - min_x) * S + 2 * M)
H = int((max_y - min_y) * S + 2 * M)
origin = (M - min_x * S, M - min_y * S)


def px(p):
    return (origin[0] + p[0] * S, origin[1] + p[1] * S)


img = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(img)

FILL = "#e8eefc"
FILL_C = "#dbe4fb"
STROKE = "#111827"
ACCENT = "#1d4ed8"

font_path = Path("C:/Windows/Fonts/msyhbd.ttc")
if not font_path.exists():
    font_path = Path("C:/Windows/Fonts/msyh.ttc")
font = ImageFont.truetype(str(font_path), 34)
font_small = ImageFont.truetype(str(font_path), 26)
font_side = ImageFont.truetype(str(font_path), 30)

d.polygon([px(p) for p in CA_square], fill=FILL, outline=STROKE, width=3)
d.polygon([px(p) for p in CB_square], fill=FILL, outline=STROKE, width=3)
d.polygon([px(p) for p in AB_square], fill=FILL_C, outline=STROKE, width=3)
d.polygon([px(C), px(A), px(B)], fill="#ffffff", outline=ACCENT, width=4)

# 直角标记
rc = px(C)
d.line([(rc[0] + 20, rc[1]), (rc[0] + 20, rc[1] - 20), (rc[0], rc[1] - 20)], fill="#6b7280", width=2)


def label(text, p, f=font, fill=ACCENT):
    x, y = px(p)
    d.text((x, y), text, font=f, fill=fill, anchor="mm")


label("a²", (-1.5, -1.5), font, ACCENT)
label("b²", (2, 2), font, ACCENT)
label("c²", (3.5, -3.5), font, ACCENT)

# 边长标注
label("a", (-0.28, -1.5), font_side, STROKE)
label("b", (2, -0.28), font_side, STROKE)
mx, my = (A[0] + B[0]) / 2 + nx * 1.2, (A[1] + B[1]) / 2 + ny * 1.2
label("c", (mx, my), font_side, STROKE)

out = Path(__file__).resolve().parents[2] / "examples" / "images" / "squares-on-sides.png"
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out)
print("saved:", out)
print("size:", W, "x", H)
