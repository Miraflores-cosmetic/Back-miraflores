#!/usr/bin/env bash
# Деплой бэка + админки (Nest + Next):
#   git push → git pull на VPS → npm ci → migrate → build → restart systemd
#   --rsync: залить с Mac без GitHub (legacy)
#
# Usage:
#   ./deploy/scripts/deploy-backend.sh
#   ./deploy/scripts/deploy-backend.sh --api
#   ./deploy/scripts/deploy-backend.sh --admin
#   ./deploy/scripts/deploy-backend.sh --skip-push
#   ./deploy/scripts/deploy-backend.sh --rsync
#   ./deploy/scripts/deploy-backend.sh -m "staff ACL"
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

load_deploy_env
setup_ssh
verify_deploy_ssh

DO_API=1
DO_ADMIN=1
DO_MIGRATE=1
DO_PUSH=1
DO_RSYNC=0
DO_FORCE_PUSH=0
COMMIT_MSG=""

usage() {
  cat <<'EOF'
Deploy backend + admin: [commit] → git push → pull on VPS → build → systemd.

  ./deploy/scripts/deploy-backend.sh
  ./deploy/scripts/deploy-backend.sh --api
  ./deploy/scripts/deploy-backend.sh --admin
  ./deploy/scripts/deploy-backend.sh --skip-push
  ./deploy/scripts/deploy-backend.sh --rsync
  ./deploy/scripts/deploy-backend.sh --force-push   # заменить origin/main (Saleor → Miraflores)
  ./deploy/scripts/deploy-backend.sh -m "описание"

Config: deploy/deploy.env (MONO_GIT_REMOTE, MONO_GIT_PUSH_KEY)
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api) DO_API=1; DO_ADMIN=0 ;;
    --admin) DO_API=0; DO_ADMIN=1 ;;
    --skip-migrate) DO_MIGRATE=0 ;;
    --skip-push) DO_PUSH=0 ;;
    --rsync) DO_RSYNC=1; DO_PUSH=0 ;;
    --force-push) DO_FORCE_PUSH=1 ;;
    -m|--commit)
      [[ $# -ge 2 && -n "${2:-}" && "$2" != -* ]] || { echo "error: $1 требует сообщение" >&2; exit 1; }
      COMMIT_MSG="$2"
      shift
      ;;
    -h|--help) usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 1 ;;
  esac
  shift
done

MONO_REMOTE="${MONO_GIT_REMOTE:-git@github.com:Miraflores-cosmetic/Back-miraflores.git}"

if [[ "$DO_RSYNC" -ne 1 && ! -d "$MONO_ROOT/.git" ]]; then
  log "нет git в монорепо → rsync (см. deploy.md / Back-miraflores)"
  DO_RSYNC=1
  DO_PUSH=0
fi

if [[ "$DO_RSYNC" -eq 1 ]]; then
  log "rsync backend + Admin + packages → $DEPLOY_HOST:$DEPLOY_PATH"
  key="${DEPLOY_SSH_KEY/#\~/$HOME}"
  RSYNC_CODE=(rsync -az -e "ssh -o RequestTTY=no -o BatchMode=yes -i '$key' -o IdentitiesOnly=yes")
  RSYNC_EXCLUDES=(
    --exclude node_modules
    --exclude .git
    --exclude .next
    --exclude dist
    --exclude .data
    --exclude '.env'
    --exclude '.env.local'
    --exclude '*.log'
    --exclude .DS_Store
  )

  "${RSYNC_CODE[@]}" "${RSYNC_EXCLUDES[@]}" \
    "$MONO_ROOT/package.json" \
    "$MONO_ROOT/package-lock.json" \
    "$DEPLOY_HOST:$DEPLOY_PATH/"

  "${RSYNC_CODE[@]}" "${RSYNC_EXCLUDES[@]}" \
    "$MONO_ROOT/backend/" \
    "$DEPLOY_HOST:$DEPLOY_PATH/backend/"

  "${RSYNC_CODE[@]}" "${RSYNC_EXCLUDES[@]}" \
    --exclude 'backend/.env' \
    "$MONO_ROOT/Admin/" \
    "$DEPLOY_HOST:$DEPLOY_PATH/Admin/"

  "${RSYNC_CODE[@]}" "${RSYNC_EXCLUDES[@]}" \
    "$MONO_ROOT/packages/" \
    "$DEPLOY_HOST:$DEPLOY_PATH/packages/"

  "${RSYNC_CODE[@]}" "${RSYNC_EXCLUDES[@]}" \
    --exclude 'deploy/deploy.env' \
    "$MONO_ROOT/deploy/" \
    "$DEPLOY_HOST:$DEPLOY_PATH/deploy/"

  SHA="rsync"
else
  [[ -d "$MONO_ROOT/.git" ]] || {
    echo "error: нет git в $MONO_ROOT — см. deploy.md (Back-miraflores)" >&2
    exit 1
  }

  if [[ -n "$COMMIT_MSG" ]]; then
    if git -C "$MONO_ROOT" diff --quiet && git -C "$MONO_ROOT" diff --cached --quiet \
      && [[ -z "$(git -C "$MONO_ROOT" status --porcelain)" ]]; then
      log "нечего коммитить в монорепо"
    else
      log "git commit (монорепо)"
      git -C "$MONO_ROOT" add -A
      git -C "$MONO_ROOT" reset HEAD -- '**/tsconfig.tsbuildinfo' 2>/dev/null || true
      git -C "$MONO_ROOT" commit -m "$COMMIT_MSG"
    fi
  fi

  if [[ "$DO_PUSH" -eq 1 ]]; then
    require_clean_git "$MONO_ROOT"
    if [[ "$DO_FORCE_PUSH" -eq 1 ]]; then
      echo ""
      echo "⚠  --force-push: origin/$DEPLOY_BRANCH будет перезаписан (--force-with-lease)."
      echo "   Используйте только если remote — старый Saleor / чужая история."
      echo ""
    fi
    git_push_dir "$MONO_ROOT" "$DEPLOY_BRANCH" "$DO_FORCE_PUSH" "${MONO_GIT_PUSH_KEY}"
  else
    log "skip git push"
  fi

  SHA="$(git -C "$MONO_ROOT" rev-parse HEAD)"
  log "deploy mono $SHA → $DEPLOY_HOST"
fi

log "remote build & restart"
"${SSH[@]}" "$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail
cd '$DEPLOY_PATH'

DO_API=$DO_API
DO_ADMIN=$DO_ADMIN
DO_MIGRATE=$DO_MIGRATE
DO_RSYNC=$DO_RSYNC
BRANCH='$DEPLOY_BRANCH'
REMOTE='$MONO_REMOTE'
SHA='$SHA'

if [[ "\$DO_RSYNC" -ne 1 ]]; then
  # Файлы могли быть залиты rsync под другим uid → git ругается на ownership
  git config --global --add safe.directory '$DEPLOY_PATH' 2>/dev/null || true
  if [[ ! -d .git ]]; then
    echo "==> git init (первый раз в \$PWD)"
    git init -b "\$BRANCH"
    git remote add origin "\$REMOTE"
  fi
  git fetch origin "\$BRANCH"
  git checkout "\$BRANCH" 2>/dev/null || git checkout -b "\$BRANCH"
  git reset --hard "\$SHA"
fi

echo "==> npm ci (workspace root)"
unset NODE_ENV
npm ci

echo "==> build @miraflores/admin-sections"
npm run build -w @miraflores/admin-sections

echo "==> build @miraflores/admin-types"
npm run build -w @miraflores/admin-types

if [[ "\$DO_API" -eq 1 ]]; then
  if [[ "\$DO_MIGRATE" -eq 1 ]]; then
    if [[ -f backend/.env ]]; then
      set -a
      # shellcheck disable=SC1091
      source backend/.env
      set +a
    fi
    echo "==> prisma migrate deploy"
    npx prisma migrate deploy --schema backend/prisma/schema.prisma
  fi
  echo "==> prisma generate"
  npx prisma generate --schema backend/prisma/schema.prisma
  echo "==> build api"
  npm run build -w miraflores-api
  if [[ -f backend/.env ]]; then
    set -a
    # shellcheck disable=SC1091
    source backend/.env
    set +a
  fi
  if [[ "\${NODE_ENV:-}" == "production" ]]; then
    _oc_cors="\${ORDER_CHAT_SOCKET_CORS_ORIGINS// /}"
    _oc_relaxed="\${ORDER_CHAT_SOCKET_CORS_RELAXED:-}"
    if [[ -z "\$_oc_cors" && "\$_oc_relaxed" != "1" && "\${_oc_relaxed,,}" != "true" ]]; then
      echo "ERROR: NODE_ENV=production requires ORDER_CHAT_SOCKET_CORS_ORIGINS in /opt/miraflores/backend/.env"
      echo "  e.g. ORDER_CHAT_SOCKET_CORS_ORIGINS=https://miraflores-shop.com,https://www.miraflores-shop.com"
      echo "  (emergency only: ORDER_CHAT_SOCKET_CORS_RELAXED=1)"
      exit 1
    fi
  fi
  echo "==> restart miraflores-api"
  systemctl restart miraflores-api
  sleep 2
  curl -sf http://127.0.0.1:3001/api/v1/health >/dev/null && echo "miraflores-api: health ok" \
    || { echo "miraflores-api: health FAIL"; journalctl -u miraflores-api -n 30 --no-pager; exit 1; }
fi

if [[ "\$DO_ADMIN" -eq 1 ]]; then
  echo "==> build admin"
  npm run build -w miraflores-admin
  echo "==> restart miraflores-admin"
  systemctl restart miraflores-admin
  sleep 2
  systemctl is-active miraflores-admin >/dev/null && echo "miraflores-admin: active" \
    || { echo "miraflores-admin: DOWN"; journalctl -u miraflores-admin -n 30 --no-pager; exit 1; }
fi
REMOTE

log "done → https://miraflores-shop.com/api/v1/health"
