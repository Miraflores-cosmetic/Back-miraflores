# Runbook: автосинхронизация заказов СДЭК

Фоновый воркер Nest подтягивает статус отправления из API СДЭК, обновляет трек в заказе, **один раз** шлёт письмо с треком и при вручении переводит заказ в «Доставлен».

```
Создано отправление в СДЭК (uuid в shipment) → Воркер: cdek_number → письмо с треком → DELIVERED / POSTOMAT_RECEIVED → «Доставлен» + письмо
```

## Кто и где

| Роль | Что делает | Где |
|------|-----------|-----|
| Склад | Сборка, «Заказ отправлен» / регистрация в СДЭК | Админка → Заказы |
| Супер-админ | Ключи API, интервал воркера | Настройки → Службы доставки → СДЭК; `backend/.env` на API |
| Поддержка | Ручное «Отправить трек» при сбое SMTP | Карточка заказа |

Журнал: события с **`actorUserId = null`** и пометкой «СДЭК» — автоматика. Ручные действия — с id сотрудника.

## Включение

1. На API в `.env`: `CDEK_ACCOUNT`, `CDEK_SECURE` (и при необходимости `CDEK_SHIPMENT_POINT`, `CDEK_FROM_CITY_CODE`).
2. По умолчанию воркер **включён**, если ключи заданы. Выключить: `CDEK_SYNC_ENABLED=0`.
3. Интервал (мс): `CDEK_SYNC_INTERVAL_MS` (по умолчанию `900000` = 15 мин). Batch: `CDEK_SYNC_BATCH_SIZE` (по умолчанию `40`).
4. После деплоя миграций — `systemctl restart miraflores-api`. Leader: lease `cdek_sync` в БД (не advisory lock).

## Что делает воркер

1. Список: отправления `provider=CDEK` с `externalId`, заказы в «Сборка» или «Отправлен».
2. `GET /v2/orders/{uuid}` — если пришёл новый `cdek_number` или изменился снимок API, обновляет `Shipment` (без лишнего churn `updatedAt`, если данные те же).
3. Письмо с треком: outbox `TRACKING_SENT` (`cdek_sync` или `admin_manual`), `attempt`/`nextRetryAt` при ошибке, backoff 1→60 мин (cap 1 ч). Ретрай воркера не чаще due и **один SMTP на заказ за тик**.
4. Статусы СДЭК **`DELIVERED`** / **`POSTOMAT_RECEIVED`** → «Доставлен» + outbox `DELIVERED` (`source: cdek_sync`). Ручная кнопка «Доставлен» — тот же outbox (`admin_manual`), ретрай воркером при `failed`.

## Ручные действия

| Ситуация | Действие |
|----------|----------|
| Трек в API есть, письма нет | Подождать тик или «Отправить трек» (если outbox не `pending` от sync) |
| SMTP недоступен | В журнале `TRACKING_SENT` / `DELIVERED` (СДЭК) с `mailStatus: failed` — воркер ретраит; при срочности — ручная эскалация |
| Уже «Доставлен» вручную | Воркер пропускает (идемпотентно) |
| Два инстанса API | Lease + `tickBusy` — один активный тик на процесс |

## Для разработчиков

- Код: `backend/src/orders/orders-cdek-sync.worker.ts`, `cdek-order-sync.service.ts`.
- Тесты: `cdek-order-sync.service.spec.ts`, `orders-cdek-sync.worker.spec.ts`, `cdek-order-status.util.spec.ts`.
- Env: `backend/.env.example` (`CDEK_SYNC_*`).