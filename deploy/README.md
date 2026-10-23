# Deploying Manufaction to a VM

The stack is the same Docker Compose file used on a laptop. Only Caddy (80/443) is published; Postgres,
MQTT and Node-RED stay on the private Docker network, and the editor is bound to 127.0.0.1 (SSH tunnel only).
So no extra "production override" is needed. These scripts just automate the VM setup.

## Lowest-cost choice: Oracle Cloud "Always Free" (about $0)

Checked 23 Oct 2026 (re-check before you rely on it):
- Oracle cut the free Ampere A1 allowance to **2 OCPU / 12 GB** ([Linuxiac, June 2026](https://linuxiac.com/?p=214114)). That is still ample for this stack (all five images support ARM, untested here).
- It needs a credit card for sign-up, new ARM capacity is often "out of capacity" in a region, and Oracle has reclaimed or changed free resources before. Treat it as a demo box, not a customer system.
- Fallback if Oracle won't give you a VM: Hetzner's cheap CX plans are listed as unavailable and prices rose in June 2026; the CPX22 (2 vCPU, 4 GB) was about €20/month ([Findstack](https://findstack.com/resources/hetzner-price-increase-2026)). The scripts here work on any Ubuntu VM.

## Steps (Oracle)

1. Create a **personal** Oracle Cloud account (not tied to your employer).
2. Compute > Instances > Create: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** with 2 OCPU / 12 GB, assign a public IPv4, upload your SSH public key. Pick a home region carefully; it can't be changed.
3. Open the network: VCN > Subnet > Security List > add ingress rules for **TCP 80**, **TCP 443** and **UDP 443** from 0.0.0.0/0. Port 22 is already open. Do not open anything else.
4. SSH in and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/salesmanufaction/Manufaction-v.01/main/deploy/bootstrap.sh -o bootstrap.sh
   bash bootstrap.sh              # uses <ip>.sslip.io, or: bash bootstrap.sh demo.yourdomain.com
   ```
   For a private repo, `git clone` it first (with a token or deploy key) and run `bash deploy/bootstrap.sh` inside it.
5. Open the URL it prints and log in with the dashboard password setup.sh printed.
6. `./scripts/smoke_test.sh`. For a recording run: set `SIM_DEMO_MODE=true` in `.env`, `docker compose up -d simulator`, then `./scripts/demo_seed.sh`.

## Using your own domain
Create an A record to the VM's IP and pass the name to bootstrap.sh (or change `MF_SITE_ADDRESS` in `.env` and run `docker compose up -d caddy`). The free `sslip.io` name works for demos; a prospect may find it odd in the address bar.

## Day-to-day
| Task | Command |
|---|---|
| Update | `./deploy/update.sh` |
| Logs | `docker compose logs -f nodered` |
| Backup now | `./deploy/backup.sh` (also nightly via cron, last 7 kept) |
| Copy backups off the VM | `rsync -av user@vm:manufaction-backups/ ./backups/` |
| Restore | `gunzip -c file.sql.gz \| docker compose exec -T postgres psql -U manufaction -d manufaction` (into an empty DB) |
| Node-RED editor | `ssh -L 1880:127.0.0.1:1880 user@vm`, then http://localhost:1880 |

## Notes
- Don't use `ufw` to protect container ports: Docker publishes ports around it. The cloud security list is the real firewall; keep it to 22/80/443.
- Restrict port 22 in the security list to your own IP if you can.
- Set `MF_NOTIFY_WEBHOOK_URL` in the VM's `.env` only, never in Git.
- `.env` holds all secrets and is `chmod 600`; back it up in a password manager, since a restored database still needs it.
