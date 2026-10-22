"""Slider check for sign-up: drag the piece into the gap. Server-side and single-use, so it cannot be skipped.

The server draws the track (random background, a gap at a random x) and the matching piece as PNGs; the gap's position
exists only in the pixels, never as a number sent to the browser. Solving it means: final x within TOLERANCE of the
gap, and a drag that looks like a person (enough points, a human duration, uneven speed). A solved challenge gives a
short-lived pass that /api/register requires and consumes. This raises the bar for scripts; the Sift-style risk score
still runs on every sign-up as the second layer.
"""
import base64
import hashlib
import io
import random
import secrets
import statistics
from datetime import datetime, timedelta, timezone

from governance.audit import now

W, H, P = 320, 160, 44           # track width/height, piece size (px)
TOLERANCE = 6                    # px
TTL, PASS_TTL, MAX_TRIES = timedelta(minutes=2), timedelta(minutes=10), 3
SCHEMA = """
CREATE TABLE IF NOT EXISTS slider_challenges(id TEXT PRIMARY KEY, target_x INTEGER, piece_y INTEGER, created_utc TEXT,
    tries INTEGER DEFAULT 0, solved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS slider_passes(token_hash TEXT PRIMARY KEY, device_id TEXT, expires_utc TEXT, used INTEGER DEFAULT 0);
"""


class ChallengeError(ValueError):
    pass


def init(con):
    con.executescript(SCHEMA)
    return con


def _png(img) -> str:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _draw(target_x: int, piece_y: int, seed: int):
    from PIL import Image, ImageDraw, ImageFilter
    rnd = random.Random(seed)
    bg = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(bg)
    hue = rnd.randint(0, 2)
    for y in range(H):  # soft gradient, different every time
        c = [200 + rnd.randint(-6, 6) - y // 4] * 3
        c[hue] = min(255, c[hue] + 40)
        d.line([(0, y), (W, y)], fill=tuple(c))
    for _ in range(26):  # noise shapes so the gap is not the only edge in the picture
        x, y, r = rnd.randint(-20, W), rnd.randint(-20, H), rnd.randint(8, 34)
        col = tuple(rnd.randint(60, 230) for _ in range(3))
        (d.ellipse if rnd.random() < 0.5 else d.rectangle)([x, y, x + r, y + r], fill=col)
    bg = bg.filter(ImageFilter.GaussianBlur(1.2))
    box = (target_x, piece_y, target_x + P, piece_y + P)
    piece = bg.crop(box)
    mask = Image.new("L", (P, P), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, P - 1, P - 1], radius=9, fill=255)
    out = Image.new("RGBA", (P, P))
    out.paste(piece, (0, 0), mask)
    ImageDraw.Draw(out).rounded_rectangle([0, 0, P - 1, P - 1], radius=9, outline=(255, 255, 255, 230), width=2)
    hole = Image.new("RGBA", (P, P), (20, 24, 40, 150))
    track = bg.convert("RGBA")
    track.paste(hole, box[:2], mask)
    ImageDraw.Draw(track).rounded_rectangle(box, radius=9, outline=(255, 255, 255, 170), width=2)
    return track, out


def issue(con) -> dict:
    init(con)
    cid = secrets.token_urlsafe(12)
    target_x, piece_y = random.SystemRandom().randint(110, W - P - 8), random.SystemRandom().randint(12, H - P - 12)
    track, piece = _draw(target_x, piece_y, secrets.randbits(32))
    with con:
        con.execute("INSERT INTO slider_challenges(id,target_x,piece_y,created_utc) VALUES(?,?,?,?)", (cid, target_x, piece_y, now()))
    return {"id": cid, "track": _png(track), "piece": _png(piece), "piece_y": piece_y, "width": W, "height": H, "piece_size": P}


def _human(trail: list, keyboard: bool) -> bool:
    """Enough points over a human duration; a mouse/finger drag also has uneven speed (scripts move at a constant rate)."""
    pts = [p for p in trail if isinstance(p, (list, tuple)) and len(p) >= 2 and all(isinstance(v, (int, float)) for v in p[:2])]
    if len(pts) < 8:
        return False
    dur = pts[-1][0] - pts[0][0]
    if not 300 <= dur <= 60000:
        return False
    if keyboard:  # arrow keys: regular steps are fine, but it has to take a moment
        return dur >= 800
    speeds = [(b[1] - a[1]) / max(1, b[0] - a[0]) for a, b in zip(pts, pts[1:])]
    return len(speeds) >= 6 and statistics.pstdev(speeds) > 0.02


def verify(con, cid: str, x: float, trail: list, device_id: str = "", keyboard: bool = False) -> str:
    """-> a single-use pass for /api/register. Raises ChallengeError (try again / get a new one)."""
    init(con)
    row = con.execute("SELECT target_x, created_utc, tries, solved FROM slider_challenges WHERE id=?", (cid,)).fetchone()
    if not row or row[3] or row[2] >= MAX_TRIES or datetime.fromisoformat(row[1]) + TTL < datetime.now(timezone.utc):
        raise ChallengeError("expired")
    ok = abs(float(x) - row[0]) <= TOLERANCE and _human(trail or [], keyboard)
    with con:
        con.execute("UPDATE slider_challenges SET tries=tries+1, solved=? WHERE id=?", (int(ok), cid))
    if not ok:
        raise ChallengeError("retry" if row[2] + 1 < MAX_TRIES else "expired")
    token = secrets.token_urlsafe(24)
    with con:
        con.execute("INSERT INTO slider_passes VALUES(?,?,?,0)", (hashlib.sha256(token.encode()).hexdigest(), device_id[:64],
                                                                (datetime.now(timezone.utc) + PASS_TTL).isoformat()))
    return token


def consume(con, token: str | None, device_id: str = "") -> bool:
    """Use up a pass (once, before it expires, from the device that solved it)."""
    init(con)
    if not token:
        return False
    h = hashlib.sha256(token.encode()).hexdigest()
    row = con.execute("SELECT device_id, expires_utc, used FROM slider_passes WHERE token_hash=?", (h,)).fetchone()
    if not row or row[2] or datetime.fromisoformat(row[1]) < datetime.now(timezone.utc) or (row[0] and row[0] != device_id[:64]):
        return False
    with con:
        con.execute("UPDATE slider_passes SET used=1 WHERE token_hash=?", (h,))
    return True


def solve_for_tests(con, cid: str, device_id: str = "") -> str:
    """Test helper: a correct, human-looking drag for challenge cid."""
    target = con.execute("SELECT target_x FROM slider_challenges WHERE id=?", (cid,)).fetchone()[0]
    xs = [target * f for f in (0, .05, .15, .32, .5, .66, .8, .9, .96, .99, 1)]
    trail = [[i * 60 + (i % 3) * 17, x] for i, x in enumerate(xs)]
    return verify(con, cid, target, trail, device_id)
