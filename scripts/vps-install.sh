#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bam}"
APP_USER="${APP_USER:-bam}"
ENV_FILE="$APP_DIR/.env"

log() {
  echo "[bam-vps] $*"
}

detect_default_app_url() {
  if [ -n "${BAM_APP_URL:-}" ]; then
    printf '%s\n' "$BAM_APP_URL"
    return
  fi

  local detected_ip
  detected_ip="$(curl -fs4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"

  if [ -z "$detected_ip" ] && command -v ip >/dev/null 2>&1; then
    detected_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true)"
  fi

  if [ -z "$detected_ip" ]; then
    detected_ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | head -n 1 || true)"
  fi

  if [ -n "$detected_ip" ]; then
    printf 'http://%s\n' "$detected_ip"
    return
  fi

  printf 'http://localhost\n'
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "This installer must be run as root or with sudo." >&2
    exit 1
  fi
}

install_system_packages() {
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl gnupg2 ca-certificates lsb-release git ufw openssl > /dev/null

  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v22\.'; then
    log "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null
  fi

  if ! command -v psql >/dev/null 2>&1; then
    log "Installing PostgreSQL 16"
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
    apt-get install -y -qq postgresql-16 > /dev/null
  fi

  systemctl enable --now postgresql > /dev/null

  if ! command -v caddy >/dev/null 2>&1; then
    log "Installing Caddy"
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
    echo "deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy > /dev/null
  fi
}

configure_firewall() {
  log "Configuring firewall"
  ufw allow OpenSSH > /dev/null 2>&1 || true
  ufw allow 80/tcp > /dev/null 2>&1 || true
  ufw allow 443/tcp > /dev/null 2>&1 || true
  ufw delete allow 3000/tcp > /dev/null 2>&1 || true
  ufw --force enable > /dev/null 2>&1 || true
}

ensure_app_layout() {
  log "Preparing application directory"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  fi

  if [ -f "$APP_DIR/package.json" ]; then
    cd "$APP_DIR"
  elif [ -f "$(pwd)/package.json" ] && grep -q '"bam-vps"' "$(pwd)/package.json"; then
    mkdir -p "$APP_DIR"
    cp -a "$(pwd)/." "$APP_DIR/"
    cd "$APP_DIR"
  else
    echo "No BAM-VPS package.json found. Upload or clone the repo to $APP_DIR first." >&2
    exit 1
  fi
}

bootstrap_env() {
  log "Bootstrapping production environment"
  mkdir -p "$APP_DIR"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  local default_app_url
  default_app_url="$(detect_default_app_url)"

  BAM_ENV_FILE="$ENV_FILE" BAM_DEFAULT_APP_URL="$default_app_url" node <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");

const envPath = process.env.BAM_ENV_FILE;
const defaultAppUrl = process.env.BAM_DEFAULT_APP_URL || "http://localhost";
const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const env = {};

for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const index = trimmed.indexOf("=");
  if (index < 1) continue;
  const key = trimmed.slice(0, index);
  let value = trimmed.slice(index + 1);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function setDefault(key, value) {
  if (!env[key] || !String(env[key]).trim()) {
    env[key] = value;
  }
}

setDefault("POSTGRES_PASSWORD", randomBase64Url(24));
env.DATABASE_URL = `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:5432/bam`;
env.PGHOST = "127.0.0.1";
env.PGPORT = "5432";
env.PGDATABASE = "bam";
env.PGUSER = "postgres";
env.PGPASSWORD = env.POSTGRES_PASSWORD;
setDefault("BAM_APP_URL", defaultAppUrl);
setDefault("BAM_MASTER_KEY", crypto.randomBytes(32).toString("base64"));
setDefault("BAM_SETUP_TOKEN", randomBase64Url(24));
setDefault("OPENAI_TEXT_MODEL", "gpt-5.4-mini");
setDefault("OPENAI_WRITING_MODEL", "gpt-5.4");
setDefault("OPENAI_IMAGE_MODEL", "gpt-image-1.5");
setDefault("SUPABASE_STORAGE_BUCKET", "bam-media");

if (!env.S3_SECRET_KEY && env.S3_SECRETE_KEY) {
  env.S3_SECRET_KEY = env.S3_SECRETE_KEY;
}
delete env.S3_SECRETE_KEY;

for (const key of [
  "OPENAI_API_KEY",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_API_KEY",
  "AITABLE_API_KEY",
  "AITABLE_BAM_FOLDER",
  "AITABLE_SPACE_ID",
  "S3_REGION",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_BUCKET",
  "S3_ENDPOINT",
]) {
  setDefault(key, "");
}

const orderedKeys = [
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "BAM_APP_URL",
  "BAM_MASTER_KEY",
  "BAM_SETUP_TOKEN",
  "AITABLE_API_KEY",
  "AITABLE_BAM_FOLDER",
  "AITABLE_SPACE_ID",
  "OPENAI_API_KEY",
  "OPENAI_TEXT_MODEL",
  "OPENAI_WRITING_MODEL",
  "OPENAI_IMAGE_MODEL",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_BUCKET",
  "S3_ENDPOINT",
];

const allKeys = [...orderedKeys, ...Object.keys(env).filter((key) => !orderedKeys.includes(key)).sort()];
const lines = [];
for (const key of allKeys) {
  const value = String(env[key] ?? "").replace(/\r?\n/g, "");
  lines.push(`${key}=${value}`);
}

fs.writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
NODE
}

