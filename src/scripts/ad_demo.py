"""Record a commercial-style AiversePulse demo with Cap (cap.so): HR, employee and admin, one act each.

The browser runs full screen (kiosk) and the script moves the real mouse, so Cap sees every move and click and its
editor can auto-zoom on them (record in Studio mode, then Editor -> Zoom -> Auto). Captions and title cards are drawn
into the page by this script only; the app itself is unchanged.

Accounts are never typed in: each role has its own browser profile, and you sign in to each once.

    python src/scripts/ad_demo.py --setup              # sign in once: admin, HR, employee (three windows)
    python src/scripts/ad_demo.py --check              # rehearse every beat, no recording
    python src/scripts/ad_demo.py --record             # Cap records each act (one Studio clip per act)
    python src/scripts/ad_demo.py --record --acts hr   # just one act (hr, employee, admin)

Windows only (the real mouse uses user32 SendInput). Needs `pip install playwright` and Cap installed.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import json
import math
import os
import time
import urllib.parse
from pathlib import Path

BASE = "https://sdc.olgtx.com"
PROFILES = Path.home() / ".aiversepulse-demo" / "profiles"
ROLES = {"admin": ("admin.html", "admin"), "hr": ("enterprise.html", "hr_advisor"), "employee": ("index.html", "employee")}
TITLE = "AiversePulse Demo"  # constant window title, so Cap can find the window to record
PACE = 1.0                   # --pace 0.6 for a faster cut

# ---------------------------------------------------------------- the real mouse (Cap records the OS cursor)
user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # physical pixels, matching the screen Cap records
except OSError:
    pass


class _MI(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD), ("dwFlags", wt.DWORD), ("time", wt.DWORD),
                ("dwExtraInfo", ctypes.POINTER(wt.ULONG))]


class _IN(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("mi", _MI)]


def _send(flags: int, data: int = 0) -> None:
    i = _IN(0, _MI(0, 0, data, flags, 0, None))
    user32.SendInput(1, ctypes.byref(i), ctypes.sizeof(i))


def glide(x: float, y: float, secs: float = 0.7) -> None:
    """Ease the cursor to (x, y): an ad's slow, confident move, not a teleport."""
    p = wt.POINT()
    user32.GetCursorPos(ctypes.byref(p))
    steps = max(12, int(secs * 90))
    for i in range(1, steps + 1):
        t = i / steps
        e = 0.5 - math.cos(math.pi * t) / 2  # ease in-out
        user32.SetCursorPos(int(p.x + (x - p.x) * e), int(p.y + (y - p.y) * e))
        time.sleep(secs / steps)


def press() -> None:
    _send(0x0002); time.sleep(0.06); _send(0x0004)  # left down, up


def wheel(clicks: int) -> None:
    for _ in range(abs(clicks)):
        _send(0x0800, (-120 if clicks > 0 else 120) & 0xFFFFFFFF); time.sleep(0.05)


# ---------------------------------------------------------------- the page: where things are on screen, captions
OVERLAY = """
(() => {
  const keep = () => { if (document.title !== %s) document.title = %s; };
  keep(); setInterval(keep, 300);
  if (window.__ad) return;
  const css = document.createElement('style');
  css.textContent = `
    #ad-cap{position:fixed;left:50%%;bottom:42px;transform:translate(-50%%,12px);z-index:2147483647;max-width:min(880px,86vw);
      padding:16px 26px;border-radius:999px;background:rgba(18,22,40,.86);color:#fff;font:600 24px/1.35 system-ui,sans-serif;
      text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.28);opacity:0;transition:opacity .45s,transform .45s;pointer-events:none}
    #ad-cap.on{opacity:1;transform:translate(-50%%,0)}
    #ad-card{position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;gap:18px;text-align:center;
      background:radial-gradient(1200px 700px at 50%% 40%%,#3d5cff,#141a3a);color:#fff;opacity:0;transition:opacity .6s;pointer-events:none}
    #ad-card.on{opacity:1}
    #ad-card b{font:700 64px/1.1 system-ui,sans-serif;letter-spacing:-.02em}
    #ad-card span{font:500 26px/1.4 system-ui,sans-serif;opacity:.85}`;
  document.documentElement.append(css);
  const cap = Object.assign(document.createElement('div'), { id: 'ad-cap' });
  const card = Object.assign(document.createElement('div'), { id: 'ad-card' });
  card.append(document.createElement('b'), document.createElement('span'));
  document.documentElement.append(cap, card);
  window.__ad = {
    say(t) { cap.textContent = t; cap.classList.toggle('on', !!t); },
    card(a, b) { card.children[0].textContent = a || ''; card.children[1].textContent = b || ''; card.classList.toggle('on', !!a); },
  };
})();
""" % (json.dumps(TITLE), json.dumps(TITLE))


