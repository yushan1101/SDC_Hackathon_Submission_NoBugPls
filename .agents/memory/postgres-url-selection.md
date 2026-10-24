---
name: PostgreSQL URL selection
description: Why the project supports both an app-specific database URL and an explicitly selected Replit database URL.
---

`AIVERSEPULSE_DATABASE_URL` is the preferred app database URL. A host-provided `DATABASE_URL` is ignored by default and is used only when `DATABASE_BACKEND=postgres` explicitly opts in; `DATABASE_BACKEND=sqlite` always forces SQLite.

**Why:** the upstream code avoids accidentally using a host's unrelated `DATABASE_URL`, while this workspace explicitly selects Replit PostgreSQL and does not have the app-specific variable configured.

**How to apply:** keep `governance.db.postgres_url()` as the shared selector for database connections and vector retrieval. Preserve tests for default isolation, explicit Postgres opt-in, and explicit SQLite override.
