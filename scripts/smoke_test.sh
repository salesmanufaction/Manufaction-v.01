#!/usr/bin/env bash
# End-to-end check of a running stack. Usage: ./scripts/smoke_test.sh [base-url]
# Default base URL is https://localhost (self-signed cert accepted with -k).
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

BASE="${1:-https://${MF_SITE_ADDRESS}}"
AUTH="Authorization: Bearer ${MF_API_TOKEN}"
pass=0; fail=0
check() {  # name expected-code curl-args...
  local name="$1" want="$2"; shift 2
  local got; got=$(curl -sk -o /tmp/mf_smoke.json -w '%{http_code}' "$@")
  if [[ "$got" == "$want" ]]; then echo "  PASS  $name ($got)"; pass=$((pass+1))
  else echo "  FAIL  $name (wanted $want, got $got): $(head -c 200 /tmp/mf_smoke.json)"; fail=$((fail+1)); fi
}

echo "Manufaction smoke test against $BASE"
check "health is public"                 200 "$BASE/api/v1/health"
check "dashboard needs login"            401 "$BASE/dashboard/overview"
check "studio editor needs its own login" 401 "$BASE/studio/flows"
check "API rejects missing token"        401 "$BASE/api/v1/assets"
check "API rejects wrong token"          401 -H "Authorization: Bearer wrong-token" "$BASE/api/v1/assets"
check "list assets"                      200 -H "$AUTH" "$BASE/api/v1/assets"
check "get one asset"                    200 -H "$AUTH" "$BASE/api/v1/assets/PRESS-001"
check "unknown asset is 404"             404 -H "$AUTH" "$BASE/api/v1/assets/NOPE-999"
check "downtime events"                  200 -H "$AUTH" "$BASE/api/v1/downtime"
check "production orders"                200 -H "$AUTH" "$BASE/api/v1/production"
check "post telemetry (flat body)"       202 -H "$AUTH" -H 'content-type: application/json' \
      -d '{"asset_id":"PRESS-001","temperature":186.4,"pressure":1840}' "$BASE/api/v1/telemetry"
check "post event without type is 400"   400 -H "$AUTH" -H 'content-type: application/json' \
      -d '{"asset":"PRESS-001"}' "$BASE/api/v1/events"
check "core editor not exposed"          401 "$BASE/red/"
check "demo ERP endpoint not exposed"    401 -X POST "$BASE/demo-erp/receipts"

echo
echo "Waiting 40s for the virtual factory to produce data…"
sleep 40
curl -sk -H "$AUTH" "$BASE/api/v1/assets" > /tmp/mf_assets.json
read -r -d '' PYCODE <<'PY'
import json, sys
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else d.get("assets", d.get("data", []))
if not rows:
    sys.exit("no assets returned")
live = 0
for a in rows:
    code = a.get("asset_code") or a.get("asset") or "?"
    st = a.get("status", "?")
    live += st not in ("offline", "?")
    print("  %-13s %s" % (code, st))
if not live:
    sys.exit("every machine is offline (is the simulator running? docker compose logs simulator)")
PY
# Use host Python if it really works (the Windows Store stub does not); otherwise the simulator container's.
if python3 -c 'import sys' >/dev/null 2>&1; then PYRUN=(python3 -c "$PYCODE")
else PYRUN=(docker compose exec -T simulator python -c "$PYCODE"); fi
"${PYRUN[@]}" < /tmp/mf_assets.json
[[ $? -eq 0 ]] || { echo "  FAIL  machines are not reporting"; fail=$((fail+1)); }

echo; echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
