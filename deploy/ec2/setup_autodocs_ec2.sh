#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
OVERRIDE_FILE="$SCRIPT_DIR/docker-compose.override.yml"

BACKEND_PUBLIC_PORT="${BACKEND_PUBLIC_PORT:-4100}"
WIKI_PUBLIC_PORT="${WIKI_PUBLIC_PORT:-3100}"
SKIP_CLOUDFLARED="${SKIP_CLOUDFLARED:-0}"

API_SERVICE_NAME="cloudflared-autodocs-api"
WIKI_SERVICE_NAME="cloudflared-autodocs-wiki"

log() {
  printf "\n[%s] %s\n" "$(date +%H:%M:%S)" "$1"
}

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

get_env() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE"
  fi
}

upsert_env() {
  local key="$1"
  local value="$2"
  local escaped

  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  escaped="${escaped//|/\\|}"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

ensure_default() {
  local key="$1"
  local default_value="$2"
  local current
  current="$(get_env "$key" || true)"
  if [[ -z "$current" ]]; then
    upsert_env "$key" "$default_value"
  fi
}

set_from_shell_if_present() {
  local key="$1"
  local value="${!key-}"
  if [[ -n "$value" ]]; then
    upsert_env "$key" "$value"
  fi
}

detect_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi

  fail "Neither 'docker compose' nor 'docker-compose' is available on this host."
}

write_override_compose() {
  cat > "$OVERRIDE_FILE" <<EOF
services:
  backend:
    ports:
      - "${BACKEND_PUBLIC_PORT}:4000"
  wiki:
    ports:
      - "${WIKI_PUBLIC_PORT}:3000"
EOF
}

write_cloudflared_unit() {
  local service_name="$1"
  local description="$2"
  local port="$3"
  local cf_bin="$4"
  local unit_path="/etc/systemd/system/${service_name}.service"

  sudo tee "$unit_path" >/dev/null <<EOF
[Unit]
Description=${description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=${cf_bin} tunnel --no-autoupdate --url http://localhost:${port}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

extract_trycloudflare_url() {
  local service_name="$1"
  sudo journalctl -u "${service_name}.service" -n 200 --no-pager \
    | grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' \
    | tail -1 || true
}

log "Preparing environment file"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  log "Created $ENV_FILE from template"
fi

# Apply values passed as shell env vars (optional).
for key in API_DOMAIN WIKI_DOMAIN FRONTEND_URL CORS_ORIGINS POSTGRES_PASSWORD WIKI_API_TOKEN \
  CEREBRAS_API_KEY GROQ_API_KEY OPENROUTER_API_KEY DEFAULT_LLM_PROVIDER; do
  set_from_shell_if_present "$key"
done

# Safe defaults
ensure_default API_DOMAIN "unused.local"
ensure_default WIKI_DOMAIN "unused.local"
ensure_default DEFAULT_LLM_PROVIDER "cerebras"

# Required values
MISSING=()
for key in FRONTEND_URL CORS_ORIGINS POSTGRES_PASSWORD WIKI_API_TOKEN; do
  value="$(get_env "$key" || true)"
  if [[ -z "$value" ]]; then
    MISSING+=("$key")
  fi
done

if [[ "${#MISSING[@]}" -gt 0 ]]; then
  echo
  echo "Missing required values in $ENV_FILE:"
  for key in "${MISSING[@]}"; do
    echo "  - $key"
  done
  echo
  echo "Set them in $ENV_FILE or export them before running this script."
  exit 1
fi

if [[ -z "$(get_env CEREBRAS_API_KEY)" && -z "$(get_env GROQ_API_KEY)" && -z "$(get_env OPENROUTER_API_KEY)" ]]; then
  log "Warning: no LLM API key is set. Generation will fail until one is configured."
fi

log "Writing docker compose override with non-conflicting ports"
write_override_compose

COMPOSE_CMD="$(detect_compose_cmd)"
log "Using compose command: ${COMPOSE_CMD}"

log "Building and starting autodocs services (db, wiki, backend)"
if [[ "$COMPOSE_CMD" == "docker compose" ]]; then
  docker compose --env-file "$ENV_FILE" up -d --build db wiki backend
else
  docker-compose --env-file "$ENV_FILE" up -d --build db wiki backend
fi

if [[ "$SKIP_CLOUDFLARED" == "1" ]]; then
  log "SKIP_CLOUDFLARED=1, skipping cloudflared systemd setup."
else
  CF_BIN="$(command -v cloudflared || true)"
  if [[ -z "$CF_BIN" ]]; then
    log "cloudflared not found on PATH, skipping tunnel unit setup."
  else
    log "Creating/updating cloudflared systemd units"
    write_cloudflared_unit "$API_SERVICE_NAME" "Cloudflared Tunnel (autodocs api)" "$BACKEND_PUBLIC_PORT" "$CF_BIN"
    write_cloudflared_unit "$WIKI_SERVICE_NAME" "Cloudflared Tunnel (autodocs wiki)" "$WIKI_PUBLIC_PORT" "$CF_BIN"

    sudo systemctl daemon-reload
    sudo systemctl enable --now "${API_SERVICE_NAME}.service" "${WIKI_SERVICE_NAME}.service"

    sleep 3
    API_URL="$(extract_trycloudflare_url "$API_SERVICE_NAME")"
    WIKI_URL="$(extract_trycloudflare_url "$WIKI_SERVICE_NAME")"

    log "Tunnel URLs (trycloudflare, ephemeral)"
    echo "API_URL=${API_URL:-<not-detected-yet>}"
    echo "WIKI_URL=${WIKI_URL:-<not-detected-yet>}"
  fi
fi

log "Done"
echo
echo "Verification commands:"
echo "  curl -fsS http://localhost:${BACKEND_PUBLIC_PORT}/api/health"
echo "  docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'"
echo
echo "If using Vercel, set:"
echo "  VITE_API_URL=<API_URL>"
echo "  VITE_WIKI_URL=<WIKI_URL>"
