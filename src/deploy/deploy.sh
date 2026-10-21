#!/usr/bin/env bash
# Forced command of the GitHub Actions deploy key (~deploy/.ssh/authorized_keys). Reads a tar of the repo on stdin,
# swaps it in as app/, rebuilds with cached layers, waits for health; rolls back to the previous code if unhealthy.
set -euo pipefail
cd /opt/aiversepulse
rm -rf app.new && mkdir app.new
tar -x -C app.new
[ -f app.new/src/Dockerfile ] || { echo "archive has no src/Dockerfile; refusing to deploy"; rm -rf app.new; exit 1; }
rm -rf app.old; mv app app.old; mv app.new app
echo "building $(date -u +%FT%TZ)"
docker compose up -d --build 2>&1 | grep -vE "^#[0-9]+ (sha256|extracting)" | tail -15
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8600/healthz > /dev/null; then
    echo "healthy after ${i}x5s"; curl -fsS http://127.0.0.1:8600/api/health; echo; rm -rf app.old; exit 0
  fi
  sleep 5
done
echo "not healthy after 5 minutes: rolling back to the previous version"
docker logs --tail 40 aiversepulse-api || true
rm -rf app && mv app.old app && docker compose up -d --build > /dev/null 2>&1
exit 1
