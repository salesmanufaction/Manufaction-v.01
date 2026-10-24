#!/usr/bin/env bash
# Set up ONE customer on a fresh Ubuntu VM (one VM per customer).
# Run as a normal sudo user, from inside a clone of this repo:
#   bash deploy/new-customer.sh <slug> <site-address> "<Brand Name>"
#   e.g. bash deploy/new-customer.sh acme acme.manufaction.com "Acme Plastics"
#
# It wraps deploy/bootstrap.sh, then makes the stack customer-ready:
#   - keeps the demo simulator and demo ERP OFF (a compose override puts the simulator behind a profile,
#     so deploy/update.sh does not bring it back)
#   - sets the brand name shown in the editors
#   - saves the generated logins to ~/manufaction-credentials-<slug>.txt (chmod 600)
# NOT done here, and still needed before real data: replace the demo organisation, site and machines
# that postgres/init/002_seed.sql loads (see docs/CUSTOMER_DEPLOYMENT.md, step 5).
# Not tested on a real VM yet: run it on a throwaway VM first.
set -euo pipefail
cd "$(dirname "$0")/.."

SLUG="${1:-}"; SITE="${2:-}"; BRAND="${3:-}"
if [[ -z "$SLUG" || -z "$SITE" || -z "$BRAND" ]]; then
  echo "Usage: bash deploy/new-customer.sh <slug> <site-address> \"<Brand Name>\""; exit 1
fi
[[ "$SLUG" =~ ^[a-z0-9-]+$ ]] || { echo "slug must be lowercase letters, digits and dashes"; exit 1; }
[[ "$SITE" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "site-address must be a DNS name"; exit 1; }
[[ "$BRAND" != *$'\n'* && "$BRAND" != *"'"* && "$BRAND" != *'$'* ]] || { echo "brand name: no quotes, dollar signs or newlines"; exit 1; }

CREDS="$HOME/manufaction-credentials-$SLUG.txt"
[[ ! -e .env ]] || { echo ".env already exists: this VM is already set up. Aborting."; exit 1; }

echo "==> Customer override (simulator off)"
cat > docker-compose.override.yml <<'YML'
# Written by deploy/new-customer.sh. Keeps the demo simulator from starting on this customer VM.
services:
  simulator:
    profiles: ["demo"]
YML

echo "==> Bootstrap (installs Docker, creates .env, starts the stack)"
( umask 077; bash deploy/bootstrap.sh "$SITE" 2>&1 | tee "$CREDS" )
chmod 600 "$CREDS"

echo "==> Customer settings"
set_kv() { KEY="$1" VAL="$2" awk 'BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VAL"]}
  index($0, k"=")==1 {print k"="v; next} {print}' .env > .env.tmp && mv .env.tmp .env; chmod 600 .env; }
set_kv MF_BRAND_NAME "$BRAND"
set_kv DEMO_ERP_ENABLED false
set_kv MF_ACME_EMAIL "${MF_ACME_EMAIL:-admin@${SITE#*.}}"

D="docker"; docker ps >/dev/null 2>&1 || D="sudo docker"
$D compose stop simulator >/dev/null 2>&1 || true
$D compose rm -f simulator >/dev/null 2>&1 || true
$D compose up -d --build

cat <<DONE

  Customer '$SLUG' is up at https://$SITE
  Logins are in $CREDS (chmod 600). Move them into your password manager, then delete that file.
  The database still holds DEMO machines. Do step 5 of docs/CUSTOMER_DEPLOYMENT.md before real data.
  Check: ./scripts/smoke_test.sh   (it expects the demo machines; some checks will fail once you replace them)
DONE
