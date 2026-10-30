import logging
from types import SimpleNamespace

from governance import mailer


def test_links_are_never_logged_without_smtp(caplog, monkeypatch):
    monkeypatch.delenv("AP_LOG_EMAIL_LINKS", raising=False)
    link = "https://example.test/reset?token=very-secret-token-123"
    with caplog.at_level(logging.WARNING, logger="governance.mailer"):
        assert mailer.send(SimpleNamespace(smtp_host=""), "a@example.com", "Reset", "h", ["l"], "b", link, "f") is False
    assert "very-secret-token-123" not in caplog.text and "NOT sent" in caplog.text
