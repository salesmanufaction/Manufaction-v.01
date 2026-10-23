#!/usr/bin/env bash
# One-time setup: creates .env with fresh secrets and prepares folders.
# Usage: ./scripts/setup.sh [site-address]      e.g. ./scripts/setup.sh demo.manufaction.com
set -euo pipefail
cd "$(dirname "$0")/.."

SITE="${1:-localhost}"
CADDY_IMAGE="caddy:2.10.2"

if [[ -f .env ]]; then
  echo ".env already exists — leaving it alone. Delete it first to regenerate secrets."
  exit 1
fi

command -v docker >/dev/null || { echo "Docker is required."; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required."; exit 1; }

rand() { openssl rand -hex "$1"; }
bcrypt() { docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$1"; }

DASH_PW="$(rand 9)"
OWNER_PW="$(rand 9)"
CUSTOMER_PW="$(rand 9)"
echo "Hashing passwords (pulls $CADDY_IMAGE the first time)…"
DASH_HASH="$(bcrypt "$DASH_PW")"
OWNER_HASH="$(bcrypt "$OWNER_PW")"
CUSTOMER_HASH="$(bcrypt "$CUSTOMER_PW")"

# Replace KEY=... lines without letting "$" or "/" in values break anything.
set_kv() {
  KEY="$1" VAL="$2" awk 'BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VAL"]}
    index($0, k"=")==1 {print k"="v; next} {print}' .env > .env.tmp && mv .env.tmp .env
}

cp .env.example .env
set_kv MF_SITE_ADDRESS        "$SITE"
set_kv MF_BASIC_HASH          "'$DASH_HASH'"
set_kv CORE_ADMIN_HASH        "'$OWNER_HASH'"
set_kv STUDIO_ADMIN_HASH      "'$CUSTOMER_HASH'"
set_kv MF_API_TOKEN           "$(rand 24)"
set_kv POSTGRES_PASSWORD      "$(rand 18)"
set_kv STUDIO_DB_PASSWORD     "$(rand 18)"
set_kv MQTT_NODERED_PASSWORD  "$(rand 18)"
set_kv MQTT_EDGE_PASSWORD     "$(rand 18)"
chmod 600 .env

# Node-RED runs as uid 1000 inside its containers and must be able to write its folders.
if [[ "$(uname)" == "Linux" ]]; then
  for d in core/data studio/data; do chown -R 1000:1000 "$d" 2>/dev/null || sudo chown -R 1000:1000 "$d"; done
fi

cat <<EOF

  .env created for site: $SITE

  Dashboard (viewer)       admin    / $DASH_PW        https://$SITE/dashboard
  Studio editor (customer) customer / $CUSTOMER_PW    https://$SITE/studio
  Core editor (owner)      owner    / $OWNER_PW       ssh tunnel to 127.0.0.1:1880 (see README)
  API token            see MF_API_TOKEN in .env

  Save these passwords in your password manager now; only the hashes are stored.

  Next:  docker compose up -d --build
         ./scripts/smoke_test.sh
EOF
