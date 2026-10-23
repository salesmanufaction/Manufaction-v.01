#!/usr/bin/env bash
# Add the three extra demo machines to a running stack, then restart the simulator so it
# starts publishing for them. New installs already include them. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T postgres psql -U manufaction -d manufaction -v ON_ERROR_STOP=1 -q \
  < postgres/demo/add_machines.sql
docker compose up -d --build simulator
echo "Done. Machines appear on the dashboard within about 30 seconds."
