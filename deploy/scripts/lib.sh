#!/usr/bin/env bash
# Общие функции для deploy-скриптов Miraflores.
set -euo pipefail

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONO_ROOT="$(cd "$DEPLOY_ROOT/.." && pwd)"

load_deploy_env() {
  local env_file="$DEPLOY_ROOT/deploy.env"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a && source "$env_file" && set +a
  elif [[ -f "$DEPLOY_ROOT/deploy.env.example" ]]; then
    echo "warn: нет deploy/deploy.env — беру deploy.env.example" >&2
    # shellcheck disable=SC1090
    set -a && source "$DEPLOY_ROOT/deploy.env.example" && set +a
  fi

  : "${DEPLOY_HOST:?задайте DEPLOY_HOST в deploy/deploy.env}"
  DEPLOY_PATH="${DEPLOY_PATH:-/opt/miraflores}"
  DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
  DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519_mira_ap}"
  FRONT_STATIC_DIR="${FRONT_STATIC_DIR:-/var/www/miraflores-front}"
  # Front → Front-end-site (mira-ap); mono → Back-miraflores (mira-ssh)
  # mira-ap → id_ed25519_deploy_front; mira-ssh → id_ed25519_deploy
  FRONT_GIT_PUSH_KEY="${FRONT_GIT_PUSH_KEY:-$HOME/.ssh/id_ed25519_deploy_front}"
  MONO_GIT_PUSH_KEY="${MONO_GIT_PUSH_KEY:-$HOME/.ssh/id_ed25519_deploy}"
}

setup_ssh() {
  local key="${DEPLOY_SSH_KEY/#\~/$HOME}"
  if [[ ! -f "$key" ]]; then
    echo "error: SSH-ключ не найден: $key" >&2
    echo "       Задайте DEPLOY_SSH_KEY в deploy/deploy.env" >&2
    exit 1
  fi
  SSH=(ssh -o RequestTTY=no -o BatchMode=yes -i "$key" -o IdentitiesOnly=yes)
  RSYNC=(rsync -az --delete -e "ssh -o RequestTTY=no -o BatchMode=yes -i '$key' -o IdentitiesOnly=yes")
  GIT_SSH_COMMAND="ssh -i '$key' -o IdentitiesOnly=yes"
  export GIT_SSH_COMMAND
}

verify_deploy_ssh() {
  log "проверка SSH → $DEPLOY_HOST"
  if ! "${SSH[@]}" -o ConnectTimeout=15 "$DEPLOY_HOST" "echo ok" >/dev/null 2>&1; then
    local key="${DEPLOY_SSH_KEY/#\~/$HOME}"
    echo "error: SSH к $DEPLOY_HOST не прошёл (Permission denied?)" >&2
    echo "" >&2
    echo "Ключ из deploy.env: $key" >&2
    echo "Он работает для GitHub, но должен быть в ~/.ssh/authorized_keys на VPS." >&2
    echo "" >&2
    echo "Один раз добавьте ключ (просит пароль root):" >&2
    echo "  ssh-copy-id -i ${key}.pub $DEPLOY_HOST" >&2
    echo "" >&2
    echo "Или задеплойте вручную на сервере (см. deploy.md)." >&2
    exit 1
  fi
}

log() { printf '==> %s\n' "$*"; }

# YANDEX_PAY_* на VPS (backend/.env). Источник: deploy.env или локальный backend/.env.
apply_prod_yandex_pay_env() {
  local mid="${DEPLOY_YANDEX_PAY_MERCHANT_ID:-}"
  local api_key="${DEPLOY_YANDEX_PAY_API_KEY:-}"
  local yp_env="${DEPLOY_YANDEX_PAY_ENV:-}"
  local local_env="$MONO_ROOT/backend/.env"

  if [[ (-z "$mid" || -z "$api_key") && -f "$local_env" ]]; then
    # shellcheck disable=SC1090
    set -a
    # только нужные ключи — не source весь .env в текущий shell deploy
    mid="${mid:-$(grep -E '^YANDEX_PAY_MERCHANT_ID=' "$local_env" | head -1 | cut -d= -f2- || true)}"
    api_key="${api_key:-$(grep -E '^YANDEX_PAY_API_KEY=' "$local_env" | head -1 | cut -d= -f2- || true)}"
    yp_env="${yp_env:-$(grep -E '^YANDEX_PAY_ENV=' "$local_env" | head -1 | cut -d= -f2- || true)}"
    set +a
  fi

  if [[ -z "$mid" || -z "$api_key" ]]; then
    echo "warn: YANDEX_PAY_* пуст — задайте в deploy/deploy.env или backend/.env" >&2
    return 0
  fi
  yp_env="${yp_env:-production}"

  log "sync YANDEX_PAY_* → $DEPLOY_HOST backend/.env"
  "${SSH[@]}" "$DEPLOY_HOST" "python3 -" "$DEPLOY_PATH/backend/.env" <<PY
import sys
path = sys.argv[1]
updates = {
    "YANDEX_PAY_MERCHANT_ID": ${mid@Q},
    "YANDEX_PAY_API_KEY": ${api_key@Q},
    "YANDEX_PAY_ENV": ${yp_env@Q},
}
try:
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
except FileNotFoundError:
    lines = []
out = []
seen = set()
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in updates:
        out.append(f"{key}={updates[key]}\n")
        seen.add(key)
    else:
        out.append(line)
for key, val in updates.items():
    if key not in seen:
        out.append(f"{key}={val}\n")
with open(path, "w", encoding="utf-8") as f:
    f.writelines(out)
PY
}

require_clean_git() {
  local dir="$1"
  if ! git -C "$dir" diff --quiet || ! git -C "$dir" diff --cached --quiet; then
    echo "error: в $dir есть незакоммиченные изменения" >&2
    git -C "$dir" status -sb
    exit 1
  fi
}

# git_push_dir <dir> [branch] [force=0|1] [ssh_key]
git_push_dir() {
  local dir="$1"
  local branch="${2:-$DEPLOY_BRANCH}"
  local force="${3:-0}"
  local key="${4:-}"
  local current
  current="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  if [[ "$current" != "$branch" ]]; then
    echo "error: в $dir ветка '$current', ожидается '$branch'" >&2
    exit 1
  fi
  if [[ -z "$key" ]]; then
    key="${FRONT_GIT_PUSH_KEY:-$HOME/.ssh/id_ed25519_deploy_front}"
  fi
  key="${key/#\~/$HOME}"
  if [[ ! -f "$key" ]]; then
    echo "error: git push key не найден: $key" >&2
    exit 1
  fi
  export GIT_SSH_COMMAND="ssh -i '$key' -o IdentitiesOnly=yes"
  log "git auth key: $key"

  if [[ "$force" -eq 1 ]]; then
    log "git push --force-with-lease ($dir) → origin/$branch"
    git -C "$dir" push --force-with-lease -u origin "$branch"
    return
  fi

  log "git push ($dir) → origin/$branch"
  if ! git -C "$dir" push -u origin "$branch"; then
    echo "" >&2
    echo "error: обычный push отклонён (non-fast-forward / unrelated histories)." >&2
    echo "Если origin — старый Saleor и его нужно заменить на Miraflores:" >&2
    echo "  ./deploy/scripts/deploy-backend.sh --force-push" >&2
    echo "Или без GitHub:" >&2
    echo "  ./deploy/scripts/deploy-backend.sh --rsync" >&2
    exit 1
  fi
}
