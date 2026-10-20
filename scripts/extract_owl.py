"""Cut the JobSmart owl state sheet into transparent PNG sprites for the web UI.

    python scripts/extract_owl.py
Source: ui/stitch_animated_status_icon_system/image.png/screen.png (12 labelled tiles + hero owl).
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path("ui/stitch_animated_status_icon_system/image.png/screen.png")
OUT = Path("web/owl")
STATES = [["idle", "greeting", "listening", "thinking", "searching", "analyzing"],
          ["matched", "update", "reminder", "confused", "celebrating", "sleeping"]]
ROWS = [(530, 752), (802, 1022)]  # tile top .. just above the text label
COLS = [(12, 247), (255, 481), (490, 716), (723, 945), (953, 1191), (1198, 1436)]
HERO = (240, 0, 830, 515)


def knock_out(rgb: np.ndarray, tol: int = 14) -> np.ndarray:
    """Flood-fill from the border over near-background pixels -> alpha 0; soft 1px edge."""
    h, w, _ = rgb.shape
    bg = np.median(np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]), axis=0)
    near = np.abs(rgb.astype(int) - bg).max(2) <= tol
    seen = np.zeros((h, w), bool)
    q = deque([(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)])
    while q:
        y, x = q.popleft()
        if 0 <= y < h and 0 <= x < w and not seen[y, x] and near[y, x]:
            seen[y, x] = True
            q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    alpha = np.where(seen, 0, 255).astype(np.uint8)
    edge = (~seen) & (np.roll(seen, 1, 0) | np.roll(seen, -1, 0) | np.roll(seen, 1, 1) | np.roll(seen, -1, 1))
    alpha[edge] = 160
    c = 16  # rounded tile corners leave specks: clear them
    for ys, xs in ((slice(0, c), slice(0, c)), (slice(0, c), slice(w - c, w)),
                   (slice(h - c, h), slice(0, c)), (slice(h - c, h), slice(w - c, w))):
        alpha[ys, xs] = 0
    return np.dstack([rgb, alpha])


def save(rgba: np.ndarray, name: str, size: int = 256):
    img = Image.fromarray(rgba, "RGBA")
    img = img.crop(img.getbbox())
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, size - img.height))  # feet on the baseline
    canvas.save(OUT / f"{name}.webp", quality=88, method=6)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = np.asarray(Image.open(SRC).convert("RGB"))
    for r, (y0, y1) in enumerate(ROWS):
        for c, (x0, x1) in enumerate(COLS):
            save(knock_out(sheet[y0:y1, x0 + 6:x1 - 6]), STATES[r][c])
    x0, y0, x1, y1 = HERO
    save(knock_out(sheet[y0:y1, x0:x1], tol=10), "hero", 512)
    print("wrote", sorted(p.name for p in OUT.glob("*.webp")))


if __name__ == "__main__":
    main()
