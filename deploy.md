# Deploy — Miraflores 3.0

Прод: **https://miraflores-shop.com**  
VPS: `root@91.229.8.83` · код: `/opt/miraflores` · static Front: `/var/www/miraflores-front`

См. также [structure.md](./structure.md).

---

## Архитектура на сервере

```
https://miraflores-shop.com/
  /                 → Vite static (/var/www/miraflores-front)
  /api/v1/          → Nest miraflores-api :3001
  /api/v1/1c/exchange → Nest (обмен 1С, Basic Auth)
  /uploads/         → Nest (локальные файлы)
  /admin            → Next miraflores-admin :3010
  /api/cdek|yandex… → Next BFF :3010
  /api/yookassa/…   → Next BFF :3010
  /api/yandexpay/…  → Next BFF :3010 (Merchant webhook JWT)

Postgres docker miraflores_db :5432 (только localhost)
systemd: miraflores-api, miraflores-admin
nginx: deploy/nginx/miraflores.conf
```

---

## Репозитории и ключи

| Что | GitHub | SSH-ключ (файл) | fingerprint |
|-----|--------|-----------------|-------------|
| Front (Vite) | [Front-end-site](https://github.com/Miraflores-cosmetic/Front-end-site) | `~/.ssh/id_ed25519_deploy_front` (**mira-ap**) | `SHA256:0KU4WY20…` |
| Backend + Admin + packages | [Back-miraflores](https://github.com/Miraflores-cosmetic/Back-miraflores) | `~/.ssh/id_ed25519_deploy` (**mira-ssh**) | `SHA256:GMNL1Nj+…` |
| SSH на VPS | — | `~/.ssh/id_ed25519_mira_ap` | `SHA256:s3mOKq3…` |

`Front/` — **отдельный** git внутри папки. Корень монорепо (`backend`, `Admin`, `packages`, `deploy`) → `Back-miraflores`. `Front/` в mono `.gitignore`.

У deploy keys на GitHub нужно **Allow write access**.

---

## Локальный конфиг деплоя

```bash
cp deploy/deploy.env.example deploy/deploy.env
# правьте ключи / Yandex Map key при необходимости
chmod +x deploy/scripts/*.sh
```

`deploy/deploy.env` **не коммитится**. Секреты на VPS (`backend/.env`, `Admin/.env.local`) скрипты не затирают.

---

## Рутинный деплой

### Front

```bash
./deploy/scripts/deploy-front.sh
./deploy/scripts/deploy-front.sh -m "описание коммита"
./deploy/scripts/deploy-front.sh --rsync          # без GitHub
./deploy/scripts/deploy-front.sh --skip-push      # SHA уже на GitHub
```

Скрипт: push (mira-ap) → на VPS `git reset --hard` / rsync → `npm ci` → `build` → rsync в `/var/www/miraflores-front`.

Перед `npm ci` на сервере скрипт делает `unset NODE_ENV` (иначе не ставятся vite / types).

### Backend + Admin

```bash
./deploy/scripts/deploy-backend.sh                 # api + admin
./deploy/scripts/deploy-backend.sh --api
./deploy/scripts/deploy-backend.sh --admin
./deploy/scripts/deploy-backend.sh --rsync         # без GitHub (часто удобнее)
./deploy/scripts/deploy-backend.sh --skip-push
./deploy/scripts/deploy-backend.sh -m "описание"
./deploy/scripts/deploy-backend.sh --force-push    # только если надо перезаписать origin/main
```

Скрипт: push (mira-ssh) или rsync → на VPS `npm ci` → build packages → prisma migrate (если `--api`) → build api/admin → `systemctl restart`.

Health:

```bash
curl -sf https://miraflores-shop.com/api/v1/health
# на VPS:
systemctl status miraflores-api miraflores-admin
journalctl -u miraflores-api -n 50 --no-pager
```

---

## Ручной push (без скрипта)

```bash
# бэк
cd "/Users/ap/Projects/Miraflores 3.0"
export GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_deploy -o IdentitiesOnly=yes'
git push origin main

# фронт
cd "/Users/ap/Projects/Miraflores 3.0/Front"
export GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_deploy_front -o IdentitiesOnly=yes'
git push origin main
```

---

## Секреты на VPS (не в git)

| Файл | Назначение |
|------|------------|
| `/opt/miraflores/backend/.env` | DB, JWT, SMTP, ЮKassa, CDEK, uploads, `FRONTEND_PUBLIC_URL`, `ONEC_LOGIN` / `ONEC_PASSWORD`, Ozon (`OZON_*`, `ADMIN_PUBLIC_URL`, `OPS_ALERT_EMAIL`) |
| `/opt/miraflores/Admin/.env.local` | `NEXT_PUBLIC_*`, Yandex Delivery, CDEK, webhook secret; **`BACKEND_INTERNAL_URL=http://127.0.0.1:3001/api/v1`** (SSR/BFF → Nest, не публичный HTTPS) |
| `/opt/miraflores/Front/.env` | пишет скрипт деплоя (`VITE_API_URL=/api/v1`, Yandex Map) |
| `/opt/miraflores/deploy/.env` | пароль Postgres для docker-compose |

Обязательные для почты staff/заказов: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `FRONTEND_PUBLIC_URL`.

Дубли заказов админу: `ORDER_ADMIN_NOTIFY_EMAIL=mira-robot@miraflores-shop.ru` (default тот же; пусто = выкл) — create / paid / cancelled / refund.

Полный контракт писем (ключи шаблонов, auth/staff, синтаксис): [docs/emails.md](docs/emails.md).

### Неоплата на проде (`backend/.env`)

| Env | Рекомендация prod | Смысл |
|-----|-------------------|--------|
| `ORDER_AWAITING_TTL_MINUTES` | `4320` (72 ч) | порог «просрочено» в админке; **авто-отмена отключена** |
| `ORDER_PAY_REMIND_1_MINUTES` | `5` (или оставить default) | 1-е напоминание |
| `ORDER_PAY_REMIND_2_MINUTES` | `1440` | 24 ч |
| `ORDER_PAY_REMIND_3_MINUTES` | `2880` | 48 ч |

Воркер в API: tick **1 мин** (`OrdersExpiryWorker`) → только remind (expire scaffolding удалён). Catch-up после даунтайма: одно письмо — высший overdue stage (см. [docs/emails.md](docs/emails.md)).

После 72 ч без оплаты: красные чипы + фильтр «Просрочена оплата» (`?overdue=1`); stock/gift hold до ручной отмены.

Backlog remind: due > `ORDER_PAY_REMIND_BACKLOG_ALERT` (default 100) → `OPS_ALERT awaiting_remind_backlog`.  
`ORDER_AWAITING_EXPIRE_BACKLOG_ALERT` — dead (не задавать).

```bash
grep -E '^(ORDER_AWAITING_TTL|ORDER_PAY_REMIND)' /opt/miraflores/backend/.env
journalctl -u miraflores-api --since "1 hour ago" --no-pager \
  | grep -iE "awaiting-payment reminder|awaiting_remind_backlog"
```

Проверка приглашений сотрудников:

```bash
journalctl -u miraflores-api --since "3 hours ago" --no-pager \
  | grep -iE "staff_created|Staff admin welcome|SMTP not configured"
```

Успех: `Staff admin welcome email sent to …`

---

## Ozon Доставка: выкатка на прод

Подробно об интеграции — [docs/ozon-delivery.md](docs/ozon-delivery.md). Пока Ozon не подключён, витрина его просто не показывает, поэтому код можно выкатывать раньше, чем появятся ключи.

**1. Env на VPS** — `/opt/miraflores/backend/.env` (скрипты деплоя его не трогают):

```bash
OZON_CLIENT_ID=…                      # dev.ozon.ru → приложение «Ozon Доставка»
OZON_CLIENT_SECRET=…                  # он же ключ шифрования refresh token: сменили — переподключить
OZON_OAUTH_REDIRECT_URI=https://miraflores-shop.com/api/v1/delivery/ozon/oauth/callback
ADMIN_PUBLIC_URL=https://miraflores-shop.com   # без /admin — вернёт на /admin/settings/delivery
OPS_ALERT_EMAIL=…                     # алерты мониторинга Ozon (иначе SUPPORT_EMAIL, иначе только лог)
OZON_HEALTH_INTERVAL_MIN=30           # 0 — выключить фоновые проверки
```

Необязательно: `/opt/miraflores/Admin/.env.local` → `NEXT_PUBLIC_OZON_CABINET_URL` (по умолчанию `https://seller.ozon.ru/`; `NEXT_PUBLIC_*` вшивается при сборке admin). Флаги `*YANDEX_DELIVERY_ENABLED` не задавать — Яндекс скрыт.

**2. dev.ozon.ru** → приложение → Redirect URI **ровно** как `OZON_OAUTH_REDIRECT_URI`. nginx менять не нужно: callback идёт через `location /api/v1/`.

**3. Деплой**:

```bash
./deploy/scripts/deploy-backend.sh     # api + admin; prisma migrate deploy — автоматически
./deploy/scripts/deploy-front.sh
```

Миграции: `20260925100000_ozon_delivery` (OzonIntegration, enum OZON) и `20260927120000_ozon_monitoring_reconciliation` (поля Shipment для сверки, мониторинг, OzonHealthCheck). Обе только добавляют таблицы и колонки, откат кода их не требует. Проверить на VPS: `npx prisma migrate status --schema backend/prisma/schema.prisma`.

**4. Подключение и проверка**:

1. Админка → Настройки → **Службы доставки**: Redirect URI в карточке совпадает с dev.ozon.ru → «Подключить Ozon» → вход в кабинет продавца.
2. «Проверить API» → «в справочнике N пунктов».
3. Карточка «Мониторинг Ozon»: интервал 30 мин, «Email-алерты: Настроены».
4. Витрина:

```bash
curl -s https://miraflores-shop.com/api/v1/delivery/ozon/availability   # {"available":true,…}
journalctl -u miraflores-api --since "1 hour ago" --no-pager | grep -E "Ozon|OPS_ALERT ozon_health"
```

Если что-то не так: «Отключить» в карточке Ozon — витрина сразу вернётся к СДЭК.

---

## Яндекс Пэй: выкатка на прод

Рядом с ЮKassa (кнопка Web SDK + Merchant API), не вместо. Код можно выкатывать раньше ключей — без `YANDEX_PAY_*` кнопка на витрине скрыта.

**1. Env на VPS** — `/opt/miraflores/backend/.env` (деплой не затирает):

```bash
YANDEX_PAY_MERCHANT_ID=…          # публичный Merchant ID из ЛК Яндекс Пэй
YANDEX_PAY_API_KEY=…              # API-ключ (только Nest)
# sandbox | production (default production)
YANDEX_PAY_ENV=production
```

Front **не** дублирует Merchant ID в `VITE_*` — кнопка читает только `GET /api/v1/orders/yandexpay/config` (иначе drift Front≠API).

Чек 54-ФЗ: `receipt.tax = 1` («без НДС»); позиции — `yandex-pay-fiscal-cart.ts` (shipping отдельной строкой, promo/gift — ratio shrink; gratitude 0 ₽ вне чека).

**2. Callback URL в ЛК Яндекс Пэй** — ровно:

```text
https://miraflores-shop.com/api/yandexpay
```

Яндекс сам добавит `/v1/webhook` → Next BFF `Admin/app/api/yandexpay/v1/webhook` → Nest `POST /api/v1/orders/yandexpay/webhook`. Ответ по схеме: `200 {"status":"success"}` или `400 {"status":"fail","reasonCode":…}`.

**3. nginx** — уже в `deploy/nginx/miraflores.conf`:

```nginx
location /api/yandexpay/ {
    proxy_pass http://miraflores_admin;
    …
}
```

После правки conf: `nginx -t && systemctl reload nginx`.

**4. Sandbox → production**

1. В ЛК Яндекс Пэй завести боевой Merchant / API-ключ (отдельные от sandbox).
2. На VPS: `YANDEX_PAY_ENV=production` (или убрать строку), обновить `YANDEX_PAY_MERCHANT_ID` / `YANDEX_PAY_API_KEY`.
3. `systemctl restart miraflores-api` — Front подхватит env/merchant из `GET /orders/yandexpay/config` (без `VITE_*`, redeploy front не нужен).
4. Callback URL на проде тот же host; sandbox-хост (`sandbox.pay.yandex.ru`) для JWKS/API больше не используется.
5. Smoke: `curl -s …/orders/yandexpay/config` → `"env":"PRODUCTION"` и тот же `merchantId`, что в `.env`.

**5. Проверка**

```bash
curl -s https://miraflores-shop.com/api/v1/orders/yandexpay/config
# {"enabled":true,"merchantId":"…","env":"PRODUCTION"}

journalctl -u miraflores-api --since "1 hour ago" --no-pager | grep -iE "YandexPay|yandexpay"
```

Витрина `/order` и deep-link из письма `/order/pay` показывают кнопку Яндекс Пэй, если config enabled. Exclusive: старт YaPay гасит PENDING ЮKassa и наоборот.

---

## Mixed Content (картинки с localhost)

1. Front: `uploadsUrl()` переписывает `http://127.0.0.1:3001/...` → `/uploads/...` (нужен redeploy front).
2. Опционально в БД:

```bash
docker exec -i miraflores_db psql -U miraflores -d miraflores \
  < /opt/miraflores/deploy/scripts/fix-localhost-urls.sql
```

---

## Первичный wipe / поднять с нуля

Одноразовые скрипты (Saleor → Miraflores уже сделан на проде; ниже — на случай нового хоста):

1. `deploy/scripts/00-survey.sh` — разведка
2. `deploy/scripts/01-backup-saleor.sh` — бэкап
3. Postgres: `deploy/docker-compose.yml` → `miraflores_db`
4. systemd: `deploy/systemd/miraflores-*.service`
5. nginx: `deploy/nginx/miraflores.conf`
6. `npm ci` + prisma migrate + build + restart (или `./deploy/scripts/deploy-backend.sh --rsync` + `deploy-front.sh --rsync`)

Smoke: health API, `/admin/login`, витрина, checkout.
