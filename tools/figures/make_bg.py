"""生成一张"暖色桌面"风格的背景图（示意用，不是照片）

用法： python tools/figures/make_bg.py
输出： examples/images/desk-warm.jpg
"""
from pathlib import Path

import numpy as np
from PIL import Image

W, H = 1600, 900

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nx = xx / (W - 1)
ny = yy / (H - 1)

# 基础渐变：上方暖褐，下方近黑
top = np.array([58, 34, 22], dtype=np.float32)
bottom = np.array([22, 15, 13], dtype=np.float32)
base = top[None, None, :] * (1 - ny[..., None]) + bottom[None, None, :] * ny[..., None]

# 右上角一束柔光
cx, cy, sx, sy = 0.80, 0.16, 0.42, 0.30
beam = np.exp(-(((nx - cx) / sx) ** 2 + ((ny - cy) / sy) ** 2))
beam = beam ** 1.6
warm = np.array([198, 132, 74], dtype=np.float32)
base += beam[..., None] * warm[None, None, :] * 0.55

# 暗角
d = np.sqrt(((nx - 0.5) / 0.72) ** 2 + ((ny - 0.5) / 0.78) ** 2)
vignette = np.clip(1 - 0.85 * np.clip(d, 0, 1) ** 2.1, 0.12, 1)
base *= vignette[..., None]

# 极细颗粒
rng = np.random.default_rng(7)
base += rng.normal(0, 3.2, size=base.shape)

img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")
out = Path(__file__).resolve().parents[2] / "examples" / "images" / "desk-warm.jpg"
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out, "JPEG", quality=82, optimize=True)
print("saved:", out, "size:", out.stat().st_size // 1024, "KB")
