"""Every AiversePulse email: the owl on top, one heading, a few lines, one button. Sent by SMTP (STARTTLS) when
SMTP_HOST is set; otherwise it is not sent and only "not sent" is logged, never the link (a reset / verify / invite
link is as good as a password). AP_LOG_EMAIL_LINKS=1 logs links on a local development machine only.

The owl is the site's blue owl in the pose that fits the email (captured from the live rig, web/js/owl.js:
"update" carries an envelope, "reminder" rings for a reset, "greeting" waves for an invite). It is attached inline
(cid:), not linked, so it shows even where remote images are blocked."""
import html
import logging
import os
import smtplib
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path

log = logging.getLogger(__name__)
OWLS = Path(__file__).resolve().parents[1] / "web" / "owl"


def send(cfg, to: str, subject: str, heading: str, lines: list[str], button: str, link: str, footer: str,
         owl_state: str = "update") -> bool:
    """Returns True if it went out by email, False if SMTP is not set up (development: logged instead)."""
    if not cfg.smtp_host:
        # Never log the link: it is a bearer token (password reset / verify / invite). Opt in only on a dev laptop.
        if os.environ.get("AP_LOG_EMAIL_LINKS") == "1":
            log.warning("SMTP not configured: email to %s (%s), link %s (development only)", to, subject, link)
        else:
            log.warning("SMTP not configured: email to %s (%s) was NOT sent", to, subject)
        return False
    msg = EmailMessage()
    msg["Subject"], msg["To"] = subject, to
    msg["From"] = cfg.smtp_from or cfg.smtp_user
    msg.set_content(f"{heading}\n\n" + "\n".join(lines) + f"\n\n{button}: {link}\n\n{footer}")
    owl = make_msgid(domain="aiversepulse")
    body = "".join(f'<p style="margin:0 0 12px">{html.escape(t)}</p>' for t in lines)
    msg.add_alternative(f"""<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1c2547">
<img src="cid:{owl[1:-1]}" width="120" height="108" alt="AiversePulse owl" style="display:block;margin:0 0 8px">
<h2 style="margin:0 0 16px">{html.escape(heading)}</h2>{body}
<p style="margin:20px 0"><a href="{html.escape(link)}" style="display:inline-block;background:#2a5bd7;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">{html.escape(button)}</a></p>
<p style="color:#667;font-size:13px;margin:0">{html.escape(footer)}</p></div>""", subtype="html")
    png = OWLS / f"email-{owl_state}.png"
    if png.exists():
        msg.get_payload()[1].add_related(png.read_bytes(), "image", "png", cid=owl)
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as s:
        s.starttls()
        if cfg.smtp_user:
            s.login(cfg.smtp_user, cfg.smtp_password.get_secret_value() if cfg.smtp_password else "")
        s.send_message(msg)
    return True
