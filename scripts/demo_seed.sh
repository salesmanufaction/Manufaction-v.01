#!/usr/bin/env bash
# Pre-load today's history (orders, downtime, quality, ERP receipts, alerts) so the dashboard
# looks lived-in at the start of a recording. Synthetic data; safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T postgres psql -U manufaction -d manufaction -v ON_ERROR_STOP=1 -q -t \
  < postgres/demo/seed_history.sql
