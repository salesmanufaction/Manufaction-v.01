# Manufaction demo video: storyboard (about 2 minutes)

Audience: plant managers, operations and IT leads at small and mid-size manufacturers.
Goal: they say "that's my problem". Not a tour of technology.

## Before you record
- Machine: personal laptop. Browser window only; hide bookmarks, other tabs and notifications.
- `.env`: `SIM_DEMO_MODE=true`, `SIM_SPEED=3`. Then `docker compose up -d simulator`.
- `./scripts/demo_reset.sh --yes`, wait ~30 s, then `./scripts/demo_seed.sh`.
- Open `https://localhost/?present=1`. The header shows **Simulated plant · synthetic data**; leave it visible.
- Record at 1080p. Practise once: a fault should start within ~75 s, or trigger it yourself with `./scripts/demo_fault.sh`.
- Never show a terminal, Node-RED, `.env`, or the words MQTT / PostgreSQL. Don't show any employer names, tags or data.

## Beats

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Title card, then the dashboard | "Most plants run an ERP, machines and spreadsheets that don't talk to each other. Someone re-keys the numbers, and nobody sees a problem until the shift report." |
| 0:15–0:40 | Dashboard overview: three machines, yield and downtime tiles | "This is one view of the plant, built from the systems you already own. Status, output, quality and downtime, live." |
| 0:40–1:05 | Orders panel and ERP receipts | "Here the ERP releases a work order. It goes straight to the machine, the machine runs it, and when it finishes the completed quantity goes back to the ERP. Nobody re-types anything." |
| 1:05–1:35 | Trigger a fault (`./scripts/demo_fault.sh PRESS-001 OVERTEMP` off-screen, or let demo mode do it). Red alert bar appears; point at the reason code and the work request | "Now a machine stops. We capture it the moment it happens, with the reason, and Maintenance is notified on the dashboard with a work request. No waiting for the end-of-shift report." |
| 1:35–1:50 | Fault clears: request closes, "back in production" notice, downtime tile updates | "When it's back up, the request closes and the downtime is on record. Over a month this shows what is costing you hours." |
| 1:50–2:10 | Closing card | "We connect the systems you already have, in a fixed-price four to six week pilot on three to five of your machines. Want to see what this would look like on your floor?" |

## Rules for the video
- Say "simulated plant" at least once. Prospects trust you more when you are upfront.
- Say "Maintenance is notified on the dashboard" unless you set up alert delivery (README: "Alert delivery"). With a webhook on, you can show the alert arriving in Slack or on your phone, and say that. Never claim email or SMS unless that path is actually configured and visible.
- Don't quote prices on camera; the pilot price is still a hypothesis to test in discovery calls.
- Keep the talking points about the plant's problem. Leave technology names out.

## Retakes
`./scripts/demo_reset.sh --yes && ./scripts/demo_seed.sh` gives a fresh start in under a minute.
