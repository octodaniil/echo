#!/usr/bin/env bash
# Installs / updates the Echo server stack on Ubuntu.
# Usage: sudo ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo ./install.sh" >&2
  exit 1
fi

# 1. Docker (from Ubuntu repositories).
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo ">> Installing Docker..."
  apt-get update
  apt-get install -y docker.io docker-compose-v2
  systemctl enable --now docker
fi

# 2. .env with a generated LiveKit secret.
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  sed -i "s/^LIVEKIT_API_SECRET=.*/LIVEKIT_API_SECRET=$(openssl rand -hex 32)/" .env
  echo ">> Created .env with a fresh LiveKit secret."
fi

set -a; source .env; set +a

if [[ -z "${DUCKDNS_TOKEN:-}" ]]; then
  echo ""
  echo "!! DUCKDNS_TOKEN is empty. Put your token from duckdns.org into .env:"
  echo "     nano $(pwd)/.env"
  echo "   then run this script again."
  exit 1
fi

# 3. Make sure the ports we need are free (ignore ones already held by our own containers).
if ! docker compose ps --quiet 2>/dev/null | grep -q .; then
  busy=""
  for p in 80 8443 3000 7880 7881; do
    if ss -tlnH "sport = :$p" | grep -q .; then busy+=" $p/tcp"; fi
  done
  if [[ -n "$busy" ]]; then
    echo "!! These ports are already in use:$busy" >&2
    ss -tlnpH | grep -E ":(80|8443|3000|7880|7881)\b" >&2 || true
    exit 1
  fi
fi

# 4. Firewall (only if ufw is active).
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo ">> Opening ports in ufw..."
  ufw allow 80/tcp
  ufw allow 8443/tcp
  ufw allow 7881/tcp
  ufw allow 50000:50100/udp
fi

# 5. Start / update.
echo ">> Building and starting containers..."
docker compose pull --ignore-buildable
docker compose up -d --build --remove-orphans

echo ""
echo ">> Done. Status:"
docker compose ps
echo ""
echo "Check: curl https://${ECHO_DOMAIN}:8443/api/health"
echo "First admin invite: sudo ./admin.sh invite --admin"
