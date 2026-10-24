"""Which database the app picks."""


def test_platform_database_url_is_ignored_without_explicit_backend(monkeypatch):
    """A host DATABASE_URL does not select Postgres unless the app explicitly opts in."""
    import sqlite3
    from config.settings import Settings
    from governance import db
    monkeypatch.setenv("DATABASE_BACKEND", "")
    monkeypatch.setenv("DATABASE_URL", "postgresql://postgres:password@helium/heliumdb?sslmode=disable")
    monkeypatch.delenv("AIVERSEPULSE_DATABASE_URL", raising=False)
    s = Settings(_env_file=None)
    assert s.database_url is None
    monkeypatch.setattr(db, "_settings", lambda: s)
    assert isinstance(db.connect(":memory:"), sqlite3.Connection)
    monkeypatch.setenv("AIVERSEPULSE_DATABASE_URL", "postgresql://app@db.example/aiversepulse")
    assert Settings().database_url.get_secret_value() == "postgresql://app@db.example/aiversepulse"


def test_platform_database_url_requires_explicit_postgres_backend(monkeypatch):
    from config.settings import Settings
    from governance import db

    monkeypatch.setenv("DATABASE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", "postgresql://app@replit-db/aiversepulse")
    monkeypatch.delenv("AIVERSEPULSE_DATABASE_URL", raising=False)
    s = Settings(_env_file=None)
    monkeypatch.setattr(db, "_settings", lambda: s)
    monkeypatch.setattr(db, "PgConnection", lambda url, schema: (url, schema))

    assert db.postgres_url() == "postgresql://app@replit-db/aiversepulse"
    assert db.connect(":memory:")[0] == "postgresql://app@replit-db/aiversepulse"