env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-
}

dashboard_entry_path() {
  local admin_count
  admin_count="$(sudo -u postgres psql -d bam -tAc "select count(*) from admin_users" 2>/dev/null | tr -d '[:space:]' || true)"

  if [ "${admin_count:-0}" = "0" ]; then
    printf '/setup\n'
  else
    printf '/login\n'
  fi
}

configure_postgres() {
  log "Configuring PostgreSQL"
  local pg_pass
  pg_pass="$(env_value POSTGRES_PASSWORD)"

  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'bam'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE bam;" > /dev/null
  sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$pg_pass';" > /dev/null

  local pg_hba
  pg_hba="$(sudo -u postgres psql -t -c "SHOW hba_file;" | tr -d '[:space:]')"
  if [ -n "$pg_hba" ] && [ -f "$pg_hba" ] && ! grep -q "host.*bam.*127.0.0.1" "$pg_hba"; then
    echo "host  bam  postgres  127.0.0.1/32  scram-sha-256" >> "$pg_hba"
    systemctl reload postgresql
  fi
}

build_and_seed() {
  log "Installing npm dependencies"
  cd "$APP_DIR"
  npm ci --ignore-scripts

  log "Building Next.js app"
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build

  log "Running migrations, secret backfill, and reference seed"
  npm run migrate
  npm run backfill:secrets
  npm run seed:reference

  log "Pruning development dependencies"
  npm prune --omit=dev
}

configure_caddy() {
  log "Configuring Caddy"
  mkdir -p /etc/caddy

  local app_url site_address
  app_url="$(env_value BAM_APP_URL)"
  site_address="$(APP_URL="$app_url" node -e '
    try {
      const u = new URL(process.env.APP_URL);
      const host = u.hostname || "";
      const protocol = u.protocol;
      const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
      const isIpv6 = host.includes(":");
      const isIp = isIpv4 || isIpv6;
      if (!host) {
        console.log(":80");
      } else if (protocol === "https:" && !isIp && host !== "localhost" && host !== "127.0.0.1") {
        console.log(u.host);
      } else if (protocol === "http:" && (host === "localhost" || host === "127.0.0.1")) {
        console.log(":80");
      } else {
        console.log(`http://${u.host}`);
      }
    } catch {
      console.log(":80");
    }
  ')"

  cat > /etc/caddy/Caddyfile <<CADDY
# BAM Control - managed by vps-install.sh
${site_address} {
	reverse_proxy 127.0.0.1:3000
}
CADDY

  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null
  systemctl enable caddy > /dev/null
  systemctl restart caddy

  chmod +x "$APP_DIR/scripts/caddy-update.sh" "$APP_DIR/scripts/app-url-update.sh"
  cat > /etc/sudoers.d/bam-caddy <<SUDOERS
${APP_USER} ALL=(root) NOPASSWD: ${APP_DIR}/scripts/caddy-update.sh
${APP_USER} ALL=(root) NOPASSWD: ${APP_DIR}/scripts/app-url-update.sh
SUDOERS
  chmod 440 /etc/sudoers.d/bam-caddy
}

configure_systemd() {
  log "Configuring systemd services"
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
  chmod 600 "$ENV_FILE"

  cat > /etc/systemd/system/bam-app.service <<SERVICE
[Unit]
Description=BAM Control Next.js App
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=/usr/bin/node ${APP_DIR}/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SERVICE

  cat > /etc/systemd/system/bam-worker.service <<SERVICE
[Unit]
Description=BAM Control Background Worker
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=${APP_DIR}/node_modules/.bin/tsx ${APP_DIR}/src/worker/index.ts
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable bam-app bam-worker > /dev/null
  systemctl restart bam-app bam-worker
}

main() {
  require_root
  install_system_packages
  configure_firewall
  ensure_app_layout
  bootstrap_env
  configure_postgres
  build_and_seed
  configure_caddy
  configure_systemd
  local app_url entry_path setup_token
  app_url="$(env_value BAM_APP_URL)"
  entry_path="$(dashboard_entry_path)"
  setup_token="$(env_value BAM_SETUP_TOKEN)"
  log "Install complete."
  log "Open: ${app_url}${entry_path}"
  if [ "$entry_path" = "/setup" ]; then
    log "Setup token: ${setup_token}"
  fi
  log "Token/env file: ${ENV_FILE}"
  log "IP installs are served over HTTP on port 80. Domain installs use Caddy on ports 80/443. The Next.js app stays on 127.0.0.1:3000."
}

main "$@"
