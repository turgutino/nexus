#!/usr/bin/env bash
# One-time server preparation for Ubuntu (Oracle Cloud Always Free or any VPS).
# Run as a normal sudo-capable user:  bash deploy/server-setup.sh
set -euo pipefail

echo "==> Installing Docker, git and ufw"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git ufw
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "==> Firewall: allow SSH, HTTP, HTTPS only"
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Small servers (1 GB RAM) need swap or the image build can be killed.
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2000 ] && ! swapon --show | grep -q .; then
  echo "==> Adding 2 GB swap"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo
echo "Done. Log out and back in (so the docker group applies), then continue with DEPLOY.md step 6."
