"""HR operator: turns a plain-language request ("send the nurse opening to our Telegram") into an action.

Nothing leaves the app from the chat itself. The reply carries a proposal (which opening, which connected accounts),
and the advisor's click on it calls the normal publish endpoint, the same as the Post button on the Hiring page.
"""
import re

from governance.plugins import PLATFORMS

SEND = re.compile(r"\b(send|post|share|publish|push|announce|put|broadcast|advertise)\b", re.I)
NAMES = {"telegram": r"telegram|\btg\b", "discord": r"discord", "slack": r"slack", "linkedin": r"linked\s?in",
         "facebook": r"facebook|\bfb\b", "x": r"\bx\b|twitter|tweet"}
EVERYWHERE = re.compile(r"\b(everywhere|all (of )?(my |our |the )?(channels?|accounts?|platforms?|plugins?))\b", re.I)
NEWEST = re.compile(r"\b(newest|latest|new|recent|last)\b", re.I)
WORDS = re.compile(r"[a-z]{3,}")
STOP = {"send", "post", "share", "publish", "the", "our", "my", "and", "for", "job", "jobs", "opening", "openings", "role",
        "hiring", "info", "information", "vacancy", "channel", "group", "please", "can", "you", "this", "that", "with",
        "all", "to", "new", "latest", "newest", "telegram", "discord", "slack", "linkedin", "facebook", "twitter"}


def _words(text: str) -> set[str]:
    return set(WORDS.findall(text.lower())) - STOP


def publish_intent(text: str, openings: list[dict], conns: list[dict]) -> dict | None:
    """-> None when the message isn't asking to post an opening somewhere; else {reply, proposal | None}."""
    platforms = [p for p, rx in NAMES.items() if re.search(rx, text, re.I)]
    everywhere = bool(EVERYWHERE.search(text))
    if not SEND.search(text) or not (platforms or everywhere):
        return None
    live = [o for o in openings if o["status"] == "open"]
    if not live:
        return {"reply": "You have no open openings to post. Create one under Hiring first, then ask me again.", "proposal": None}
    asked = _words(text)
    ranked = sorted(live, key=lambda o: -len(asked & _words(o["title"])))
    if asked & _words(ranked[0]["title"]):
        opening = ranked[0]
    elif len(live) == 1 or NEWEST.search(text):
        opening = live[0]  # openings come newest first
    else:
        names = "; ".join(o["title"] for o in live[:8])
        return {"reply": f"Which opening should I post? Your open ones are: {names}.", "proposal": None}
    usable = [c for c in conns if not c["expired"]]
    targets = usable if everywhere else [c for c in usable if c["platform"] in platforms]
    missing = [PLATFORMS[p] for p in platforms if not any(c["platform"] == p for c in usable)]
    if not targets:
        where = ", ".join(missing) or "an account"
        return {"reply": f"You haven't connected {where} yet. Connect it under Hiring plugins, then ask me again.",
                "proposal": None, "link": {"label": "Hiring plugins", "href": "#/plugins"}}
    where = ", ".join(f"{c['platform_name']} ({c['label']})" for c in targets)
    note = f" {', '.join(missing)} isn't connected, so I left it out." if missing else ""
    return {"reply": f'Ready to post "{opening["title"]}" to {where}. I write each post for its platform when you '
                     f"confirm.{note}",
            "proposal": {"kind": "publish_opening", "opening": {"id": opening["id"], "title": opening["title"]},
                         "connections": [{"id": c["id"], "platform": c["platform"], "label": c["label"],
                                          "platform_name": c["platform_name"]} for c in targets]}}


if __name__ == "__main__":
    ops = [{"id": "o1", "title": "Ward nurse", "status": "open"}, {"id": "o2", "title": "Junior data analyst", "status": "open"}]
    tg = [{"id": "c1", "platform": "telegram", "platform_name": "Telegram channel", "label": "@jobs", "expired": False}]
    r = publish_intent("Send the nurse job to our Telegram", ops, tg)
    assert r["proposal"]["opening"]["id"] == "o1" and r["proposal"]["connections"][0]["id"] == "c1"
    assert publish_intent("How many applicants does the nurse job have?", ops, tg) is None
    assert publish_intent("post it to telegram", ops, tg)["proposal"] is None  # two openings, none named: ask which
    assert publish_intent("post the latest opening to slack", ops, tg)["link"]  # not connected: say where to connect
    print("ok")
