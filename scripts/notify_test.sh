#!/usr/bin/env bash
# Send a test alert through the webhook you configured (MF_NOTIFY_WEBHOOK_URL in .env).
# Delivery runs every 5 seconds, so allow a few seconds, then check your channel.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
[[ -n "${MF_NOTIFY_WEBHOOK_URL:-}" ]] || { echo "MF_NOTIFY_WEBHOOK_URL is empty in .env. Set it, then: docker compose up -d core"; exit 1; }
ID=$(docker compose exec -T postgres psql -U manufaction -d manufaction -t -A -c \
  "INSERT INTO mf.notifications (kind, severity, title, message) VALUES ('test','info','Manufaction test alert','If you can read this, alert delivery works.') RETURNING id" | head -1)
echo "Queued test notification #$ID. Waiting for delivery..."
for _ in 1 2 3 4 5 6; do
  sleep 3
  ROW=$(docker compose exec -T postgres psql -U manufaction -d manufaction -t -A -F '|' \
        -c "SELECT COALESCE(delivered_at::text,''), delivery_attempts, COALESCE(last_error,'') FROM mf.notifications WHERE id = $ID")
  IFS='|' read -r DONE TRIES ERR <<<"$ROW"
  if [[ -n "$DONE" ]]; then echo "Delivered (attempt $TRIES). Check your channel."; exit 0; fi
  [[ -n "$ERR" ]] && echo "  attempt $TRIES failed: $ERR"
done
echo "Not delivered yet. Is Node-RED running with the new settings (docker compose up -d core)? Check: docker compose logs core | tail -30"
exit 1
