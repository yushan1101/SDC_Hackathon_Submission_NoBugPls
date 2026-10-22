#!/bin/sh
# Writes the frontend's runtime config from the API_BASE env var (no rebuild needed to point at another API).
set -eu
virtual_interview_3d=${VIRTUAL_INTERVIEW_3D:-true}
case "$virtual_interview_3d" in
  true|false) ;;
  *) echo "VIRTUAL_INTERVIEW_3D must be true or false" >&2; exit 1 ;;
esac
printf 'window.AP_CONFIG = { apiBase: "%s", VIRTUAL_INTERVIEW_3D: %s };\n' "${API_BASE:-}" "$virtual_interview_3d" > /tmp/ap-config.js
