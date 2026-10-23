# Manufaction v2 architecture

Goal: a branded Node-RED product where the customer's admin can change the dashboard, settings and some logic by editing flows, and cannot break data collection.

```
 machines / simulator ──MQTT──►  CORE (Node-RED, owner only)  ──SQL──►  PostgreSQL ("warehouse")
 ERP / MES  ──REST /api/*──────►  ingestion · order counting         tables, constraints, settings
                                   downtime · alerts · work requests          ▲
                                   notifications (webhook) · REST API         │ reads + a few writes
                                                                      STUDIO (Node-RED, customer admin)
 browser ─► Caddy ─► /dashboard ─► dashboard pages  ·  /studio ─► editor (customer login)
```

## Who can do what

| | Owner (you) | Customer admin | Viewer |
|---|---|---|---|
| See the dashboard (`/dashboard`) | yes | yes | yes (basic-auth login) |
| Edit dashboard panels, SQL of panels, theme (`/studio`) | yes | yes | no |
| Change settings, fault codes, machine list (Settings page or table) | yes | yes | no |
| Edit ingestion, alert and order rules, REST API (CORE editor) | yes | **no** | no |
| Reach CORE editor | SSH tunnel to 127.0.0.1:1880 | no | no |

Three layers of protection keep the customer from breaking production:
1. **Separate runtime.** CORE and STUDIO are different containers. A broken Studio flow cannot stop MQTT ingestion.
2. **Separate logins.** CORE's editor is not on the internet; Studio has its own login.
3. **Restricted database user.** Studio connects as `mf_studio`: read everything; write only `settings`, `reason_codes`, and a few columns of `assets`/`areas`. It cannot touch orders, telemetry, downtime or alerts (tested).

## Where logic lives

| Concern | Where | Changed by |
|---|---|---|
| Tables, constraints, uniqueness ("one open order per machine") | `postgres/init/001_schema.sql` | developer (migration) |
| Tuning: offline timeout, which statuses alert, yield target, retention, default assignee | `mf.settings` | customer, via Settings page |
| Fault catalogue: code, meaning, severity, who is assigned | `mf.reason_codes` | customer, via Settings page |
| Machine list | `mf.assets`, `mf.areas` | customer, via Settings page; machine must also publish MQTT |
| Ingestion, counting, alert / recovery / work-request rules, ERP receipts, webhook delivery, REST API | CORE flows | owner |
| What the dashboard shows and how it looks | STUDIO flows (SQL + Vue templates) | customer admin |

CORE reloads settings every 10 s, so a setting change takes effect without a restart.

## How the two instances talk

Through the database only. CORE writes facts (events, downtime, notifications); STUDIO reads them (every 3 s per panel) and the pop-up flow watches `mf.notifications`. There is no direct HTTP between them, so nothing to secure or break there.

## Honest limits

- The dashboard polls the database (3 s). Fine for tens of machines; for hundreds, move to push (MQTT or a CORE-side websocket).
- CORE currently connects as the database owner. A least-privilege `mf_core` role is the next hardening step.
- The Studio SQL is visible to the customer admin, who can read all tables, including telemetry. If a customer must not see something, restrict it with a view and a grant.
- "Customer-editable logic" in v2 means settings, fault rules and the UI. Adding new automation (for example "page the supervisor when scrap exceeds 5%") is possible in Studio only for things Studio is allowed to write; anything that must write production data goes through CORE (owner) or a purpose-built API endpoint.

## Known unknowns (first real run)

Tested against real PostgreSQL with a small flow simulator, never inside real Node-RED or Dashboard 2. Most likely places for a first-run surprise, in order:
1. **PostgreSQL config node credentials.** `studio/data/flows.json` sets host/user/password as `${PGHOST}` etc. and `flows_cred.json` also carries user/password placeholders. If the Studio editor shows the database node as red, open it and check those fields.
2. **Dashboard 2 widgets.** Property names were checked against the Dashboard 2 source (v1.34), but the layout and the Vue templates have not been seen in a browser. Expect small CSS tweaks.
3. **Caddy proxying `/studio` websockets** (the editor's live link). Should work with `reverse_proxy`; if the editor shows "connection lost", look at Caddy logs.
4. **Alert delivery** to a real Slack/ntfy endpoint (tested against a stub only).