class Act:
    def __init__(self, page):
        self.page = page

    def wait(self, secs: float) -> None:
        time.sleep(secs * PACE)

    def ad(self) -> None:
        self.page.evaluate(OVERLAY)

    def say(self, text: str, hold: float = 2.6) -> None:
        self.ad(); self.page.evaluate("t => window.__ad.say(t)", text); self.wait(hold)

    def card(self, title: str, sub: str = "", hold: float = 2.8) -> None:
        self.ad(); self.page.evaluate("([a, b]) => window.__ad.card(a, b)", [title, sub]); self.wait(hold)
        self.page.evaluate("() => window.__ad.card('')"); self.wait(0.7)

    def go(self, path: str) -> None:
        self.page.goto(f"{BASE}/{path}", wait_until="domcontentloaded"); self.ad(); self.wait(1.4)

    def _screen_point(self, loc) -> tuple[float, float]:
        loc.scroll_into_view_if_needed(timeout=8000)
        box = loc.bounding_box()
        if not box:
            raise RuntimeError("not on screen")
        ox, oy, dpr = self.page.evaluate("() => [window.screenX + (outerWidth - innerWidth) / 2, "
                                         "window.screenY + outerHeight - innerHeight - (outerWidth - innerWidth) / 2, devicePixelRatio]")
        return (ox + box["x"] + box["width"] / 2) * dpr, (oy + box["y"] + box["height"] / 2) * dpr

    def click(self, target, secs: float = 0.75, after: float = 1.1) -> None:
        """Glide the real cursor to the element and click it there (a selector or a Playwright locator)."""
        loc = self.page.locator(target).first if isinstance(target, str) else target.first
        loc.wait_for(state="visible", timeout=20000)
        glide(*self._screen_point(loc), secs=secs)
        self.wait(0.15); press(); self.wait(after)

    def hover(self, target, secs: float = 0.8, after: float = 0.9) -> None:
        loc = self.page.locator(target).first if isinstance(target, str) else target.first
        loc.wait_for(state="visible", timeout=20000)
        glide(*self._screen_point(loc), secs=secs); self.wait(after)

    def type(self, text: str) -> None:
        self.page.keyboard.type(text, delay=45); self.wait(0.5)

    def scroll(self, clicks: int, after: float = 1.0) -> None:
        wheel(clicks); self.wait(after)

    def beat(self, name: str, fn) -> None:
        """One shot of the ad. A shot that can't run (missing data, changed page) is skipped, not fatal."""
        try:
            fn()
            print(f"  ok    {name}")
        except Exception as e:  # keep the take going
            print(f"  skip  {name}: {type(e).__name__}: {str(e).splitlines()[0][:120]}")
            try:
                self.say("")
            except Exception:
                pass


# ---------------------------------------------------------------- the three acts
def act_hr(a: Act) -> None:
    p = a.page
    a.go("enterprise.html#/overview")
    a.card("Reskill your team for the AI era", "AiversePulse · for HR")
    a.beat("overview", lambda: (a.say("Your whole team at a glance: who needs a plan, who's ready."), a.hover(".stat", after=1.2)))

    def analyse():
        a.say("Upload a team file. Eight AI agents analyse every employee.")
        a.click(p.get_by_role("button", name="Team"), after=0.6) if not p.locator('a[href="#/run"]').is_visible() else None
        a.click('a[href="#/run"]')
        a.click(p.get_by_role("button", name="Use sample CSV"))
        a.click(p.get_by_role("button", name="Run analysis"), after=2)
        a.say("Every skill gap, every step and every source, checked before HR sees it.", hold=1)
        p.get_by_role("link", name="Open review queue").wait_for(timeout=300_000)
        a.click(p.get_by_role("link", name="Open review queue"), after=1.6)
    a.beat("analyse team", analyse)

    def review():
        a.say("One queue. Search, filter, open any plan.")
        a.click(".queue-item", after=1.8)
        a.say("Each plan is personal: their strengths, their pace, concrete weekly steps.")
        a.scroll(4, after=1.4)
        a.click('.phase summary', after=1.4)
        for tab in ("Analysis", "Evidence", "History"):
            a.click(f'.rv-tabs [data-tab="{tab.lower()}"]', after=1.3)
        a.say("Every claim links to its source.", hold=2)
        p.keyboard.press("Escape"); a.wait(1)
    a.beat("review a plan", review)

    def agent():
        a.say("Ask the agent in plain words, even to post a job.")
        a.click('a[href="#/agents"]', after=1.2)
        a.click("textarea.ag-input", after=0.4)
        a.type("Send the newest opening to our Telegram channel")
        p.keyboard.press("Enter")
        p.locator(".ag-msg.them").last.wait_for(timeout=60000); a.wait(2.2)
        a.say("Nothing goes out until you confirm.", hold=2.2)
        if p.locator(".ag-action button.ghost").count():
            a.click(".ag-action button.ghost", after=1.4)  # Cancel: the ad never posts for real
    a.beat("agent posts a job", agent)

    def team():
        a.say("See how each employee is progressing on their own plan.")
        if not p.locator('a[href="#/people"]').is_visible():
            a.click(p.get_by_role("button", name="Team"), after=0.6)
        a.click('a[href="#/people"]', after=1.4)
        if p.locator(".own-plan-chip").count():
            a.click(".own-plan-chip", after=2.4)
            a.scroll(3, after=1.6)
            p.keyboard.press("Escape"); a.wait(0.8)
    a.beat("team progress", team)

    def trends():
        a.say("And what's moving in AI today, for every role.")
        a.click('a[href="#/signals"]', after=2.4)
        a.scroll(3, after=1.8)
    a.beat("ai trends", trends)
    a.say("")


