#!/bin/sh
# Writes the frontend's runtime config from the API_BASE env var (no rebuild needed to point at another API).
set -eu
printf 'window.AP_CONFIG = { apiBase: "%s" };\n' "${API_BASE:-}" > /tmp/ap-config.js
