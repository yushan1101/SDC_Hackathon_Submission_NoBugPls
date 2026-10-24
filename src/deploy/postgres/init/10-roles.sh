#!/bin/bash
# First start only (empty data dir): app and replication roles, pgvector, and the standby's replication slot.
# Passwords come from /secrets/*.pw (generated on the server, never in git).
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U postgres -d aiversepulse \
     -v app_pw="$(cat /secrets/app.pw)" -v repl_pw="$(cat /secrets/replicator.pw)" <<'SQL'
CREATE ROLE aiversepulse LOGIN PASSWORD :'app_pw';
CREATE ROLE replicator LOGIN REPLICATION PASSWORD :'repl_pw';
ALTER DATABASE aiversepulse OWNER TO aiversepulse;
ALTER SCHEMA public OWNER TO aiversepulse;
CREATE EXTENSION IF NOT EXISTS vector;
SELECT pg_create_physical_replication_slot('standby_la');
SQL
