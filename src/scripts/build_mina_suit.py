"""Mina's suit texture (web/models/mina/suit.jpg), rebuilt on her casual outfit's own UV layout.

    python scripts/build_mina_suit.py T_MINA_CASUAL_BaseColor_White.png   # the 4096 px source from LKZ1999/human

The source is glossy latex: pink panels with black trim and baked highlights. Here the panels become a neutral grey
wool twill that keeps only the soft fold shading, the trims a darker wool (so seams and edges stay where the UVs put
them), and the jewellery (pearls, gold) keeps its original pixels. js/mina.js tints the grey per garment: navy jacket,
ivory top, charcoal skirt.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SIZE = 1024
src = Image.open(sys.argv[1]).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
rgb = np.asarray(src, dtype=np.float32) / 255
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
lum = 0.299 * r + 0.587 * g + 0.114 * b

panel = (r - g > 0.12) & (r > 0.45)                      # the pink latex panels
# the jewellery islands (necklace and bracelet, by their UVs): pearls and gold keep their original pixels
v, u = np.mgrid[0:SIZE, 0:SIZE] / SIZE
jewel = ((u > 0.82) & (v < 0.47)) | ((u < 0.3) & (v > 0.17) & (v < 0.33))
keep = jewel & ~panel & (lum > 0.3)
trim = ~panel & ~keep                                    # black latex trim, edges and their highlights: dark cloth
# trim narrower than ~7 px (dust, pinholes, hairline seams in the source) reads as stains on cloth: it becomes panel
solid = np.asarray(Image.fromarray((trim * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(9))) > 0
panel |= trim & ~solid
trim = ~panel & ~keep

# folds without the latex shine: a heavy blur of the brightness, squeezed into a narrow band
folds = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18)), dtype=np.float32) / 255
folds = 0.88 + 0.24 * (folds - folds.mean()) / (folds.std() + 1e-6) * 0.25

# wool twill: fine diagonal ribs plus a little fibre noise
y, x = np.mgrid[0:SIZE, 0:SIZE]
twill = 0.5 + 0.5 * np.sin((x + y) * (2 * np.pi / 5.0))
rng = np.random.default_rng(7)
fibre = np.asarray(Image.fromarray((rng.random((SIZE, SIZE)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)),
                   dtype=np.float32) / 255
weave = 0.93 + 0.05 * twill + 0.04 * (fibre - 0.5)

out = rgb.copy()
grey = np.clip(0.78 * folds * weave, 0, 1)               # panels: light neutral grey, tinted per garment in js
dark = np.clip(0.36 * folds * weave, 0, 1)               # trims: the same cloth, a few shades darker
for c in range(3):
    out[..., c] = np.where(panel, grey, np.where(trim, dark, rgb[..., c]))

# soften the seams between the masks so edges don't alias
mask = Image.fromarray(((panel | trim) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
m = np.asarray(mask, dtype=np.float32)[..., None] / 255
out = out * m + rgb * (1 - m) * keep[..., None] + out * (1 - m) * ~keep[..., None]

dest = Path(__file__).resolve().parents[1] / "web" / "models" / "mina" / "suit.jpg"
Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(dest, quality=88, optimize=True, progressive=True)
print(dest, dest.stat().st_size)