def act_employee(a: Act) -> None:
    p = a.page
    a.go("index.html#/start")
    a.card("Your next career move, planned", "AiversePulse · for employees")

    def answer_quiz(quick: bool = False):
        if p.get_by_role("button", name="Skip, search everything").count():
            a.click(p.get_by_role("button", name="Skip, search everything"), after=0.8)
        for i in range(13):
            a.click(p.locator(".opts button").nth(i % 4), secs=0.2 if quick else 0.35, after=0.25 if quick else 0.45)
        p.get_by_text("Your quick match", exact=True).wait_for(timeout=60000)

    def match():
        a.say("Two minutes of everyday questions: which roles could you grow into?")
        a.click(p.get_by_role("link", name="Explore my strengths"), after=1.4)
        answer_quiz()
        a.say("Ranked roles, with the reasons behind each.")
        a.scroll(3, after=1.6)
    a.beat("quick match", match)

    def plan():
        a.say("One click: a 90-day plan built around you.")
        a.click(p.get_by_role("button", name="Plan for this role"), after=2)
        p.locator(".plan-block").first.wait_for(timeout=300_000)
        a.say("Steps that use what you already know, at the hours you have.")
        a.scroll(5, after=1.6)
        a.click(".phase summary", after=1.4)
        a.click(".act-done input", after=1.2)
        a.say("Tick it off: your progress is saved, and your HR advisor sees it.", hold=2.4)
    a.beat("personal plan", plan)

    def interview():
        a.go("index.html#/quiz")
        answer_quiz(quick=True)  # the matches don't survive leaving the page; trim this in Cap's editor
        a.say("Practise the interview with Mina, by voice.")
        a.click(p.get_by_role("button", name="Practice interview"), after=2)
        a.click("input[type=checkbox]", after=0.6)
        a.click(p.get_by_role("button", name="Start mock interview"), after=3)
        if p.locator('.room-mode [data-mode="focus"]').count():
            a.click('.room-mode [data-mode="focus"]', after=1)
        a.say("She reads each question aloud, listens, and asks follow-ups.", hold=7)
    a.beat("mock interview", interview)

    def coach():
        a.say("And a career coach that knows your plan.")
        a.go("index.html#/agents")
        a.click("textarea.ag-input", after=0.4)
        a.type("What should I learn first for my target job?")
        p.keyboard.press("Enter")
        p.locator(".ag-msg.them").last.wait_for(timeout=90000); a.wait(3)
    a.beat("career coach", coach)
    a.say("")


def act_admin(a: Act) -> None:
    a.go("admin.html#/overview")
    a.card("Run it with confidence", "AiversePulse · for administrators")
    for href, line in (("#/overview", "The whole platform on one page."),
                       ("#/accounts", "Every account, approved and managed in one place."),
                       ("#/usage", "Token use by model and task, so costs never surprise you."),
                       ("#/fraud", "Fraud monitoring keeps sign-ups honest."),
                       ("#/models", "Pick which AI model answers each task.")):
        a.beat(href, lambda href=href, line=line: (a.say(line, hold=0.4), a.click(f'a[href="{href}"]', after=2.2), a.scroll(2, after=1.2)))
    a.say("")
    a.card("AiversePulse", "sdc.olgtx.com", hold=3.2)


