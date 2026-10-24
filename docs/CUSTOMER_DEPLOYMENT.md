# Customer deployment runbook

How to host a customer's Manufaction dashboard. Status: **written, not yet run end to end on a real VM.**
Do the first run on a throwaway VM and fix what breaks before you use it for a paying customer.

## Model: one VM per customer

Each customer gets their own VM running this repo's Docker Compose stack: their own database, MQTT broker,
CORE, STUDIO and Caddy. Nothing is shared between customers.

Why: the stack is single-tenant (one organisation and one set of secrets per install), and a separate VM is the
simplest strong isolation. The marketing site stays on Cloudflare Pages and never shares a host with customer data.

When to change this: around ten customers, or when a customer's IT team requires a specific cloud, move to
AWS (or similar) with managed Postgres and snapshots. The per-customer pattern stays the same.

## Naming and DNS

- Marketing site: `manufaction.com` (Cloudflare Pages).
- Customer UI: `<slug>.manufaction.com`, an A record to the customer VM's public IP.
- Keep DNS in Cloudflare. Set the record to **DNS only** (grey cloud) until Caddy has its certificate, then decide
  whether to proxy it.
- `<slug>`: lowercase letters, digits, dashes. Never reuse a slug.

## Per-customer checklist

1. **Create the VM.** Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk or more. Public IPv4. SSH key only.
   Firewall (cloud security group, not `ufw`): inbound TCP 22 (your IP only if you can), TCP 80, TCP 443, UDP 443. Nothing else.
2. **Point DNS** `<slug>.manufaction.com` at the VM.
3. **Get the code onto the VM** (the repo is private, so use a deploy key or token):
   `git clone <repo-url> ~/manufaction && cd ~/manufaction && git checkout v2`
4. **Run the script:** `bash deploy/new-customer.sh <slug> <slug>.manufaction.com "<Customer Name>"`
   It installs Docker, creates `.env` with fresh secrets, starts the stack, keeps the demo simulator off, turns the demo ERP off,
   sets up a nightly backup, and saves the generated logins to `~/manufaction-credentials-<slug>.txt`.
   Move those into your password manager, then delete the file.
5. **Replace the demo data.** `postgres/init/002_seed.sql` loads a demo organisation, site and six machines.
   Before real data, edit the organisation, site, areas and assets to match the customer (through SQL or the Studio settings
   pages), and delete the demo machines. **There is no clean customer seed yet**; that is a gap to close before customer two.
6. **Check:** open `https://<slug>.manufaction.com/dashboard`, log in, and run `./scripts/smoke_test.sh`
   (its checks assume the demo machines, so expect some failures once you replace them).
7. **Copy backups off the VM** (see below) and write the VM, domain and credentials location into your customer register.

## Cloudflare setup (domain, website, customer subdomains)

Labels in the Cloudflare dashboard change; treat the menu names as approximate.

**One-time**
1. Buy `manufaction.com` through Cloudflare Registrar. It becomes a zone in your account with nameservers already set.
2. Turn on two-factor authentication (authenticator app or hardware key, not SMS) and DNSSEC. This account controls every customer address: do not share the login.
3. Workers & Pages > create a Pages project from the `manufaction-website` repo. No build command, output directory `/`.
4. Pages > Custom domains: add `manufaction.com` and `www.manufaction.com` (Cloudflare creates the records and certificate).
   Add a redirect rule from `www` to the bare domain.
5. Optional: Email Routing, to forward `sales@manufaction.com` to your Gmail (free; sending as that address needs Gmail "send mail as" or a paid mailbox).

**Per customer**
1. DNS > add record: type **A**, name `<slug>`, content = the customer VM's IPv4, proxy status **DNS only** (grey cloud).
2. Wait a minute, run `dig +short <slug>.manufaction.com` (should print the VM IP), then open the URL once so Caddy obtains its certificate.
3. Confirm with `curl -I https://<slug>.manufaction.com/api/v1/health` (expect 200).

**Rules**
- No wildcard `*` record: each customer is on a different server.
- Leave customer records grey while Caddy gets its certificate. Turning the proxy on is optional hardening; if you do, set SSL/TLS to **Full (strict)** (never Flexible, which loops) and test the dashboard first, since it uses WebSockets (untested here).
- Customer subdomains are public in DNS and in certificate-transparency logs. If customer names are confidential, use neutral slugs such as `c014`. Decide before the first customer; renaming later means new certificates and VM config changes.
- Keep a register: slug, customer, VM provider and ID, IP, date created, where credentials are stored.
- Create `demo.manufaction.com` first and run the whole checklist on it before any customer.

## Day-to-day

| Task | Command |
|---|---|
| Update one customer | `ssh vm`, then `cd ~/manufaction && ./deploy/update.sh` |
| Logs | `docker compose logs -f core studio` |
| Owner editor (CORE) | `ssh -L 1880:127.0.0.1:1880 user@vm`, then http://localhost:1880 |
| Backup now | `./deploy/backup.sh` |

Update customers one at a time, your own demo VM first. The database init scripts only run on an empty volume, so any
schema change needs a hand-written migration before you roll it out.

## Backups: the part that is easy to skip

- `deploy/backup.sh` writes a nightly dump on the same VM and keeps seven. **A copy on the same VM is not a backup.**
- Pull the folder to somewhere else at least weekly: `rsync -av user@vm:manufaction-backups/ ./backups/<slug>/`,
  or take a provider snapshot of the VM disk on a schedule (usually a few dollars a month).
- `.env` is **not** in the dump. Keep it in your password manager; a restored database is useless without it.
- **Restore drill:** before the first paying customer, restore a dump into a fresh VM and log in. A backup you have never restored is a hope.

## Costs (rough, verify with the provider)

One small VM per customer plus snapshots is roughly $10-40 a month. That is why the proposed Site price of about $99
per machine per month with a six-machine minimum has room for hosting, but check it against your actual bill.

## Known gaps (do not promise these to customers yet)

- No clean per-customer seed or migration tool.
- The CORE database user is the Postgres owner (not least-privilege).
- No TLS on MQTT for remote edges, no per-device logins, no store-and-forward on the edge.
- No rate limiting on `/studio`.
- No monitoring or uptime alerts. At minimum add a free external uptime check on `/api/v1/health` for each customer.
- Updates are manual and per VM; there is no fleet tooling.
