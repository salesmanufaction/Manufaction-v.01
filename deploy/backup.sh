#!/usr/bin/env bash
# Nightly Postgres dump, keeps the last 7. Installed in cron by bootstrap.sh.
# A copy on the same VM is not a backup: periodically pull the folder to your own machine,
#   rsync -av user@vm:manufaction-backups/ ./backups/
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$HOME/manufaction-backups"; mkdir -p "$OUT"
F="$OUT/manufaction-$(date +%F).sql.gz"
docker compose exec -T postgres pg_dump -U manufaction -d manufaction | gzip > "$F"
[[ -s "$F" ]] || { echo "backup empty"; rm -f "$F"; exit 1; }
ls -1t "$OUT"/manufaction-*.sql.gz | tail -n +8 | xargs -r rm -f
echo "$(date -Is) wrote $F"
