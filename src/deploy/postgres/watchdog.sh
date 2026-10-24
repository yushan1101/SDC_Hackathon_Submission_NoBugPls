#!/bin/bash
# Semi-sync watchdog for the primary (MySQL-style semi-sync on Postgres):
#  - standby streaming          -> synchronous_standby_names = 'ANY 1 ($STANDBY)': commits wait for it
#  - standby gone for DOWN_S s  -> '' (async): commits stop waiting, so writes never hang on a dead standby
#  - standby back, lag < MAX_LAG -> sync again
# Every switch is logged (docker logs aiversepulse-db-watchdog) and visible as SHOW synchronous_standby_names.
set -u
STANDBY=${STANDBY:-standby_la}
DOWN_S=${DOWN_S:-10}
MAX_LAG=${MAX_LAG:-16777216}   # bytes of WAL the standby may still be behind when sync is restored (16 MB)
printf '*:*:*:postgres:%s\n' "$(cat /secrets/postgres.pw)" > "$PGPASSFILE" && chmod 600 "$PGPASSFILE"
export PGSSLMODE=disable PGCONNECT_TIMEOUT=5   # compose network only
q() { psql -XtAq -c "$1" 2>/dev/null; }
log() { echo "$(date -u +%FT%TZ) $*"; }
down_since=0
log "watchdog started for $STANDBY"
while true; do
  [ "$(q "SELECT 1")" = 1 ] || { sleep 5; continue; }   # primary not up (yet)
  names=$(q "SHOW synchronous_standby_names")
  lag=$(q "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), flush_lsn) FROM pg_stat_replication
           WHERE application_name='$STANDBY' AND state='streaming' LIMIT 1")
  if [ -n "$lag" ]; then
    down_since=0
    if [ -z "$names" ] && [ "${lag%.*}" -lt "$MAX_LAG" ]; then
      q "ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 ($STANDBY)'" && q "SELECT pg_reload_conf()" >/dev/null \
        && log "standby $STANDBY back (lag ${lag%.*} B): semi-sync ON"
    fi
  else
    [ "$down_since" -eq 0 ] && down_since=$(date +%s) && log "standby $STANDBY not streaming"
    if [ -n "$names" ] && [ $(( $(date +%s) - down_since )) -ge "$DOWN_S" ]; then
      q "ALTER SYSTEM SET synchronous_standby_names = ''" && q "SELECT pg_reload_conf()" >/dev/null \
        && log "standby $STANDBY gone ${DOWN_S}s: degraded to ASYNC (commits no longer wait)"
    fi
  fi
  sleep 2
done
