# Shared Postgres (primary + semi-synchronous standby)

All app nodes share one Postgres 17 + pgvector database (`DATABASE_URL`, see `governance/db.py`).

| | Host | Folder | Port |
|---|---|---|---|
| Primary | main server, `dnns.olgtx.com` (61.6.144.213, behind the router) | `/opt/aiversepulse-db` | 5433 (host 5432 is the BaoTa panel's own Postgres) |
| Standby | LA VPS, 64.188.10.157 | `/opt/aiversepulse-db-standby` | 127.0.0.1:5433 (read-only, local) |

## Semi-synchronous replication

- A commit returns once the standby has flushed it (`synchronous_standby_names = 'ANY 1 (standby_la)'`), so
  every acknowledged write exists on two machines. Cost: one round trip to LA, about 190 ms per commit.
- A transaction that may skip the wait: `SET LOCAL synchronous_commit = local` (sessions, counters).
- `watchdog.sh` owns that setting: if the standby stops streaming for 10 s it switches to async (writes then
  stop waiting), and back to semi-sync once the standby has caught up. `docker logs aiversepulse-db-watchdog`.
- Tested 2026-10-24: semi-sync commit ~290 ms vs ~95 ms async (incl. docker exec); every row on the standby
  when the commit returned; standby stopped mid-write -> the write finished after ~12 s, nothing hung;
  standby back -> caught up and semi-sync on again within 3 s.

## Security

- TLS only (`hostssl`), certificates from a private CA (10 years). `ca.crt` here is the public part: clients use
  `sslmode=verify-full sslrootcert=ca.crt`. The CA key is `/opt/aiversepulse-db/ca/ca.key` (root only).
- Passwords: `/opt/aiversepulse-db/secrets/{postgres,app,replicator}.pw`, generated on the server, never in git.
- `pg_hba.conf` allows replication only from the standby's IP; app logins are added when the app switches over.
- Docker-published ports bypass `ufw`, so `pg_hba.conf` + TLS + SCRAM passwords are what protects port 5433.

## Backups

Nightly `pg_dump` at 03:17 UTC, 7 days kept: `backup.cron` -> `/etc/cron.d/aiversepulse-db-backup`,
dumps in `/opt/aiversepulse-db/backups`.

## Rebuild from scratch

Primary (main server):
1. `mkdir -p /opt/aiversepulse-db/{data,conf,certs,secrets,init,backups,ca}`; copy `compose.primary.yml` as
   `compose.yml`, `postgresql.conf` + `pg_hba.conf` into `conf/`, `watchdog.sh`, `init/10-roles.sh` into `init/`.
2. CA + server certificate (SANs `dnns.olgtx.com`, `db.olgtx.com`, `61.6.144.213`) and three random
   passwords in `secrets/`; `chown -R 999:999 data certs secrets`, keys and passwords `chmod 600`.
3. `docker compose up -d`. The first start creates the `aiversepulse` database, the `aiversepulse` and
   `replicator` roles, pgvector and the `standby_la` slot.

Standby (LA):
1. `/opt/aiversepulse-db-standby/{data,certs,secrets}`: `certs/ca.crt`, `secrets/pgpass`
   (`dnns.olgtx.com:5433:*:replicator:<password>`), all owned by 999; `compose.standby.yml` as `compose.yml`.
2. Clone: `docker run --rm --user 999:999 -v $PWD/data:/var/lib/postgresql/data -v $PWD/certs:/certs:ro
   -v $PWD/secrets:/secrets:ro -e PGPASSFILE=/secrets/pgpass pgvector/pgvector:pg17 pg_basebackup
   -D /var/lib/postgresql/data -R -X stream -S standby_la -d "host=dnns.olgtx.com port=5433 user=replicator
   sslmode=verify-full sslrootcert=/certs/ca.crt application_name=standby_la passfile=/secrets/pgpass"`
3. `docker compose up -d`. Check on the primary: `SELECT application_name, state, sync_state FROM
   pg_stat_replication` -> `standby_la | streaming | quorum`.
