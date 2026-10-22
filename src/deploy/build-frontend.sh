#!/bin/sh
# Builds the web app as a static site that calls one shared backend, for any extra frontend domain.
#   sh src/deploy/build-frontend.sh https://sdc.olgtx.com dist-web
# Upload dist-web/ to any static host (nginx, Cloudflare Pages, Netlify, S3 + CDN), then add the site's address on the
# admin dashboard (Frontend sites) so the backend accepts it. No build tools needed: the app is plain ES modules.
set -eu
API="${1:?usage: build-frontend.sh <backend url, e.g. https://sdc.olgtx.com> [out dir]}"
OUT="${2:-dist-web}"
API="${API%/}"
case "$API" in https://*|http://localhost*|http://127.0.0.1*) ;; *) echo "backend must be https://..." >&2; exit 1 ;; esac
HERE="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R "$HERE/web/." "$OUT/"
rm -rf "$OUT/owl/preview.html" "$OUT/owl/preview.js"
printf 'window.AP_CONFIG = { apiBase: "%s", VIRTUAL_INTERVIEW_3D: %s };\n' "$API" "${VIRTUAL_INTERVIEW_3D:-true}" > "$OUT/config.js"
# security headers for hosts that read a _headers file (Cloudflare Pages, Netlify); nginx: see deploy/nginx.conf
cat > "$OUT/_headers" <<HEADERS
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src 'self' $API https://api.stripe.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(self), geolocation=()
/config.js
  Cache-Control: no-cache
HEADERS
echo "built $OUT for $API"
