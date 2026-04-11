#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bam}"
APP_USER="${APP_USER:-bam}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
SERVICE_NAME="${SERVICE_NAME:-bam-app}"
RESTART_DELAY_SECONDS="${RESTART_DELAY_SECONDS:-2}"

if [ "$#" -ne 1 ]; then
  echo "USAGE"
  exit 1
fi

NEXT_APP_URL="$1"

node -e 'new URL(process.argv[1])' "$NEXT_APP_URL" > /dev/null 2>&1 || {
  echo "INVALID_URL"
  exit 1
}

mkdir -p "$APP_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

BAM_ENV_FILE="$ENV_FILE" BAM_NEXT_APP_URL="$NEXT_APP_URL" node <<'NODE'
const fs = require("node:fs");

const envPath = process.env.BAM_ENV_FILE;
const nextAppUrl = process.env.BAM_NEXT_APP_URL;
const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const lines = raw === "" ? [] : raw.split(/\r?\n/);
const nextLines = [];
let replaced = false;

for (const line of lines) {
  if (!line) {
    nextLines.push(line);
    continue;
  }

  if (line.startsWith("BAM_APP_URL=")) {
    if (!replaced) {
      nextLines.push(`BAM_APP_URL=${nextAppUrl}`);
      replaced = true;
    }
    continue;
  }

  nextLines.push(line);
}

if (!replaced) {
  nextLines.push(`BAM_APP_URL=${nextAppUrl}`);
}

fs.writeFileSync(envPath, `${nextLines.filter((line, index, array) => !(index === array.length - 1 && line === "")).join("\n")}\n`, { mode: 0o600 });
NODE

chown "$APP_USER":"$APP_USER" "$ENV_FILE" 2>/dev/null || true
nohup /bin/sh -c "sleep ${RESTART_DELAY_SECONDS}; systemctl restart '${SERVICE_NAME}'" > /dev/null 2>&1 &
echo "OK"
