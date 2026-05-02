#!/usr/bin/env bash

set -euo pipefail

VPS_HOST="${VPS_HOST:-deploy@77.42.30.181}"
VPS_KEY="${VPS_KEY:-$HOME/.ssh/id_ed25519_hetzner_key}"
APP_DIR="${APP_DIR:-/opt/iso-demo}"
APP_DOMAIN="${APP_DOMAIN:-iso.razroo.com}"

SSH_OPTS=(
  -i "$VPS_KEY"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
)

npm run demo:build

ssh "${SSH_OPTS[@]}" "$VPS_HOST" "sudo mkdir -p '$APP_DIR/public' && sudo chown -R deploy:deploy '$APP_DIR'"

rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  dist-demo/ "$VPS_HOST:$APP_DIR/public/"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" "APP_DOMAIN='$APP_DOMAIN' APP_DIR='$APP_DIR' bash -s" <<'REMOTE'
set -euo pipefail

cat > /tmp/iso-site.caddy <<EOF
${APP_DOMAIN} {
  encode zstd gzip
  root * ${APP_DIR}/public
  try_files {path} /index.html
  file_server

  header {
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
}
EOF

sudo mv /tmp/iso-site.caddy "/etc/caddy/sites/${APP_DOMAIN}.caddy"
sudo chown root:root "/etc/caddy/sites/${APP_DOMAIN}.caddy"
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
REMOTE
