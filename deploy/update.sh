#!/usr/bin/env bash
# Pull the latest code and rebuild. Data volumes are kept.
# Note: SQL in postgres/init only runs on an EMPTY volume, so schema changes need a migration.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
./scripts/smoke_test.sh
