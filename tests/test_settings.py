"""Which database the app picks."""


def test_platform_database_url_is_ignored(monkeypatch):
    """Hosts like Replit set DATABASE_URL to a database of their own: only AIVERSEPULSE_DATABASE_URL switches to Postgres."""
    import sqlite3
    from config.settings import Settings
    from governance import db
    monkeypatch.setenv("DATABASE_URL", "postgresql://postgres:password@helium/heliumdb?sslmode=disable")
    monkeypatch.delenv("AIVERSEPULSE_DATABASE_URL", raising=False)
    s = Settings()
    assert s.database_url is None
    monkeypatch.setattr(db, "_settings", lambda: s)
    assert isinstance(db.connect(":memory:"), sqlite3.Connection)
    monkeypatch.setenv("AIVERSEPULSE_DATABASE_URL", "postgresql://app@db.example/aiversepulse")
    assert Settings().database_url.get_secret_value() == "postgresql://app@db.example/aiversepulse"