ACTS = {"hr": act_hr, "employee": act_employee, "admin": act_admin}


# ---------------------------------------------------------------- Cap and the browser
def cap(action) -> None:
    os.startfile("cap-desktop://action?value=" + urllib.parse.quote(json.dumps(action)))


def window_title(contains: str) -> str | None:
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        n = user32.GetWindowTextLengthW(hwnd)
        if n and user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if contains in buf.value:
                found.append(buf.value)
        return True

    user32.EnumWindows(each, 0)
    return found[0] if found else None


def browser(pw, role: str, kiosk: bool):
    PROFILES.mkdir(parents=True, exist_ok=True)
    kw = dict(user_data_dir=str(PROFILES / role), headless=False, no_viewport=True,
              args=(["--kiosk", "--start-fullscreen"] if kiosk else ["--start-maximized"]) + ["--disable-infobars", "--autoplay-policy=no-user-gesture-required"],
              ignore_default_args=["--enable-automation"])
    try:
        return pw.chromium.launch_persistent_context(channel="chrome", **kw)
    except Exception:
        return pw.chromium.launch_persistent_context(**kw)  # Playwright's own Chromium


def who(ctx) -> dict | None:
    """The account this profile is signed in as (the profile's cookies, no page needed, so redirects can't break it)."""
    try:
        r = ctx.request.get(f"{BASE}/api/me")
        return r.json() if r.ok else None
    except Exception:
        return None


def setup(pw, roles: list[str]) -> None:
    """Open each role's profile at its sign-in page and wait until you've signed in (the script never sees passwords).
    A role already signed in with the right kind of account is skipped."""
    for role in roles:
        path, want = ROLES[role]
        ctx = browser(pw, role, kiosk=False)
        me = who(ctx)
        if me and me.get("role") == want:
            print(f"  {role}: already signed in as {me.get('username')}")
            ctx.close(); continue
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(f"{BASE}/{path}")
        print(f"Sign in as the {role} demo account ({want}) in the window that opened...")
        while True:
            me = who(ctx)
            if me and me.get("role") == want:
                print(f"  {role}: signed in as {me.get('username')}")
                break
            if me:
                print(f"  that's a {me.get('role')} account; sign out and use a {want} account", end="\r")
            time.sleep(2)
        ctx.close()


def main() -> int:
    global PACE, BASE
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--setup", action="store_true", help="sign in to the three demo accounts once")
    ap.add_argument("--record", action="store_true", help="record each act with Cap (Studio mode)")
    ap.add_argument("--check", action="store_true", help="rehearse without recording")
    ap.add_argument("--acts", default="hr,employee,admin", help="comma list: hr, employee, admin")
    ap.add_argument("--pace", type=float, default=1.0, help="hold-time multiplier (0.6 = faster cut)")
    ap.add_argument("--url", default=BASE)
    args = ap.parse_args()
    PACE, BASE = args.pace, args.url.rstrip("/")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        acts = [a.strip() for a in args.acts.split(",") if a.strip()]
        if args.setup:
            setup(pw, acts)
            return 0
        for name in acts:
            print(f"Act: {name}")
            ctx = browser(pw, name, kiosk=True)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.add_init_script(OVERLAY)
            me = who(ctx)
            if not me or me.get("role") != ROLES[name][1]:
                print(f"  not signed in as {name}: run  python src/scripts/ad_demo.py --setup --acts {name}"); ctx.close(); continue
            print(f"  as {me.get('username')}")
            page.goto(f"{BASE}/{ROLES[name][0]}", wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle", timeout=30000)
            page.bring_to_front(); time.sleep(1.5)
            recording = False
            if args.record:
                title = window_title(TITLE)
                if not title:
                    print("  couldn't find the demo window to record"); ctx.close(); continue
                cap({"start_recording": {"capture_mode": {"window": title}, "camera": None, "mic_label": None,
                                         "capture_system_audio": True, "mode": "studio"}})
                recording = True; time.sleep(3)  # Cap's countdown
            try:
                ACTS[name](Act(page))
            finally:
                if recording:
                    time.sleep(1); cap("stop_recording"); time.sleep(3)
                ctx.close()
    if args.record:
        print("Done. Each act is a Studio recording in Cap: open it, Zoom -> Auto, trim, then export (or join the three).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
