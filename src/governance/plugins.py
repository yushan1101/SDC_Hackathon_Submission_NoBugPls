"""Hiring plugins: an HR advisor connects company accounts once, then the posting agent writes a post for each
platform and sends every opening to all of them.

    linkedin  - company page (OAuth; LinkedIn app with Community Management API: w_organization_social)
    facebook  - Facebook Page (OAuth; Meta app with pages_manage_posts, pages_show_list)
    x         - X account (OAuth 2.0 with PKCE; X app with tweet.write, users.read, offline.access)
    telegram  - channel via a bot (bot token + @channel; the bot must be a channel admin)
    discord   - channel webhook URL
    slack     - incoming webhook URL

Tokens are encrypted at rest (Fernet; key from PLUGIN_SECRET_KEY, else a key file next to the database) and never
returned to the browser. OAuth app keys live in .env; a platform without them is shown as "needs app keys".
"""
import base64
import hashlib
import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

import httpx
from cryptography.fernet import Fernet

from governance.audit import now

log = logging.getLogger(__name__)
SCHEMA = """
CREATE TABLE IF NOT EXISTS plugin_connections(id TEXT PRIMARY KEY, owner TEXT, platform TEXT, label TEXT, secret BLOB,
    auto INTEGER DEFAULT 1, expires_utc TEXT, created_utc TEXT);
CREATE TABLE IF NOT EXISTS plugin_oauth_states(state TEXT PRIMARY KEY, owner TEXT, platform TEXT, verifier TEXT,
    extra TEXT, expires_utc TEXT);
CREATE TABLE IF NOT EXISTS plugin_posts(id INTEGER PRIMARY KEY, opening_id TEXT, connection_id TEXT, platform TEXT,
    label TEXT, status TEXT, url TEXT, error TEXT, actor TEXT, at_utc TEXT);
"""
PLATFORMS = {"linkedin": "LinkedIn company page", "facebook": "Facebook Page", "x": "X (Twitter)",
             "telegram": "Telegram channel", "discord": "Discord channel", "slack": "Slack channel"}
OAUTH = {"linkedin", "facebook", "x"}
TIMEOUT = 20


class PluginError(ValueError):
    pass


def init(con):
    if getattr(con, "backend", "sqlite") == "postgres":
        return con
    con.executescript(SCHEMA)
    return con


# ---------------------------------------------------------------- secrets at rest
_fernet = None


def _box(cfg) -> Fernet:
    global _fernet
    if _fernet is None:
        if cfg.plugin_secret_key:
            key = cfg.plugin_secret_key.get_secret_value().encode()
        else:  # ponytail: key file beside the database; set PLUGIN_SECRET_KEY to keep it off the data volume
            path = os.path.join(os.path.dirname(os.path.abspath(cfg.database_path)), "plugin.key")
            if not os.path.exists(path):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(Fernet.generate_key())
            key = open(path, "rb").read().strip()
        _fernet = Fernet(key)
    return _fernet


def _seal(cfg, data: dict) -> bytes:
    return _box(cfg).encrypt(json.dumps(data).encode())


def _open(cfg, blob: bytes) -> dict:
    return json.loads(_box(cfg).decrypt(blob))


# ---------------------------------------------------------------- connections
def available(cfg) -> dict:
    """platform -> True if it can be connected now (OAuth platforms need their app keys in .env)."""
    keys = {"linkedin": cfg.linkedin_client_id and cfg.linkedin_client_secret,
            "facebook": cfg.facebook_app_id and cfg.facebook_app_secret,
            "x": cfg.x_client_id}
    return {p: bool(keys.get(p, True)) for p in PLATFORMS}


def save(con, cfg, owner: str, platform: str, label: str, secret: dict, expires: str | None = None) -> str:
    cid = secrets.token_hex(6)
    with con:
        con.execute("INSERT INTO plugin_connections VALUES(?,?,?,?,?,1,?,?)",
                    (cid, owner, platform, label[:80], _seal(cfg, secret), expires, now()))
    return cid


