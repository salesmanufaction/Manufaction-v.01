#!/usr/bin/env bash
# Run ONCE on a fresh Ubuntu 22.04/24.04 VM (x86 or ARM), as a normal sudo user:
#   curl -fsSL https://raw.githubusercontent.com/salesmanufaction/Manufaction-v.01/main/deploy/bootstrap.sh -o bootstrap.sh
#   bash bootstrap.sh [site-address]
# If the repo is private, clone it yourself first and run deploy/bootstrap.sh from inside it.
# Without an address it uses <public-ip>.sslip.io, a free DNS name that needs no domain purchase.
set -euo pipefail

REPO_URL="${MF_REPO_URL:-https://github.com/salesmanufaction/Manufaction-v.01.git}"
APP_DIR="${MF_APP_DIR:-$HOME/manufaction}"
SITE="${1:-}"

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
DOCKER="docker"; docker ps >/dev/null 2>&1 || DOCKER="sudo docker"

echo "==> Swap (small VMs run out of memory during image builds)"
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Getting the code"
if [[ -f docker-compose.yml && -d deploy ]]; then APP_DIR="$PWD"
elif [[ -d "$APP_DIR/.git" ]]; then git -C "$APP_DIR" pull --ff-only
else git clone "$REPO_URL" "$APP_DIR"; fi
cd "$APP_DIR"

if [[ -z "$SITE" ]]; then
  IP="$(curl -fsS https://api.ipify.org)"
  SITE="${IP//./-}.sslip.io"
fi
echo "==> Site address: $SITE"

if [[ ! -f .env ]]; then
  # setup.sh calls plain "docker"; run it under sudo if this shell is not in the docker group yet
  if [[ "$DOCKER" == "docker" ]]; then ./scripts/setup.sh "$SITE"; else sudo ./scripts/setup.sh "$SITE"; sudo chown "$USER" .env; fi
else
  echo ".env exists, keeping it."
fi

echo "==> Starting the stack (first build takes a few minutes)"
$DOCKER compose up -d --build

echo "==> Nightly backup at 02:30"
chmod +x deploy/*.sh scripts/*.sh
( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' ; echo "30 2 * * * $APP_DIR/deploy/backup.sh >> $HOME/manufaction-backups/backup.log 2>&1" ) | crontab -
mkdir -p "$HOME/manufaction-backups"

cat <<DONE

  Done. Open: https://$SITE   (the certificate can take a minute on first visit)
  Check:     cd $APP_DIR && ./scripts/smoke_test.sh
  Logins were printed above by setup.sh. Save them now.
  Editor:    ssh -L 1880:127.0.0.1:1880 $USER@<vm-ip>  then http://localhost:1880
DONE
