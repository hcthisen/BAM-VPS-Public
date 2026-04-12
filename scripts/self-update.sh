#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
APP_USER="${APP_USER:-bam}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
RESTART_DELAY_SECONDS="${RESTART_DELAY_SECONDS:-4}"
TEMP_DIR=""
BACKUP_DIR=""

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    git -C "$APP_DIR" worktree remove --force "$TEMP_DIR" >/dev/null 2>&1 || rm -rf "$TEMP_DIR"
  fi

  if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    rm -rf "$BACKUP_DIR"
  fi
}

fail() {
  echo "$1"
  exit 1
}

restore_ownership() {
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR" >/dev/null 2>&1 || true
}

restore_runtime_artifacts() {
  if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
    return
  fi

  rm -rf "$APP_DIR/node_modules" "$APP_DIR/.next"

  if [ -d "$BACKUP_DIR/node_modules" ]; then
    mv "$BACKUP_DIR/node_modules" "$APP_DIR/node_modules"
  fi

  if [ -d "$BACKUP_DIR/.next" ]; then
    mv "$BACKUP_DIR/.next" "$APP_DIR/.next"
  fi
}

trap cleanup EXIT

cd "$APP_DIR"

command -v git >/dev/null 2>&1 || fail "GIT_MISSING"
command -v npm >/dev/null 2>&1 || fail "NPM_MISSING"
[ -d ".git" ] || fail "NOT_A_REPO"

git fetch origin >/dev/null 2>&1 || fail "FETCH_FAILED"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
LOCAL_HASH="$(git rev-parse HEAD)"
REMOTE_HASH="$(git rev-parse "origin/${CURRENT_BRANCH}" 2>/dev/null || true)"

[ -n "$REMOTE_HASH" ] || fail "NO_REMOTE_BRANCH"

read -r AHEAD_COUNT BEHIND_COUNT <<<"$(git rev-list --left-right --count "HEAD...origin/${CURRENT_BRANCH}")"

if [ "${AHEAD_COUNT:-0}" -gt 0 ] && [ "${BEHIND_COUNT:-0}" -gt 0 ]; then
  fail "DIVERGED"
fi

if [ "${AHEAD_COUNT:-0}" -gt 0 ]; then
  fail "LOCAL_AHEAD"
fi

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
  echo "ALREADY_UP_TO_DATE"
  exit 0
fi

TEMP_DIR="$(mktemp -d "/tmp/bam-update.XXXXXX")"
git worktree add --force --detach "$TEMP_DIR" "$REMOTE_HASH" >/dev/null 2>&1 || fail "WORKTREE_FAILED"

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$TEMP_DIR/.env"
fi

(
  cd "$TEMP_DIR"
  npm ci --ignore-scripts >/dev/null 2>&1
) || fail "NPM_FAILED"

(
  cd "$TEMP_DIR"
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build >/dev/null 2>&1
) || fail "BUILD_FAILED"

git reset --hard "$REMOTE_HASH" >/dev/null 2>&1 || fail "PULL_FAILED"

BACKUP_DIR="$(mktemp -d "$APP_DIR/.update-backup.XXXXXX")"

if [ -d "$APP_DIR/node_modules" ]; then
  mv "$APP_DIR/node_modules" "$BACKUP_DIR/node_modules"
fi

if [ -d "$APP_DIR/.next" ]; then
  mv "$APP_DIR/.next" "$BACKUP_DIR/.next"
fi

if ! cp -a "$TEMP_DIR/node_modules" "$APP_DIR/node_modules"; then
  restore_runtime_artifacts
  fail "SYNC_FAILED"
fi

if ! cp -a "$TEMP_DIR/.next" "$APP_DIR/.next"; then
  restore_runtime_artifacts
  fail "SYNC_FAILED"
fi

restore_ownership

npm run migrate >/dev/null 2>&1 || fail "MIGRATE_FAILED"
npm run backfill:secrets >/dev/null 2>&1 || fail "BACKFILL_FAILED"
npm run seed:reference >/dev/null 2>&1 || fail "SEED_FAILED"

restore_ownership

nohup /bin/sh -c "sleep ${RESTART_DELAY_SECONDS}; systemctl restart bam-app bam-worker" >/dev/null 2>&1 &
NEW_HASH="$(git rev-parse --short HEAD)"
echo "OK:${NEW_HASH}"
