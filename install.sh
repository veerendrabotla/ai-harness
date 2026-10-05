#!/usr/bin/env bash
# AI Harness one-line installer (Linux/macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.sh | bash
#
# Downloads the release compose file, generates a .env with fresh secrets, and
# boots the full stack from prebuilt GHCR images. No repository clone needed.
#
# Env overrides:
#   AI_H_INSTALL_DIR   install directory        (default: ~/.ai-harness)
#   AI_H_BASE_URL      raw file base URL        (default: repo main branch)
#   AI_H_CONFIG_ONLY   "1" = generate files + validate compose, skip boot
#   AI_H_PORT_WEB/API/PG/REDIS/GW   host ports  (default: 3000/4000/5432/6379/4010)
set -euo pipefail

BASE="${AI_H_BASE_URL:-https://raw.githubusercontent.com/veerendrabotla/ai-harness/main}"
DIR="${AI_H_INSTALL_DIR:-$HOME/.ai-harness}"
CONFIG_ONLY="${AI_H_CONFIG_ONLY:-}"

die() { echo "error: $1" >&2; exit 1; }

echo "==> AI Harness installer"

command -v docker >/dev/null 2>&1 || die "Docker is required. Install it from https://docs.docker.com/get-docker/ and re-run."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose, not docker-compose)."
command -v curl >/dev/null 2>&1 || die "curl is required."

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1; }

WEB="${AI_H_PORT_WEB:-3000}"
API="${AI_H_PORT_API:-4000}"
PG="${AI_H_PORT_PG:-5432}"
REDIS="${AI_H_PORT_REDIS:-6379}"
GW="${AI_H_PORT_GW:-4010}"

if [ -z "${AI_H_PORT_WEB:-}" ]; then
  busy=""
  port_busy "$WEB" && busy="$busy $WEB"
  port_busy "$API" && busy="$busy $API"
  port_busy "$PG" && busy="$busy $PG"
  port_busy "$REDIS" && busy="$busy $REDIS"
  port_busy "$GW" && busy="$busy $GW"
  if [ -n "$busy" ]; then
    echo "==> Ports busy on this machine:$busy — using +100 offset"
    WEB=$((WEB + 100)); API=$((API + 100)); PG=$((PG + 100)); REDIS=$((REDIS + 100)); GW=$((GW + 100))
  fi
fi

mkdir -p "$DIR"
cd "$DIR"
export COMPOSE_FILE=docker-compose.release.yml
echo "==> Installing to $DIR (web=$WEB api=$API)"

curl -fsSL "$BASE/docker-compose.release.yml" -o docker-compose.release.yml \
  || die "could not download docker-compose.release.yml"
curl -fsSL "$BASE/.env.example" -o .env.example \
  || die "could not download .env.example"

rand() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$1"
  else
    head -c $(( $1 * 3 / 4 )) /dev/urandom | base64 | tr -d '\n'
  fi
}

JWT_ACCESS_SECRET="$(rand 48)"
CSRF_SECRET="$(rand 48)"
ENCRYPTION_KEY="$(rand 32)"
BRIDGE_INTERNAL_TOKEN="$(rand 48)"

: > .env
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    JWT_ACCESS_SECRET=*)      echo "JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET" >> .env ;;
    CSRF_SECRET=*)            echo "CSRF_SECRET=$CSRF_SECRET" >> .env ;;
    ENCRYPTION_KEY=*)         echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env ;;
    BRIDGE_INTERNAL_TOKEN=*)  echo "BRIDGE_INTERNAL_TOKEN=$BRIDGE_INTERNAL_TOKEN" >> .env ;;
    FRONTEND_ORIGIN=*)        echo "FRONTEND_ORIGIN=http://localhost:$WEB" >> .env ;;
    API_BASE_URL=*)           echo "API_BASE_URL=http://localhost:$API" >> .env ;;
    NEXT_PUBLIC_API_URL=*)    echo "NEXT_PUBLIC_API_URL=http://localhost:$API" >> .env ;;
    AI_H_PORT_*)              ;;
    *)                        echo "$line" >> .env ;;
  esac
done < .env.example
{
  echo "AI_H_PORT_WEB=$WEB"
  echo "AI_H_PORT_API=$API"
  echo "AI_H_PORT_PG=$PG"
  echo "AI_H_PORT_REDIS=$REDIS"
  echo "AI_H_PORT_GW=$GW"
} >> .env
echo "==> .env created with fresh secrets"

if [ -n "$CONFIG_ONLY" ]; then
  docker compose config -q || die "compose validation failed"
  echo "==> Config-only mode: compose file validated, not booting."
  exit 0
fi

echo "==> Pulling images and starting the stack (first run downloads ~1 GB)..."
docker compose pull
docker compose up -d

echo "==> Waiting for the API to become healthy..."
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:$API/healthz" 2>/dev/null | grep -q '"status":"ok"'; then
    web_code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB" || true)"
    if [ "$web_code" = "200" ]; then
      echo ""
      echo "AI Harness is up and running."
      echo "  Web app:  http://localhost:$WEB"
      echo "  API docs: http://localhost:$API/docs"
      echo "  Stop:     docker compose -f $DIR/docker-compose.release.yml down"
      echo "  Update:   docker compose -f $DIR/docker-compose.release.yml pull && docker compose -f $DIR/docker-compose.release.yml up -d"
      exit 0
    fi
    echo "    API healthy, frontend not ready yet (got $web_code)..."
  else
    echo "    waiting... ($i/60)"
  fi
  sleep 5
done

echo "error: stack did not become healthy in time. Recent logs:" >&2
docker compose logs --tail 60 migrate api frontend >&2 || true
exit 1
