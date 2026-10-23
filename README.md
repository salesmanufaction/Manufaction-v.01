# Manufaction Platform — v0.1

A small but real manufacturing integration stack: a virtual factory publishes machine data over MQTT, Node-RED validates and routes it, PostgreSQL stores it in a common manufacturing data model, and a REST API plus a plant dashboard expose it. A demo ERP releases work orders through the API and receives production receipts back.

```
                        INTERNET  (only 80/443 open)
                            │
                     ┌──────▼──────┐
                     │    Caddy    │  HTTPS, basic auth, security headers
                     └──┬───────┬──┘
           /api/*       │       │   /  (static dashboard)
                     ┌──▼───────┴──┐
                     │  Node-RED   │  validate · route · orchestrate · REST API · demo ERP
                     └──┬───────┬──┘
                        │       │
               ┌────────▼─┐   ┌─▼──────────┐
               │PostgreSQL│   │ Mosquitto  │  private network only
               │ mf.*     │   │ MQTT 1883  │
               └──────────┘   └─▲────────┬─┘
                                │        │ commands
                     telemetry/status/event
                              ┌─┴────────▼─┐
                              │ Simulator  │  PRESS-001 · CNC-001 · ASSEMBLY-001
                              │ ("Edge")   │  → later: Raspberry Pi + OPC-UA
                              └────────────┘
```

## What happens when it runs

1. The **simulator** comes online and publishes status and telemetry for three machines.
2. The **demo ERP** (Node-RED tab 04) sees idle machines and `POST`s a work order to `/api/v1/production-orders` for each one.
3. The API stores the order and publishes a `start_order` **command** to the machine over MQTT.
4. The machine starts cycling: every cycle is a `cycle_complete` event with a quality result; random faults create downtime with reason codes.
5. `mf.ingest()` counts good/scrap parts against the order. When the target is reached the order completes, Node-RED sends `complete_order` to the machine and `POST`s a **production receipt** back to the ERP.
6. The ERP releases the next order. The dashboard shows all of it live.

That's the "Order-to-Production" and "Machine Downtime" demos from the deck, end to end.

## Quick start (laptop or VM)

Requirements: Docker with the Compose plugin, `openssl`, `git`.

```bash
git clone <your repo> manufaction-platform && cd manufaction-platform
./scripts/setup.sh                 # creates .env with random secrets, prints your logins
docker compose up -d --build
./scripts/smoke_test.sh            # 13 checks + a live data summary
```

Open **https://localhost** (accept the self-signed certificate) and log in with the dashboard credentials `setup.sh` printed.

Set `SIM_SPEED=5` in `.env` (then `docker compose up -d simulator`) to make a live demo move five times faster.

## Recording a demo video

Demo mode makes the downtime story happen on cue, and the dashboard flags it as a simulated plant. Full storyboard and talking points: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

```bash
# 1. In .env set:  SIM_DEMO_MODE=true   SIM_SPEED=3   (optional: SIM_DEMO_FAULT_EVERY=75, SIM_DEMO_FAULT_SECONDS=30)
docker compose up -d simulator            # picks up the new settings
./scripts/demo_reset.sh --yes             # clean slate (deletes all demo data)
./scripts/demo_seed.sh                    # pre-load today's history so the dashboard isn't empty
# 2. Open https://localhost/?present=1 (larger text for screen recording) and hit record.
./scripts/demo_fault.sh                   # fault a machine on cue, or let demo mode schedule one
./scripts/demo_fault.sh CNC-001 TOOL_BREAK 45     # choose machine, reason code, seconds
```

What the viewer sees when a machine faults: a red alert bar with the reason code, a **work request** raised for Maintenance on-call (`WR-…`), the machine card and downtime tiles updating, and when the machine recovers the request closes and a "back in production" notice appears. The work request is always recorded and shown on the dashboard. It is also **sent out** if you configure alert delivery (next section); without that, say "notified on the dashboard" on camera, not "texted" or "emailed".

