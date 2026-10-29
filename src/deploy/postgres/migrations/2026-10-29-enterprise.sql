-- Enterprises (company or school), full profiles, and the monthly enterprise subscription.
-- SQLite gets these from the app at start-up; PostgreSQL needs them applied through the migration flow.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pending TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_kind TEXT;

CREATE TABLE IF NOT EXISTS subscriptions(owner TEXT PRIMARY KEY, customer_id TEXT, subscription_id TEXT UNIQUE, status TEXT,
    current_period_end TEXT, cancel_at_period_end INTEGER DEFAULT 0, amount_cents INTEGER, currency TEXT, updated_utc TEXT);
CREATE TABLE IF NOT EXISTS billing_meta(key TEXT PRIMARY KEY, value TEXT);
