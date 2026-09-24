#!/usr/bin/env bash
# Применить deploy/nginx/miraflores.conf на VPS (Socket.IO, API, uploads, …).
#
# Usage:
#   ./deploy/scripts/apply-nginx.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

load_deploy_env
setup_ssh
verify_deploy_ssh

CONF_LOCAL="$MONO_ROOT/deploy/nginx/miraflores.conf"
[[ -f "$CONF_LOCAL" ]] || { echo "error: нет $CONF_LOCAL" >&2; exit 1; }

log "rsync nginx → $DEPLOY_HOST"
"${RSYNC[@]}" "$CONF_LOCAL" "$DEPLOY_HOST:/tmp/miraflores.conf"

log "install + reload nginx"
"${SSH[@]}" "$DEPLOY_HOST" bash -s <<'REMOTE'
set -euo pipefail
SITE_AVAILABLE="/etc/nginx/sites-available/miraflores"
SITE_ENABLED="/etc/nginx/sites-enabled/miraflores"
install -m 644 /tmp/miraflores.conf "$SITE_AVAILABLE"
ln -sf "$SITE_AVAILABLE" "$SITE_ENABLED"
# Старый дубль после неудачного apply — иначе duplicate upstream.
rm -f /etc/nginx/sites-enabled/miraflores-shop.com.conf
rm -f /etc/nginx/sites-available/miraflores-shop.com.conf
rm -f /tmp/miraflores.conf
nginx -t
systemctl reload nginx
echo "nginx: reloaded"
REMOTE

log "done"
