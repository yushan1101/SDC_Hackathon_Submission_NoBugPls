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

-- a model per employee or student, set by their HR advisor (overrides the enterprise's choice for that task)
CREATE TABLE IF NOT EXISTS member_models(username TEXT, task TEXT, spec TEXT, set_by TEXT, PRIMARY KEY(username, task));

-- what the agent remembers about each person across chats (their own facts only)
CREATE TABLE IF NOT EXISTS agent_memory(id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL, fact TEXT NOT NULL, agent TEXT,
  created_utc TEXT, used_utc TEXT);
CREATE INDEX IF NOT EXISTS agent_memory_user ON agent_memory(username);

-- each person's agent conversations (chat history), kept per account
CREATE TABLE IF NOT EXISTS agent_chats(id TEXT PRIMARY KEY, username TEXT NOT NULL, title TEXT, messages TEXT, updated_utc TEXT);
CREATE INDEX IF NOT EXISTS agent_chats_user ON agent_chats(username, updated_utc);
