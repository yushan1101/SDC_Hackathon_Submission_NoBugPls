"""Generate the 3D interviewer's face texture (web/img/interviewer-face.jpg) with GPT Image on the app's gateway.

    python scripts/generate_interviewer_face.py   # LLM_BASE_URL / LLM_API_KEY from the repo .env (or ENV_FILE=path)

The face is projected from the front onto the interviewer's head (web/js/virtual-office.js): if a new image puts the
eyes, mouth or hair elsewhere than ~(336|686, 426), ~(514, 794) and ~(200, 120) on the 1024 square, adjust the
UV constants and colour picks there.
"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

env = {}
for line in Path(os.environ.get("ENV_FILE") or Path(__file__).resolve().parents[2] / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
base, key = env.get("LLM_BASE_URL", "").rstrip("/"), env.get("LLM_API_KEY", "")
if not base or not key:
    sys.exit("LLM_BASE_URL / LLM_API_KEY missing")
base += "/v1" if base.count("/") == 2 else ""  # a bare host gets the standard /v1, as agents/llm.py does

PROMPT = (
    "Photorealistic face texture for mapping onto a 3D head, shot like a passport photo: one friendly professional "
    "HR interviewer in their mid-30s, perfectly frontal and symmetric, looking straight into the camera, relaxed "
    "closed-mouth gentle smile, eyes open. Dark hair pulled neatly back into a low bun so the whole forehead, both "
    "temples and both ears are clearly visible; no strands over the face. Cropped tightly so the head fills the whole "
    "square edge to edge: the hairline touches the top edge, the chin touches the bottom edge, the ears touch the left "
    "and right edges; no background, no neck, no glasses, no earrings or jewellery. Soft, even, shadowless studio "
    "lighting, natural skin texture with pores, sharp focus, no text."
)


def fill_background(im):
    """Any light, grey-white background touching the border becomes neck skin: the head's sides sample the photo's
    edges, so they must read as skin or hair, never studio white."""
    from PIL import Image, ImageDraw, ImageFilter
    w, h = im.size
    px = im.load()
    mask = Image.new("L", im.size, 0)
    m = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if min(r, g, b) > 205 and max(r, g, b) - min(r, g, b) < 24:
                m[x, y] = 255
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (0, h // 2), (w - 1, h // 2), (w // 2, h - 1)]:
        if m[corner] == 255:
            ImageDraw.floodfill(mask, corner, 128)
    background = mask.point(lambda v: 255 if v == 128 else 0).filter(ImageFilter.GaussianBlur(3))
    skin = im.crop((int(w * 0.44), int(h * 0.86), int(w * 0.56), int(h * 0.95))).resize((1, 1), Image.BOX).getpixel((0, 0))
    return Image.composite(Image.new("RGB", im.size, skin), im, background)


out = Path(__file__).resolve().parents[1] / "web" / "img" / "interviewer-face.jpg"
for model in ["gpt-image-2", "gpt-image-1"]:
    body = json.dumps({"model": model, "prompt": PROMPT, "size": "1024x1024", "n": 1}).encode()
    req = urllib.request.Request(f"{base}/images/generations", body,
                                 {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "aiversepulse-asset-script/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            data = json.load(r)["data"][0]
    except Exception as e:  # try the next model id; never print the key
        print(model, "failed:", str(e)[:200])
        continue
    raw = base64.b64decode(data["b64_json"]) if data.get("b64_json") else urllib.request.urlopen(data["url"], timeout=120).read()
    from io import BytesIO
    from PIL import Image  # 512px JPEG keeps the page light (~50 KB)
    fill_background(Image.open(BytesIO(raw)).convert("RGB").resize((512, 512), Image.LANCZOS)).save(
        out, quality=86, optimize=True, progressive=True)
    print(model, "->", out, out.stat().st_size)
    break