Demo history is generated deterministically and flagged in the database, so `demo_seed.sh` is safe to re-run. It fills today only: run it more than ~30 minutes after midnight (site time).

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
docker compose up -d nodered
./scripts/notify_test.sh                                       # sends a test alert and confirms delivery
```

Behaviour: each fault sends one message (`FAULT: PRESS-001 - Hydraulic oil over temperature. Work request WR-… sent to Maintenance on-call.`), a stop without a reason sends one, and a recovery sends one. Delivery runs every 5 seconds; a failed send is retried up to 5 times, 15 seconds apart, and anything older than 15 minutes is dropped so switching delivery on never replays old alerts. Sent alerts show a green "sent" on the dashboard. Messages carry plant, asset and reason information only; the webhook URL is never logged. Direct SMTP email is not built in. Use a Zapier or Make hook for email until a customer needs more.

## Deploying on a cloud VM

1. Create a small Ubuntu VM (1–2 vCPU, 2 GB RAM is plenty) on a **personal** account.
2. Point a DNS record (e.g. `demo.yourdomain.com`) at it.
3. Firewall: allow 22, 80, 443 only. Docker-published ports bypass `ufw`, which is why this compose file publishes nothing except Caddy (and the editor on `127.0.0.1`).
4. Install Docker, clone the repo, then:
   ```bash
   ./scripts/setup.sh demo.yourdomain.com
   docker compose up -d --build
   ./scripts/smoke_test.sh
   ```
   Caddy obtains a Let's Encrypt certificate automatically. Set `MF_ACME_EMAIL` in `.env` first.

## Working in Node-RED

The editor is **never** exposed to the internet. Reach it through an SSH tunnel:

```bash
ssh -L 1880:127.0.0.1:1880 you@your-vm      # then browse to http://localhost:1880
```

Log in with the editor credentials from `setup.sh`. Flows are saved to `nodered/data/flows.json`, which is in Git, so commit after each change you want to keep.

| Tab | Purpose |
|---|---|
| 01 MQTT Ingestion | `mf/v1/site/+/asset/+/+` → validate → `mf.ingest()` → follow-up commands and ERP receipts |
| 02 API | REST API v1 (below) |
| 03 Production Engine | Re-dispatches released orders until the machine acknowledges; daily telemetry purge |
| 04 Demo ERP | Releases orders through the public API and receives production receipts |
| 05 Notifications | Sends fault and recovery alerts to a webhook (off until you set `MF_NOTIFY_WEBHOOK_URL`) |

**Secrets rule:** never type a password into a node's credential field. Add an env var to `.env` and `docker-compose.yml` and reference it as `${MY_VAR}`. `flows_cred.json` only holds placeholders, so it is safe to commit.

## REST API v1

Every route except `/health` requires `Authorization: Bearer $MF_API_TOKEN`. (Browser users who passed the dashboard login get the token added by Caddy.)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/health` | Public. Includes database time. |
| GET | `/api/v1/assets` | All assets with live status, latest signals, active order and open downtime |
| GET | `/api/v1/assets/:asset_code` | One asset (404 if unknown) |
| GET | `/api/v1/production` | Latest 50 orders |
| GET | `/api/v1/production/:order_number` | One order |
| GET | `/api/v1/dashboard?site=demo` | One consolidated object for the plant view |
| POST | `/api/v1/production-orders` | `{asset, order_number, target_quantity, part_number?, site?, source_system?}` → 201, 409 if the asset is busy or the number exists |
| POST | `/api/v1/telemetry` | `{asset, signals:{...}, units?}` or flat `{asset_id, temperature: 186.4}` → 202 |
| POST | `/api/v1/events` | `{asset, event_type, ...}` → 202 |
| POST | `/api/v1/status` | `{asset, status, reason_code?}` → 202 |

`POST` ingestion routes publish onto MQTT, so REST and MQTT input follow exactly the same path into the database.

```bash
curl -sk -H "Authorization: Bearer $MF_API_TOKEN" https://localhost/api/v1/assets/PRESS-001
```

## MQTT contract

`mf/v1/site/{site}/asset/{asset}/{telemetry|status|event|command}`. The `v1` segment lets the payload contract change later without breaking deployed edges.

