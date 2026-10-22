"""Run and record the main AiversePulse UI demo.

Usage:
    python src/scripts/ui_demo.py --url http://127.0.0.1:8600

The browser viewport is recorded by Playwright. The application UI is not changed.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


def credentials(path: Path, username: str) -> str:
    if not path.exists():
        raise SystemExit(
            f"Credentials file not found: {path}. Run seed_demo_users.py or pass "
            "--username/--password."
        )
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = line.split("\t")
        if len(fields) >= 3 and fields[0] == username:
            return fields[2]
    raise SystemExit(f"No password for {username!r} in {path}; pass --password.")


def pause(page, ms: int = 700) -> None:
    page.wait_for_timeout(ms)


def public_demo(page, base_url: str, username: str, password: str) -> None:
    page.goto(f"{base_url}/#/start", wait_until="domcontentloaded")
    page.get_by_role("link", name="Sign in").click()
    page.locator('input[name="username"]').fill(username)
    page.locator('input[name="password"]').fill(password)
    page.get_by_role("button", name="Sign in").click()
    page.get_by_role("link", name="Explore my strengths").click()
    page.locator(".quiz-stage").wait_for()
    page.get_by_role("button", name="Skip, search everything").click()

    # Each answer advances automatically. Using the existing option buttons keeps
    # this independent of screen coordinates and responsive layout.
    for answer in range(13):
        page.locator(".opts button").nth(answer % 4).click()
        page.wait_for_timeout(350)

    page.get_by_text("Your quick match", exact=True).wait_for()
    pause(page, 1200)

    page.goto(f"{base_url}/#/today", wait_until="domcontentloaded")
    page.get_by_role("heading", name="Today in AI").wait_for()
    pause(page, 1000)
    page.get_by_role("button", name="Sign out").click()
    page.get_by_role("link", name="Sign in").wait_for()


def enterprise_demo(page, base_url: str, username: str, password: str) -> None:
    page.goto(f"{base_url}/enterprise", wait_until="domcontentloaded")
    page.locator('input[name="username"]').wait_for()
    page.locator('input[name="username"]').fill(username)
    page.locator('input[name="password"]').fill(password)
    page.get_by_role("button", name="Sign in").click()
    page.get_by_role("heading", name="Overview").wait_for(timeout=30_000)

    page.get_by_role("link", name="Run team").click()
    page.get_by_role("button", name="Use sample CSV").click()
    page.get_by_role("button", name="Run analysis for 5 employees").wait_for(timeout=30_000)
    page.get_by_role("button", name="Run analysis for 5 employees").click()
    page.get_by_role("link", name="Open review queue").wait_for(timeout=180_000)
    page.get_by_role("link", name="Open review queue").click()
    page.locator('nav[aria-label="Review queue"]').wait_for(timeout=30_000)
    pause(page, 1200)

    page.get_by_role("link", name="Plans").first.click()
    page.get_by_role("heading", name="Plans register").wait_for(timeout=30_000)
    pause(page, 1200)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8600", help="Running app URL")
    parser.add_argument("--mode", choices=("all", "public", "enterprise"), default="all")
    parser.add_argument("--output", type=Path, default=Path("demo-artifacts"))
    parser.add_argument("--username", default=os.getenv("AIVERSEPULSE_DEMO_USERNAME", "demo_hr"))
    parser.add_argument("--password", default=os.getenv("AIVERSEPULSE_DEMO_PASSWORD"))
    parser.add_argument("--employee-username", default=os.getenv("AIVERSEPULSE_DEMO_EMPLOYEE", "demo_employee"))
    parser.add_argument("--employee-password", default=os.getenv("AIVERSEPULSE_DEMO_EMPLOYEE_PASSWORD"))
    parser.add_argument(
        "--credentials-file",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "demo_users.local.txt",
    )
    parser.add_argument("--headless", action="store_true", help="Hide the browser while recording")
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit(
            "Playwright is required. Install it with `pip install -r requirements-demo.txt` "
            "then run `python -m playwright install chromium`."
        )

    if args.mode in ("all", "enterprise") and not args.password:
        args.password = credentials(args.credentials_file, args.username)
    if args.mode in ("all", "public") and not args.employee_password:
        args.employee_password = credentials(args.credentials_file, args.employee_username)

    args.output.mkdir(parents=True, exist_ok=True)
    base_url = args.url.rstrip("/")
    recorded_path = None

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=args.headless)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(args.output),
            record_video_size={"width": 1440, "height": 900},
            reduced_motion="reduce",
        )
        page = context.new_page()
        try:
            if args.mode in ("all", "public"):
                public_demo(page, base_url, args.employee_username, args.employee_password)
            if args.mode in ("all", "enterprise"):
                enterprise_demo(page, base_url, args.username, args.password)
        finally:
            video = page.video
            context.close()
            recorded_path = Path(video.path()) if video else None
            browser.close()

    if recorded_path:
        source = recorded_path
        target = args.output / "aiversepulse-ui-demo.webm"
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
        print(f"Recorded demo: {target.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
