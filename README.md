# Manufaction Platform — v2

A manufacturing integration stack where **Node-RED flows are the product**: the engine runs as flows, the customer-facing dashboard and settings are Node-RED Dashboard 2 flows, and PostgreSQL is a plain data warehouse (tables, constraints, settings). Change behaviour by editing flows or a settings row, not backend code.

Two Node-RED instances, two roles ([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

```
                         INTERNET  (only 80/443 open)
                              │
                       ┌──────▼──────┐   /dashboard  (viewer login)
                       │    Caddy    │   /studio     (customer admin login)
                       └─┬─────────┬─┘   /api/*      (bearer token)
              /api/*     │         │  /dashboard, /studio
                    ┌────▼───┐  ┌──▼──────┐
                    │  CORE  │  │ STUDIO  │   customer-editable: dashboard, settings pages
                    │ owner  │  │customer │   DB user mf_studio (read all, write settings only)
                    └─┬────┬─┘  └────┬────┘
                      │    └─────────┼───────────────┐
              ┌───────▼──┐        ┌──▼───────┐  ┌────▼─────┐
              │PostgreSQL│◄───────┤ settings │  │ Mosquitto│  private network only
              │ mf.*     │        └──────────┘  └──▲────┬──┘
              └──────────┘                         │    │ commands
                                          telemetry/status/event
                                              ┌────┴────▼──┐
                                              │ Simulator  │  six machines
                                              └────────────┘
```

* **CORE** (owner only): MQTT ingestion, order counting, downtime / alert / work-request rules, webhook delivery, REST API, demo ERP. Editor reachable by SSH tunnel only.
* **STUDIO** (customer admin): the dashboard, Settings page (settings, fault codes, machines) and its editor at `/studio`.
* **PostgreSQL**: tables and constraints only. Tuning lives in `mf.settings`, the fault catalogue in `mf.reason_codes`.

## What happens when it runs

1. The **simulator** publishes status and telemetry for six machines.
2. The **demo ERP** (CORE tab) releases a work order per idle machine through the REST API; the API publishes `start_order` to the machine over MQTT.
3. Machines report `cycle_complete` events; CORE counts good/scrap parts. At target the order completes and a **production receipt** goes back to the ERP.
4. Faults create downtime with a reason code, a **work request** (`WR-YYMMDD-NNN`) assigned from the fault catalogue, and a notification (dashboard pop-up, optional webhook).
5. STUDIO reads all of it from the database every 3 s and draws it.

## Quick start (laptop or VM)

Requirements: Docker with the Compose plugin, `openssl`, `git` (on Windows use Git Bash).

```bash
git clone -b v2 https://github.com/salesmanufaction/Manufaction-v.01.git && cd Manufaction-v.01
./scripts/setup.sh                 # creates .env with random secrets, prints three logins
docker compose up -d --build
./scripts/smoke_test.sh
```

Open **https://localhost/dashboard/overview** (accept the self-signed certificate). The **Settings** page and the editor at **https://localhost/studio** use the customer login. The core editor is `ssh -L 1880:127.0.0.1:1880 you@host` then http://localhost:1880 (owner login; on a laptop just open http://localhost:1880).

**Upgrading from v0.1:** the database layout changed. `docker compose down -v` once (deletes demo data), then bring it up again. `STUDIO_DB_PASSWORD` must exist before the first start, because the restricted database user is created then.

## What the customer can do

See [`docs/CUSTOMER_GUIDE.md`](docs/CUSTOMER_GUIDE.md). In short: change settings, fault codes and machines from the Settings page; edit the SQL and look of any dashboard panel in `/studio`; add panels by copying a row.

## Recording a demo video

Storyboard: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

```bash
# .env:  SIM_DEMO_MODE=true   SIM_SPEED=3
docker compose up -d simulator
./scripts/demo_reset.sh --yes ; ./scripts/demo_seed.sh
./scripts/demo_fault.sh CNC-001 TOOL_BREAK 45     # fault on cue
```

## Alert delivery (webhook)

Faults, stops and recoveries can be pushed to where people already are. Set one URL in `.env`; nothing is sent until you do.

| Destination | `MF_NOTIFY_FORMAT` | Notes |
|---|---|---|
| Slack, Mattermost | `slack` | Create an incoming webhook, paste its URL |
| Discord | `discord` | Channel settings → Integrations → Webhooks |
| Phone push (ntfy.sh) | `text` | URL like `https://ntfy.sh/your-private-topic`; install the ntfy app and subscribe |
| Email, SMS, Teams, a CMMS, your own endpoint | `json` (default) | Point it at a Zapier or Make "catch hook", or any HTTPS endpoint; the body is the full event (`event`, `severity`, `site`, `asset`, `message`, `work_request`, `reason_code`, `occurred_at`) |

```bash
# .env
MF_NOTIFY_WEBHOOK_URL=https://hooks.slack.com/services/...     # a secret: keep it in .env only
MF_NOTIFY_FORMAT=slack
docker compose up -d core
./scripts/notify_test.sh                                       # sends a test alert and confirms delivery
```

Behaviour: each fault sends one message (`FAULT: PRESS-001 - Hydraulic oil over temperature. Work request WR-… sent to Maintenance on-call.`), a stop without a reason sends one, and a recovery sends one. Delivery runs every 5 seconds; a failed send is retried up to 5 times, 15 seconds apart, and anything older than 15 minutes is dropped so switching delivery on never replays old alerts. Sent alerts show a green "sent" on the dashboard. Messages carry plant, asset and reason information only; the webhook URL is never logged. Direct SMTP email is not built in. Use a Zapier or Make hook for email until a customer needs more.

## Deploying on a cloud VM

See [`deploy/README.md`](deploy/README.md) (one-script setup, lowest-cost VM notes, backups). Firewall: allow 22, 80, 443 only. The compose file publishes nothing else except the two editors on `127.0.0.1`.

## Working in Node-RED

CORE tabs: `00 Library & settings` (helpers, reload settings every 10 s), `01 Ingestion` (MQTT in, REST ingest), `02 Orders`, `03 Alerts`, `04 Notifications`, `05 REST API`, `06 Demo ERP`, `07 Housekeeping`. Function nodes call `global.get('db').query(sql, params)`; the helper library is in `global.get('lib')`.
STUDIO tabs: `Plant overview`, `Settings & admin`, `READ ME: your flows`.

Flows are saved to `core/data/flows.json` and `studio/data/flows.json`. Both are in Git, so commit after each change you want to keep.

**Secrets rule:** never type a password into a node. Add an env var to `.env` and `docker-compose.yml` and reference it as `${MY_VAR}`; `flows_cred.json` only holds placeholders.

## REST API v1

Every route except `/health` requires `Authorization: Bearer $MF_API_TOKEN`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/health` | Public. Includes database time. |
| GET | `/api/v1/assets`, `/api/v1/assets/:asset_code` | Live status, latest signals, active order, open downtime |
| GET | `/api/v1/production`, `/api/v1/production/:order_number` | Orders |
| GET | `/api/v1/downtime` | Downtime events |
| POST | `/api/v1/production-orders` | `{asset, order_number, target_quantity, part_number?, site?, source_system?}` → 201, 409 if the asset is busy or number exists, 400 if quantity is not 1..1000 |
| POST | `/api/v1/telemetry`, `/api/v1/status`, `/api/v1/events` | Published onto MQTT so devices and REST share one pipeline → 202 |

Broker users (created from `.env` on every start; ACL in `mosquitto/config/acl`): `nodered` full access to `mf/v1/#`; `edge` may only publish telemetry, status and events, and read commands.

## MQTT contract

`mf/v1/site/{site}/asset/{asset}/{telemetry|status|event|command}`. Machines send a status heartbeat every 15 s; a machine silent for `offline_after_seconds` (setting) shows as Offline.

## Data model (`postgres/init`)

`organizations → sites → areas → assets → asset_signals`, plus `production_orders`, `production_events`, `downtime_events`, `quality_events`, `maintenance_requests`, `notifications`, `telemetry`, `settings`, `reason_codes` and `demo_erp.production_receipts`. ISA-95-style hierarchy. Rules are **not** in SQL any more; the schema only holds structure and guarantees (for example, one open order per machine).

Init scripts run only on an **empty** volume (`docker compose down -v` resets). Add a migration tool (Sqitch/Flyway) before the first real pilot.

## Security posture

- Only Caddy is public. Postgres, MQTT and the core editor are not.
- Dashboard behind basic auth; API bearer token compared in constant time; Studio editor has its own login.
- Studio uses a restricted database user; core editor requires the owner login and is reachable by SSH tunnel only.
- MQTT has no anonymous access, per-role users and a topic ACL. All secrets live in `.env` (git-ignored).

Not done yet: TLS on MQTT for remote edges, per-client API keys, a least-privilege database user for CORE, rate limiting on `/studio`, backups beyond `deploy/backup.sh`.

## Testing

No Docker needed for the logic tests: a PostgreSQL with `001_schema.sql`, `002_seed.sql` and the `003_roles.sh` grants applied, then

```bash
node tools/flowsim/test_core.js      # 63 checks of the CORE flows on real SQL
node tools/flowsim/test_studio.js    # 38 checks of the STUDIO flows, as the restricted user
DASH=<path to node-red-dashboard> node tools/lint_flows.js core/data/flows.json studio/data/flows.json
```

`tools/flowsim` is a small Node-RED look-alike that runs function nodes and wiring. It does **not** run real Node-RED or Dashboard 2, so the first `docker compose up` is the real integration test. See "Known unknowns" in `docs/ARCHITECTURE.md`.

## Pinning

After the first successful build, pin the exact versions (`docker compose exec studio npm ls --depth=0`) in `studio/Dockerfile` and `core/Dockerfile`.

## Repository layout

```
docker-compose.yml        the whole stack (core, studio, postgres, mqtt, caddy, simulator)
.env.example              configuration template (setup.sh turns it into .env)
caddy/Caddyfile           TLS, auth, routing
core/                     CORE Node-RED: Dockerfile, data/settings.js, data/flows.json
studio/                   STUDIO Node-RED: Dockerfile, data/settings.js, data/flows.json
mosquitto/config/         broker config, ACL
postgres/init/            schema, seed (machines, settings, fault codes), restricted-role script
postgres/demo/            demo history and reset SQL
simulator/                Python virtual factory (stands in for Manufaction Edge)
scripts/                  setup, smoke test, demo helpers, notify test
tools/                    flow simulator + tests, flow linter, flow generators
docs/                     ARCHITECTURE, CUSTOMER_GUIDE, DEMO_SCRIPT
deploy/                   cheap-VM deployment
```

## Keep it separate

Build and run this only on personal hardware, personal cloud and GitHub accounts, on your own time, with synthetic data. Don't reuse employer code, tag lists, schemas or customer information.
