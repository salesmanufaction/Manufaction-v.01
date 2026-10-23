#!/usr/bin/env bash
# Wipe operational data for a clean take, then restart the simulator. Keeps the demo site and
# machines. THIS DELETES ALL ORDERS, EVENTS, DOWNTIME AND TELEMETRY. Requires --yes.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != "--yes" ]]; then
  echo "This deletes all orders, events, downtime, alerts and telemetry from the demo database."
  echo "Re-run with --yes to continue."
  exit 1
fi
docker compose exec -T postgres psql -U manufaction -d manufaction -v ON_ERROR_STOP=1 -q \
  < postgres/demo/reset_demo_data.sql
docker compose restart simulator
echo "Clean. Machines come online in a few seconds; the demo ERP releases fresh orders within ~20 s."
echo "Optional: ./scripts/demo_seed.sh to pre-load today's history."