```jsonc
// telemetry
{"timestamp":"2026-10-22T14:30:00Z","asset_id":"PRESS-001",
 "signals":{"temperature":186.4,"pressure":1840,"cycle_count":1247},
 "units":{"temperature":"degF","pressure":"psi"}}
// status: running | idle | stopped | faulted | maintenance | offline
{"timestamp":"…","asset_id":"PRESS-001","status":"faulted","reason_code":"JAM","reason_description":"Material jam in die"}
// event
{"timestamp":"…","asset_id":"PRESS-001","event_type":"cycle_complete","quantity":1,"quality_result":"scrap","defect_code":"BURR"}
// command (cloud → machine)
{"command":"start_order","order_number":"MO-261022-1234","part_number":"BRKT-100","target_quantity":40}
```

Broker users (created from `.env` on every start; ACL in `mosquitto/config/acl`):

- `nodered`: full access to `mf/v1/#`
- `edge`: may only publish telemetry, status and event messages, and only read commands

## Data model (`postgres/init`)

`organizations → sites → areas → assets → asset_signals`, plus `production_orders`, `production_events`, `downtime_events`, `quality_events`, `telemetry`, and `demo_erp.production_receipts`. The hierarchy follows ISA-95 (enterprise → site → area → work unit), so it maps onto the vocabulary MES and ERP vendors already use.

Write logic lives in SQL functions (`mf.ingest`, `mf.create_order`, `mf.api_*`). They're version-controlled, testable with `psql`, and shared by the MQTT and REST paths:

```bash
docker compose exec postgres psql -U manufaction -c \
  "select mf.ingest('demo','PRESS-001','status','{\"status\":\"faulted\",\"reason_code\":\"JAM\"}')"
```

Init scripts run only on an **empty** volume. During v0.1, reset with `docker compose down -v` (this deletes all data). If you started the stack before the alerts and demo-mode update, do this once so the new tables are created. Add a migration tool (e.g. Sqitch or Flyway) before the first real pilot.

## Security posture (v0.1)

- Only Caddy is public; Postgres, MQTT and the Node-RED editor are not.
- The dashboard sits behind basic auth, and the API uses a bearer token checked in constant time.
- The editor requires a login and is reachable only via SSH tunnel.
- MQTT has no anonymous access, uses per-role users and a topic ACL.
- All secrets live in `.env` (git-ignored, `chmod 600`).

Not done yet: TLS on MQTT for remote edges, per-client API keys, a least-privilege Postgres role, backups, and rate limiting. These are listed below.

## Next steps

| When | What |
|---|---|
| Before a real edge connects | Add an MQTT TLS listener on 8883 (Caddy-issued or Let's Encrypt cert) with a per-device user; publish 8883 only. |
| Before a pilot | Nightly `pg_dump` off the VM, a migration tool, a least-privilege DB role for Node-RED, per-customer API keys. |
| Edge hardware | Run Node-RED + Mosquitto on a Raspberry Pi 5. Bridge the local broker to the cloud broker over TLS (store-and-forward), and read PLCs via OPC-UA (`node-red-contrib-opcua`). |
| Standards | Evaluate Sparkplug B payloads and a Unified Namespace topic layout. Map the data model to ISA-95 explicitly. |
| Product | Replace the static dashboard with a real UI once customers tell you what they need to see. |

## Repository layout

```
docker-compose.yml        the whole stack
.env.example              configuration template (setup.sh turns it into .env)
caddy/Caddyfile           TLS, auth, routing
caddy/site/index.html     plant dashboard (no build step)
mosquitto/config/         broker config, ACL, entrypoint that builds the password file
postgres/init/            schema, functions, demo seed data
nodered/Dockerfile        Node-RED 5.0.7 + PostgreSQL node
nodered/data/             settings.js, flows.json, flows_cred.json (placeholders only)
simulator/                Python virtual factory (stands in for Manufaction Edge)
scripts/setup.sh          generate secrets
scripts/smoke_test.sh     end-to-end check
scripts/demo_fault.sh     trigger a machine fault on cue (demo)
scripts/demo_seed.sh      pre-load today's history (demo)
scripts/demo_reset.sh     wipe demo data for a clean take
scripts/notify_test.sh    send a test alert through your webhook
postgres/demo/            seed and reset SQL for the demo scripts
docs/DEMO_SCRIPT.md       storyboard for the demo video
```

## Keep it separate

Build and run this only on personal hardware, personal cloud and GitHub accounts, and on your own time, using synthetic data. Don't reuse employer code, tag lists, schemas or customer information.