def connections(con, owner: str) -> list[dict]:
    init(con)
    rows = con.execute("SELECT id, platform, label, auto, expires_utc, created_utc FROM plugin_connections WHERE owner=? "
                       "ORDER BY created_utc", (owner,)).fetchall()
    t = datetime.now(timezone.utc).isoformat()
    return [{"id": i, "platform": p, "platform_name": PLATFORMS[p], "label": lb, "auto": bool(a), "created_utc": c,
             "expired": bool(e and e < t)} for i, p, lb, a, e, c in rows]


def remove(con, owner: str, cid: str) -> bool:
    with con:
        return con.execute("DELETE FROM plugin_connections WHERE id=? AND owner=?", (cid, owner)).rowcount > 0


def set_auto(con, owner: str, cid: str, auto: bool) -> bool:
    with con:
        return con.execute("UPDATE plugin_connections SET auto=? WHERE id=? AND owner=?", (int(auto), cid, owner)).rowcount > 0


def check_simple(platform: str, fields: dict) -> tuple[str, dict]:
    """Telegram / Discord / Slack: check what was pasted -> (label, secret) for save(). The token or webhook URL is
    the whole credential."""
    if platform == "telegram":
        token, chat = (fields.get("bot_token") or "").strip(), (fields.get("chat_id") or "").strip()
        if not re.fullmatch(r"\d{5,12}:[A-Za-z0-9_-]{30,50}", token):
            raise PluginError("That doesn't look like a bot token from @BotFather (123456:ABC...).")
        if not re.fullmatch(r"@[A-Za-z0-9_]{5,32}|-?\d{5,20}", chat):
            raise PluginError("Channel: @channelname, or the numeric chat id.")
        me = httpx.get(f"https://api.telegram.org/bot{token}/getMe", timeout=TIMEOUT).json()
        if not me.get("ok"):
            raise PluginError("Telegram rejected that bot token.")
        return f"{chat} via @{me['result'].get('username', 'bot')}", {"bot_token": token, "chat_id": chat}
    if platform in ("discord", "slack"):
        url = (fields.get("webhook_url") or "").strip()
        u = urlparse(url)
        ok = u.scheme == "https" and (u.hostname in ("discord.com", "discordapp.com") and u.path.startswith("/api/webhooks/")
                                      if platform == "discord" else u.hostname == "hooks.slack.com" and u.path.startswith("/services/"))
        if not ok:  # only the platform's own webhook host: the server never calls an address someone typed in
            raise PluginError(f"Paste the {PLATFORMS[platform].split()[0]} webhook URL (https://"
                              + ("discord.com/api/webhooks/..." if platform == "discord" else "hooks.slack.com/services/...") + ").")
        label = (fields.get("label") or "").strip() or PLATFORMS[platform]
        return label, {"webhook_url": url}
    raise PluginError("unknown platform")


# ---------------------------------------------------------------- OAuth sign-in (LinkedIn, Facebook, X)
def _graph(cfg) -> str:
    return f"https://graph.facebook.com/{cfg.facebook_graph_version}"


