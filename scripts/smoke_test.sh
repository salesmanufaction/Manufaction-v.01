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
check "dashboard page needs login"       401 "$BASE/"
check "API rejects missing token"        401 "$BASE/api/v1/assets"
check "API rejects wrong token"          401 -H "Authorization: Bearer wrong-token" "$BASE/api/v1/assets"
check "list assets"                      200 -H "$AUTH" "$BASE/api/v1/assets"
check "get one asset"                    200 -H "$AUTH" "$BASE/api/v1/assets/PRESS-001"
check "unknown asset is 404"             404 -H "$AUTH" "$BASE/api/v1/assets/NOPE-999"
check "dashboard data"                   200 -H "$AUTH" "$BASE/api/v1/dashboard"
check "production orders"                200 -H "$AUTH" "$BASE/api/v1/production"
check "post telemetry (flat body)"       202 -H "$AUTH" -H 'content-type: application/json' \
      -d '{"asset_id":"PRESS-001","temperature":186.4,"pressure":1840}' "$BASE/api/v1/telemetry"
check "post event without type is 400"   400 -H "$AUTH" -H 'content-type: application/json' \
      -d '{"asset":"PRESS-001"}' "$BASE/api/v1/events"
check "Node-RED editor not exposed"      401 "$BASE/red/"
check "demo ERP endpoint not exposed"    401 -X POST "$BASE/demo-erp/receipts"

echo
echo "Waiting 40s for the virtual factory to produce data…"
sleep 40
curl -sk -H "$AUTH" "$BASE/api/v1/dashboard" > /tmp/mf_dash.json
python3 - /tmp/mf_dash.json <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for key in ("active_alerts", "notifications", "maintenance_requests"):
    if key not in d:
        sys.exit("dashboard is missing '%s' (old database volume? run: docker compose down -v)" % key)
for a in d["assets"]:
    o = a["active_order"] or {}
    order = "%s %s/%s" % (o.get("order_number", "-"), o.get("completed_quantity", ""), o.get("target_quantity", ""))
    print("  %-13s %-9s signals=%-2d order=%s" % (a["asset"], a["status"], len(a["signals"]), order))
q = d["quality_today"]
print("  quality today: %s good / %s scrap" % (q["good"], q["scrap"]))
PY
[[ $? -eq 0 ]] || { echo "  FAIL  could not read dashboard"; fail=$((fail+1)); }

echo; echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
