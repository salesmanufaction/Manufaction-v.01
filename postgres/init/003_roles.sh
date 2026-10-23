#!/bin/bash
# Creates the limited database login used by the customer-facing "Studio" Node-RED.
# Runs once, on first start of an empty Postgres volume (docker-entrypoint-initdb.d).
#
# What mf_studio may do:
#   read   everything (dashboards, reports)
#   write  settings, reason_codes   (rules and tuning)
#   write  a few columns of assets and areas   (add or rename a machine)
# What it can NOT do: touch orders, telemetry, downtime, alerts or any status column. Those are
# written only by the core flows, which keeps the data trustworthy whatever the customer builds.
set -euo pipefail
: "${STUDIO_DB_PASSWORD:?STUDIO_DB_PASSWORD is not set}"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="$STUDIO_DB_PASSWORD" <<'SQL'
CREATE ROLE mf_studio LOGIN PASSWORD :'pw';

GRANT USAGE ON SCHEMA mf, demo_erp TO mf_studio;
GRANT SELECT ON ALL TABLES IN SCHEMA mf, demo_erp TO mf_studio;
ALTER DEFAULT PRIVILEGES IN SCHEMA mf, demo_erp GRANT SELECT ON TABLES TO mf_studio;   -- future tables too

GRANT INSERT, UPDATE, DELETE ON mf.settings, mf.reason_codes TO mf_studio;

GRANT INSERT (site_id, area_id, asset_code, name, asset_type, manufacturer, model,
              default_part_number, ideal_cycle_seconds) ON mf.assets TO mf_studio;
GRANT UPDATE (area_id, name, asset_type, manufacturer, model,
              default_part_number, ideal_cycle_seconds) ON mf.assets TO mf_studio;
GRANT INSERT (site_id, name) ON mf.areas TO mf_studio;
GRANT UPDATE (name) ON mf.areas TO mf_studio;
SQL
echo "created role mf_studio"