def authorize_url(con, cfg, owner: str, platform: str, redirect_uri: str, extra: dict | None = None) -> str:
    init(con)
    if platform not in OAUTH or not available(cfg)[platform]:
        raise PluginError(f"{PLATFORMS.get(platform, platform)} needs its app keys in the server .env first.")
    if platform == "linkedin" and not re.fullmatch(r"\d{3,20}", str((extra or {}).get("org_id", ""))):
        raise PluginError("Enter the company page's numeric id (from the page admin URL: linkedin.com/company/<id>/admin).")
    state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    with con:
        con.execute("DELETE FROM plugin_oauth_states WHERE expires_utc < ?", (now(),))
        con.execute("INSERT INTO plugin_oauth_states VALUES(?,?,?,?,?,?)", (state, owner, platform, verifier, json.dumps(extra or {}),
                    (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(timespec="seconds")))
    if platform == "linkedin":
        return "https://www.linkedin.com/oauth/v2/authorization?" + urlencode({
            "response_type": "code", "client_id": cfg.linkedin_client_id, "redirect_uri": redirect_uri, "state": state,
            "scope": "w_organization_social"})
    if platform == "facebook":
        return f"https://www.facebook.com/{cfg.facebook_graph_version}/dialog/oauth?" + urlencode({
            "client_id": cfg.facebook_app_id, "redirect_uri": redirect_uri, "state": state,
            "scope": "pages_manage_posts,pages_show_list"})
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return "https://x.com/i/oauth2/authorize?" + urlencode({
        "response_type": "code", "client_id": cfg.x_client_id, "redirect_uri": redirect_uri, "state": state,
        "scope": "tweet.read tweet.write users.read offline.access", "code_challenge": challenge, "code_challenge_method": "S256"})


def _x_token(cfg, form: dict) -> dict:
    auth = (cfg.x_client_id, cfg.x_client_secret.get_secret_value()) if cfg.x_client_secret else None
    r = httpx.post("https://api.x.com/2/oauth2/token", data=form | ({} if auth else {"client_id": cfg.x_client_id}),
                   auth=auth, timeout=TIMEOUT)
    r.raise_for_status()
    t = r.json()
    return {"access_token": t["access_token"], "refresh_token": t.get("refresh_token"),
            "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=int(t.get("expires_in", 7200)) - 60)).isoformat()}


def finish_oauth(con, lock, cfg, platform: str, code: str, state: str, redirect_uri: str) -> int:
    """The platform sent the person back: swap the code for tokens and store the connection(s). -> how many.
    Database work under `lock`; the calls to the platform outside it."""
    with lock:
        init(con)
        row = con.execute("SELECT owner, verifier, extra, expires_utc FROM plugin_oauth_states WHERE state=? AND platform=?",
                          (state, platform)).fetchone()
        with con:
            con.execute("DELETE FROM plugin_oauth_states WHERE state=?", (state,))  # single use
    if not row or row[3] < now():
        raise PluginError("This sign-in expired. Start again from Hiring plugins.")
    owner, verifier, extra = row[0], row[1], json.loads(row[2] or "{}")
    if platform == "linkedin":
        r = httpx.post("https://www.linkedin.com/oauth/v2/accessToken", data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
            "client_id": cfg.linkedin_client_id, "client_secret": cfg.linkedin_client_secret.get_secret_value()}, timeout=TIMEOUT)
        r.raise_for_status()
        t = r.json()
        expires = (datetime.now(timezone.utc) + timedelta(seconds=int(t.get("expires_in", 0)))).isoformat()  # ~60 days
        with lock:
            save(con, cfg, owner, "linkedin", f"Company page {extra['org_id']}", {"access_token": t["access_token"], "org_id": extra["org_id"]}, expires)
        return 1
    if platform == "facebook":
        g, app = _graph(cfg), {"client_id": cfg.facebook_app_id, "client_secret": cfg.facebook_app_secret.get_secret_value()}
        short = httpx.get(f"{g}/oauth/access_token", params=app | {"redirect_uri": redirect_uri, "code": code}, timeout=TIMEOUT)
        short.raise_for_status()
        long = httpx.get(f"{g}/oauth/access_token", params=app | {"grant_type": "fb_exchange_token",
                         "fb_exchange_token": short.json()["access_token"]}, timeout=TIMEOUT)
        long.raise_for_status()
        pages = httpx.get(f"{g}/me/accounts", params={"access_token": long.json()["access_token"], "fields": "id,name,access_token"},
                          timeout=TIMEOUT).json().get("data", [])
        if not pages:
            raise PluginError("No Facebook Pages came back. Pick at least one Page when Facebook asks.")
        with lock:
            for p in pages:  # page tokens made from a long-lived user token do not expire
                save(con, cfg, owner, "facebook", p["name"], {"page_id": p["id"], "access_token": p["access_token"]})
        return len(pages)
    tok = _x_token(cfg, {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri, "code_verifier": verifier})
    me = httpx.get("https://api.x.com/2/users/me", headers={"Authorization": f"Bearer {tok['access_token']}"}, timeout=TIMEOUT)
    handle = (me.json().get("data") or {}).get("username", "account") if me.status_code == 200 else "account"
    with lock:
        save(con, cfg, owner, "x", f"@{handle}", tok)
    return 1


# ---------------------------------------------------------------- the posting agent: one post per platform
LIMITS = {"x": 280, "telegram": 4000, "discord": 2000, "slack": 3000, "linkedin": 2900, "facebook": 5000}
X_LINK = 24  # X counts every link as 23 characters, plus a space


def write_posts(opening: dict, summary: list[str], link: str) -> tuple[dict, dict | None]:
    """-> ({platform: text}, LLM usage). Copywriter agent when a model is configured; a clear template otherwise.
    Texts never contain the link: it is added by send(), so it is always exactly the opening's apply link."""
    must = [s for s in summary if not s.startswith(("Refused", "Not understood"))][:5]
    plain = f"We're hiring: {opening['title']}."
    base = {"long": plain + (" What we look for: " + "; ".join(must) + "." if must else "") + " Apply in a few minutes with your résumé.",
            "short": plain + " Apply with your résumé:"}
    texts = {p: base["short" if p == "x" else "long"] for p in PLATFORMS}
    usage = None
    try:
        from agents.llm import generate
        out, usage = generate(json.dumps({"title": opening["title"], "requirements": must}), max_tokens=700, json=True, agent="recruiter",
                              system="You write job posts for a company's social channels. Return JSON with keys linkedin, facebook, x, "
                                     "chat. linkedin: 3-5 short professional lines. facebook: friendly, 2-4 lines. x: one line under 230 "
                                     "characters. chat: 2-3 lines for Telegram/Discord/Slack. Use only the given facts; no salary, "
                                     "location or benefits unless given; no hashtags spam (at most 2); never mention age, gender, "
                                     "race, religion or other protected traits; no links (one is added after).")
        got = json.loads(out) if out else {}
        for p in PLATFORMS:
            t = str(got.get("chat" if p in ("telegram", "discord", "slack") else p) or "").strip()
            if t:
                texts[p] = re.sub(r"https?://\S+", "", t).strip()
    except Exception as e:  # the template is always good enough to post
        log.warning("posting agent fell back to the template: %s", type(e).__name__)
    return texts, usage


def _fit(platform: str, text: str, link: str) -> str:
    room = LIMITS[platform] - (X_LINK if platform == "x" else len(link) + 2)
    text = text if len(text) <= room else text[:room - 1].rstrip() + "…"
    return f"{text}\n\n{link}" if platform != "x" else f"{text} {link}"


def _li_escape(text: str) -> str:
    """LinkedIn 'little text format': these characters must be escaped or the post is cut/garbled."""
    return re.sub(r"([\\|{}@\[\]()<>#*_~])", r"\\\1", text)


def send(cfg, platform: str, secret: dict, text: str, link: str, on_refresh=None) -> str | None:
    """Post once. -> public URL of the post when the platform gives one. Raises on failure."""
    body = _fit(platform, text, link)
    if platform == "telegram":
        r = httpx.post(f"https://api.telegram.org/bot{secret['bot_token']}/sendMessage",
                       json={"chat_id": secret["chat_id"], "text": body}, timeout=TIMEOUT).json()
        if not r.get("ok"):
            raise PluginError(r.get("description", "Telegram refused the post"))
        chat = secret["chat_id"]
        return f"https://t.me/{chat[1:]}/{r['result']['message_id']}" if chat.startswith("@") else None
    if platform == "discord":
        httpx.post(secret["webhook_url"], params={"wait": "true"}, json={"content": body}, timeout=TIMEOUT).raise_for_status()
        return None
    if platform == "slack":
        httpx.post(secret["webhook_url"], json={"text": body}, timeout=TIMEOUT).raise_for_status()
        return None
    if platform == "linkedin":
        r = httpx.post("https://api.linkedin.com/rest/posts", timeout=TIMEOUT, headers={
            "Authorization": f"Bearer {secret['access_token']}", "LinkedIn-Version": cfg.linkedin_version,
            "X-Restli-Protocol-Version": "2.0.0"}, json={
            "author": f"urn:li:organization:{secret['org_id']}", "commentary": _li_escape(body), "visibility": "PUBLIC",
            "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
            "lifecycleState": "PUBLISHED", "isReshareDisabledByAuthor": False})
        r.raise_for_status()
        urn = r.headers.get("x-restli-id", "")
        return f"https://www.linkedin.com/feed/update/{urn}" if urn else None
    if platform == "facebook":
        r = httpx.post(f"{_graph(cfg)}/{secret['page_id']}/feed", data={"message": body, "link": link,
                       "access_token": secret["access_token"]}, timeout=TIMEOUT)
        r.raise_for_status()
        return f"https://www.facebook.com/{r.json()['id']}"
    if platform == "x":
        if secret.get("refresh_token") and secret.get("expires_at", "") < datetime.now(timezone.utc).isoformat():
            secret.update(_x_token(cfg, {"grant_type": "refresh_token", "refresh_token": secret["refresh_token"]}))
            if on_refresh:
                on_refresh(secret)
        r = httpx.post("https://api.x.com/2/tweets", json={"text": body}, timeout=TIMEOUT,
                       headers={"Authorization": f"Bearer {secret['access_token']}"})
        r.raise_for_status()
        return f"https://x.com/i/web/status/{r.json()['data']['id']}"
    raise PluginError("unknown platform")


def _why(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        return {401: "Sign-in expired or was revoked: reconnect this account.",
                403: "The account or app isn't allowed to post here (check the app's permissions).",
                429: "The platform's rate limit was hit: try again later."}.get(code, f"The platform answered {code}.")
    return str(e) if isinstance(e, PluginError) else f"Could not reach the platform ({type(e).__name__})."


def publish(con, lock, cfg, owner: str, opening: dict, summary: list[str], link: str, actor: str,
            only: list[str] | None = None, auto_only: bool = False) -> list[dict]:
    """Write the posts and send them to every connected account (or `only` these ids). Network calls run outside
    `lock`; each result is logged in plugin_posts. -> [{connection, platform, label, status, url, error}]"""
    with lock:
        init(con)
        rows = con.execute("SELECT id, platform, label, secret, auto FROM plugin_connections WHERE owner=?", (owner,)).fetchall()
    rows = [r for r in rows if (not only or r[0] in only) and (r[4] or not auto_only)]
    if not rows:
        return []
    texts, _ = write_posts(opening, summary, link)
    out = []
    for cid, platform, label, blob, _auto in rows:
        def refresh(sec, cid=cid):
            with lock, con:
                con.execute("UPDATE plugin_connections SET secret=? WHERE id=?", (_seal(cfg, sec), cid))
        res = {"connection": cid, "platform": platform, "platform_name": PLATFORMS[platform], "label": label, "url": None, "error": None}
        try:
            res["url"] = send(cfg, platform, _open(cfg, blob), texts[platform], link, refresh)
            res["status"] = "posted"
        except Exception as e:
            res["status"], res["error"] = "failed", _why(e)
            log.warning("plugin post failed (%s): %s", platform, res["error"])
        out.append(res)
        with lock, con:
            con.execute("INSERT INTO plugin_posts(opening_id,connection_id,platform,label,status,url,error,actor,at_utc) "
                        "VALUES(?,?,?,?,?,?,?,?,?)", (opening["id"], cid, platform, label, res["status"], res["url"], res["error"], actor, now()))
    return out


def history(con, opening_id: str) -> list[dict]:
    init(con)
    cols = ["platform", "label", "status", "url", "error", "actor", "at_utc"]
    return [dict(zip(cols, r)) | {"platform_name": PLATFORMS.get(r[0], r[0])} for r in con.execute(
        f"SELECT {','.join(cols)} FROM plugin_posts WHERE opening_id=? ORDER BY id DESC LIMIT 60", (opening_id,))]
