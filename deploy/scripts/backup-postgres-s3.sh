#!/usr/bin/env bash
# Бэкап Postgres (miraflores_db) → Reg.ru S3.
# Запуск НА VPS:
#   bash /opt/miraflores/deploy/scripts/backup-postgres-s3.sh
#
# Секреты — только в deploy/backup-s3.env (не в git). Пример: backup-s3.env.example
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${BACKUP_S3_ENV:-$DEPLOY_ROOT/backup-s3.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: нет $ENV_FILE" >&2
  echo "       скопируйте backup-s3.env.example → backup-s3.env и заполните ключи" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

: "${AWS_ACCESS_KEY_ID:?задайте AWS_ACCESS_KEY_ID в backup-s3.env}"
: "${AWS_SECRET_ACCESS_KEY:?задайте AWS_SECRET_ACCESS_KEY в backup-s3.env}"
: "${S3_BUCKET:?задайте S3_BUCKET}"
: "${S3_ENDPOINT:?задайте S3_ENDPOINT}"

DB_CTR="${DB_CONTAINER:-miraflores_db}"
DB_USER="${POSTGRES_USER:-miraflores}"
DB_NAME="${POSTGRES_DB:-miraflores}"
S3_PREFIX="${S3_PREFIX:-postgres}"
KEEP_DAYS="${KEEP_DAYS:-30}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION

# Reg.ru иногда отдаёт цепочку с self-signed — для приватного бэкапа допустимо отключить verify.
AWS_S3=(aws --endpoint-url "$S3_ENDPOINT")
if [[ "${S3_NO_VERIFY_SSL:-0}" == "1" ]]; then
  AWS_S3+=(--no-verify-ssl)
  export AWS_CA_BUNDLE="${AWS_CA_BUNDLE:-}"
  # подавить InsecureRequestWarning шум не обязательно
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "error: нужен AWS CLI (см. awscli.amazonaws.com или pip install awscli)" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CTR"; then
  echo "error: контейнер $DB_CTR не запущен" >&2
  exit 1
fi

STAMP="$(date +%Y-%m-%d_%H%M%S)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DUMP_NAME="${DB_NAME}_${STAMP}.dump"
DUMP_PATH="$TMP_DIR/$DUMP_NAME"
S3_URI="s3://${S3_BUCKET}/${S3_PREFIX}/${DUMP_NAME}"

echo "==> pg_dump $DB_CTR:$DB_NAME → $DUMP_NAME"
docker exec "$DB_CTR" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-acl -f "/tmp/$DUMP_NAME"
docker cp "$DB_CTR:/tmp/$DUMP_NAME" "$DUMP_PATH"
docker exec "$DB_CTR" rm -f "/tmp/$DUMP_NAME"

SIZE="$(du -h "$DUMP_PATH" | awk '{print $1}')"
echo "==> размер: $SIZE"

echo "==> upload → $S3_URI"
"${AWS_S3[@]}" s3 cp "$DUMP_PATH" "$S3_URI"

echo "==> проверка объекта"
"${AWS_S3[@]}" s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" | tail -5

if [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && [[ "$KEEP_DAYS" -gt 0 ]]; then
  echo "==> удаление объектов старше ${KEEP_DAYS} дн. в s3://${S3_BUCKET}/${S3_PREFIX}/"
  CUTOFF="$(date -u -d "-${KEEP_DAYS} days" +%Y-%m-%d 2>/dev/null || date -u -v-"${KEEP_DAYS}"d +%Y-%m-%d)"
  while read -r date _rest key; do
    [[ -z "${key:-}" ]] && continue
    # date из aws s3 ls: YYYY-MM-DD
    if [[ "$date" < "$CUTOFF" ]]; then
      echo "    del $key ($date)"
      "${AWS_S3[@]}" s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${key}"
    fi
  done < <("${AWS_S3[@]}" s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" | awk '{print $1, $2, $4}')
fi

echo "OK backup → $S3_URI"
