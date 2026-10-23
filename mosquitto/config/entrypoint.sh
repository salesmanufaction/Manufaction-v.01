#!/bin/sh
# Builds the Mosquitto password + ACL files from environment variables on every start,
# so no credentials are committed to the repository.
set -eu

: "${MQTT_NODERED_PASSWORD:?MQTT_NODERED_PASSWORD must be set}"
: "${MQTT_EDGE_PASSWORD:?MQTT_EDGE_PASSWORD must be set}"

PW=/mosquitto/data/passwd
ACL=/mosquitto/data/acl

rm -f "$PW"
mosquitto_passwd -c -b "$PW" nodered "$MQTT_NODERED_PASSWORD"
mosquitto_passwd    -b "$PW" edge    "$MQTT_EDGE_PASSWORD"
cp /mosquitto/config/acl "$ACL"

chown mosquitto:mosquitto "$PW" "$ACL"
chmod 0700 "$PW" "$ACL"

exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
