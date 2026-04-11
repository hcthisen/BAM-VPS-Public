#!/usr/bin/env bash

set -euo pipefail

CADDYFILE="/etc/caddy/Caddyfile"
TMP_CADDYFILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_CADDYFILE"
}
trap cleanup EXIT

if [ "$#" -gt 0 ]; then
  printf '%s' "$1" > "$TMP_CADDYFILE"
else
  cat > "$TMP_CADDYFILE"
fi

if ! [ -s "$TMP_CADDYFILE" ]; then
  echo "EMPTY"
  exit 1
fi

caddy validate --config "$TMP_CADDYFILE" --adapter caddyfile > /dev/null
install -m 0644 "$TMP_CADDYFILE" "$CADDYFILE"
systemctl reload caddy
echo "OK"
