#!/usr/bin/env bash
# Trigger a machine fault on demand (for the downtime demo).
# Usage: ./scripts/demo_fault.sh [ASSET] [REASON_CODE] [SECONDS]
#   ./scripts/demo_fault.sh                       # PRESS-001, random reason, 30 s
#   ./scripts/demo_fault.sh CNC-001 TOOL_BREAK 45
# Reason codes: PRESS-001 JAM|OVERTEMP|MATERIAL_SHORT   CNC-001 TOOL_BREAK|SPINDLE_LOAD|DOOR_OPEN
#               ASSEMBLY-001 PART_MISSING|TORQUE_FAIL|OPERATOR_ABSENT
# The machine must be running. The command goes over MQTT from inside the broker container,
# so the broker password never leaves it.
set -euo pipefail
cd "$(dirname "$0")/.."

ASSET="${1:-PRESS-001}"
CODE="${2:-}"
SECS="${3:-30}"
[[ "$SECS" =~ ^[0-9]+$ ]] || { echo "SECONDS must be a whole number"; exit 1; }
[[ "$ASSET" =~ ^[A-Za-z0-9_-]+$ && "$CODE" =~ ^[A-Za-z0-9_]*$ ]] || { echo "Invalid asset or reason code"; exit 1; }

PAYLOAD="{\"command\":\"inject_fault\",\"duration_seconds\":${SECS}$([[ -n "$CODE" ]] && printf ',"reason_code":"%s"' "$CODE")}"
docker compose exec -T mqtt sh -c \
  'mosquitto_pub -h localhost -u nodered -P "$MQTT_NODERED_PASSWORD" -q 1 -t "$0" -m "$1"' \
  "mf/v1/site/demo/asset/${ASSET}/command" "$PAYLOAD"
echo "Fault sent to ${ASSET}${CODE:+ ($CODE)} for ${SECS}s. Watch the dashboard."
