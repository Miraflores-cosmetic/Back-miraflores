#!/usr/bin/env bash
# Деплой витрины (Vite Front):
#   git push → git pull на VPS → npm ci → build → rsync в /var/www/miraflores-front
#   --rsync: залить локальный Front без GitHub (как backend deploy)
#
# Usage (из корня монорепо или из deploy/scripts):
#   ./deploy/scripts/deploy-front.sh
#   ./deploy/scripts/deploy-front.sh --skip-push
#   ./deploy/scripts/deploy-front.sh --rsync
#   ./deploy/scripts/deploy-front.sh -m "fix gratitude images"
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

load_deploy_env
setup_ssh
verify_deploy_ssh

FRONT_DIR="$MONO_ROOT/Front"
DO_PUSH=1
DO_RSYNC=0
COMMIT_MSG=""

usage() {
  cat <<'EOF'
Deploy Front: [optional commit] → git push → pull on VPS → build → nginx static.

  ./deploy/scripts/deploy-front.sh
  ./deploy/scripts/deploy-front.sh --skip-push   # push уже сделан; SHA должен быть на GitHub
  ./deploy/scripts/deploy-front.sh --rsync       # локальный Front → VPS без git push/pull
  ./deploy/scripts/deploy-front.sh -m "описание коммита"

Config: deploy/deploy.env
  FRONT_GIT_PUSH_KEY — SSH push (default: id_ed25519_mira_ap → Front-end-site)
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-push) DO_PUSH=0 ;;
    --rsync) DO_RSYNC=1; DO_PUSH=0 ;;
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

[[ -d "$FRONT_DIR/.git" ]] || { echo "error: нет git в $FRONT_DIR" >&2; exit 1; }

if [[ -n "$COMMIT_MSG" ]]; then
  if git -C "$FRONT_DIR" diff --quiet && git -C "$FRONT_DIR" diff --cached --quiet \
    && [[ -z "$(git -C "$FRONT_DIR" status --porcelain)" ]]; then
    log "нечего коммитить во Front"
  else
    log "git commit (Front)"
    git -C "$FRONT_DIR" add -A
    git -C "$FRONT_DIR" reset HEAD -- tsconfig.tsbuildinfo 2>/dev/null || true
    git -C "$FRONT_DIR" commit -m "$COMMIT_MSG"
  fi
fi

if [[ "$DO_RSYNC" -eq 1 ]]; then
  log "rsync Front → $DEPLOY_HOST:$DEPLOY_PATH/Front"
  "${RSYNC[@]}" \
    --exclude node_modules \
    --exclude dist \
    --exclude .env \
    --exclude .env.local \
    --exclude tsconfig.tsbuildinfo \
    --exclude .DS_Store \
    "$FRONT_DIR/" \
    "$DEPLOY_HOST:$DEPLOY_PATH/Front/"
elif [[ "$DO_PUSH" -eq 1 ]]; then
  require_clean_git "$FRONT_DIR"
  git_push_dir "$FRONT_DIR" "$DEPLOY_BRANCH" 0 "${FRONT_GIT_PUSH_KEY}"
else
  log "skip git push"
fi

SHA="$(git -C "$FRONT_DIR" rev-parse HEAD)"
log "deploy front $SHA → $DEPLOY_HOST"

log "rsync packages (order-chat-*) → $DEPLOY_HOST:$DEPLOY_PATH/packages"
"${RSYNC[@]}" \
  --exclude node_modules \
  --exclude dist \
  "$MONO_ROOT/packages/" \
  "$DEPLOY_HOST:$DEPLOY_PATH/packages/"

if [[ "$DO_RSYNC" -eq 1 ]]; then
  "${SSH[@]}" "$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail
DEPLOY_PATH='$DEPLOY_PATH'
FRONT_STATIC='$FRONT_STATIC_DIR'
FRONT="\$DEPLOY_PATH/Front"
cd "\$FRONT"

YANDEX_MAP_KEY='${DEPLOY_YANDEX_MAP_API_KEY:-}'
if [[ -z "\$YANDEX_MAP_KEY" && -f .env ]]; then
  YANDEX_MAP_KEY=\$(grep -E '^VITE_PUBLIC_YANDEX_MAP_API_KEY=' .env | head -1 | cut -d= -f2- || true)
fi

cat > .env <<EOF
VITE_API_URL=/api/v1
VITE_UPLOADS_ORIGIN=
VITE_PUBLIC_YANDEX_MAP_API_KEY=\${YANDEX_MAP_KEY}
VITE_YANDEX_MAP_API_KEY=\${YANDEX_MAP_KEY}
EOF

echo "==> npm ci (devDependencies — vite, types)"
unset NODE_ENV
npm ci

echo "==> npm run build"
npm run build

mkdir -p "\$FRONT_STATIC"
rsync -a --delete dist/ "\$FRONT_STATIC/"

echo "front: ok → \$FRONT_STATIC (\$(ls "\$FRONT_STATIC" | wc -l | tr -d ' ') files)"
REMOTE
else
  "${SSH[@]}" "$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail
DEPLOY_PATH='$DEPLOY_PATH'
FRONT_STATIC='$FRONT_STATIC_DIR'
BRANCH='$DEPLOY_BRANCH'
REMOTE='$FRONT_GIT_REMOTE'
SHA='$SHA'

FRONT="\$DEPLOY_PATH/Front"
mkdir -p "\$FRONT"

# Файлы могли быть залиты rsync под другим uid → git ругается на ownership
git config --global --add safe.directory "\$FRONT" 2>/dev/null || true
git config --global --add safe.directory '$DEPLOY_PATH' 2>/dev/null || true

if [[ ! -d "\$FRONT/.git" ]]; then
  echo "==> clone Front (первый раз)"
  rm -rf "\$FRONT"
  git clone "\$REMOTE" "\$FRONT"
fi

cd "\$FRONT"
git fetch origin "\$BRANCH"
git checkout "\$BRANCH"
git reset --hard "\$SHA"

git restore tsconfig.tsbuildinfo 2>/dev/null || true

YANDEX_MAP_KEY='${DEPLOY_YANDEX_MAP_API_KEY:-}'
if [[ -z "\$YANDEX_MAP_KEY" && -f .env ]]; then
  YANDEX_MAP_KEY=\$(grep -E '^VITE_PUBLIC_YANDEX_MAP_API_KEY=' .env | head -1 | cut -d= -f2- || true)
fi

cat > .env <<EOF
VITE_API_URL=/api/v1
VITE_UPLOADS_ORIGIN=
VITE_PUBLIC_YANDEX_MAP_API_KEY=\${YANDEX_MAP_KEY}
VITE_YANDEX_MAP_API_KEY=\${YANDEX_MAP_KEY}
EOF

echo "==> npm ci (devDependencies — vite, types)"
unset NODE_ENV
npm ci

echo "==> npm run build"
npm run build

mkdir -p "\$FRONT_STATIC"
rsync -a --delete dist/ "\$FRONT_STATIC/"

echo "front: ok → \$FRONT_STATIC (\$(ls "\$FRONT_STATIC" | wc -l | tr -d ' ') files)"
REMOTE
fi

log "done → https://miraflores-shop.com/"
