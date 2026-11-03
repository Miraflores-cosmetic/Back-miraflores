# Email — контракт писем Miraflores

Документ для ops и контент-редакторов. Код: `backend/src/mail/`, расписание неоплаты — `backend/src/orders/order-awaiting-payment-schedule.ts`.

Редактируемые шаблоны: **Админка → Настройки → Email** (ключи ниже). Auth/staff/OPS — только код, в UI нет.

---

## SMTP (обязательно на VPS)

| Env | Назначение |
|-----|------------|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | сервер (prod: Yandex, 465) |
| `SMTP_USER` / `SMTP_PASSWORD` | учётка отправки |
| `MAIL_FROM` | From (например `Miraflores <Mira-robot@…>`) |
| `MAIL_REPLY_TO` | Reply-To (обычно `info@miraflores-shop.ru`) |
| `FRONTEND_PUBLIC_URL` | ссылки в письмах (витрина) |

Без `SMTP_PASSWORD` письма не уходят (лог: skipped / not configured).

---

## Неоплата: remind_* (без авто-отмены)

| Env | Default | Смысл |
|-----|---------|--------|
| `ORDER_AWAITING_TTL_MINUTES` | `4320` (72 ч) | порог «просрочено» в админке; **авто-отмена отключена** |
| `ORDER_PAY_REMIND_1_MINUTES` | `5` | 1-е письмо |
| `ORDER_PAY_REMIND_2_MINUTES` | `1440` (24 ч) | 2-е |
| `ORDER_PAY_REMIND_3_MINUTES` | `2880` (48 ч) | 3-е напоминание |

Ограничение: `remind1 < remind2 < remind3 < TTL` (код поджимает: `remind3 ≥ TTL` → `TTL−1`, remind2 не ближе чем `TTL−2`). TTL — только UI overdue, не cancel.

**Воркер** `OrdersExpiryWorker`: раз в **1 минуту**, лидер по `pg_try_advisory_lock`. За tick только `processAwaitingPaymentReminders` (до 100, `FOR UPDATE SKIP LOCKED`). Expire scaffolding удалён.

Сервис: `OrderAwaitingPaymentService` (не `OrdersPublicService`).

**Backlog remind:** перед batch считаем due; если `due > ORDER_PAY_REMIND_BACKLOG_ALERT` (default 100) — `OPS_ALERT awaiting_remind_backlog` (+ email), throttle 1 ч.

Отмена неоплаченных — только вручную (админка / ЛК). После 72 ч: красные чипы `5 мин / 24 ч / 48 ч / 72 ч` на списке и карточке заказа (`AwaitingPaymentChips`).

ЛК / guest pay: оплата доступна, пока заказ `AWAITING_PAYMENT` (или `NEW`). `payExpiresAt` в account API не отдаётся; HMAC `payToken` живёт 30 суток (не cutoff по `ORDER_AWAITING_TTL`).

Stock + gift CAPTURE: до ручной отмены / abandon (не soft-release). Админ: фильтр «Просрочено >72ч» (`overdue=1` + count). Chips: `done`/✓ только `mailStatus=sent`; reached без sent → `due`. Expire scaffolding удалён; `ORDER_AWAITING_EXPIRE_BACKLOG_ALERT` — **dead**.

### Catch-up после простоя API (осознанный trade-off)

Если API лежал и заказ уже «перерос» несколько порогов, **за один tick** уходит только письмо **высшего** overdue stage. Тексты 5 м / 24 ч **пропускаются** — клиент видит эскалацию (часто 48 ч), а не три письма за ~3 минуты.

Пример: stage=0, возраст 50 ч → одно `order_awaiting_payment_48h`, stage→3. В истории: `PAYMENT_REMIND` + `catch-up (пропущены: 5 мин, 24 ч)`, `meta.skipped: [1,2]`.

### Outbox + SMTP retry

1. В tx: bump `awaitingPaymentRemindStage` + `OrderEvent PAYMENT_REMIND` с `meta.mailStatus: pending` (idempotency ключ = event).
2. После commit: SMTP.
3. Успех → `mailStatus: sent` (+ `sentAt`).
4. Fail / нет доставки → `mailStatus: failed`; **stage не откатываем**.
5. Следующий tick: `flushPendingRemindMails` шлёт pending/failed **без** нового bump / нового event (тот же stage).

Claim в SQL только **due** (те же пороги, что backlog count) — не lock'аем «ещё рано».

Письмо покупателю при **создании** заказа не шлётся (только напоминания по расписанию).

### Дубли админу (`ORDER_ADMIN_NOTIFY_EMAIL`)

Default: `mira-robot@miraflores-shop.ru`. Пустая строка в env = выкл. Не editable-шаблоны (hardcoded ops).

| Событие | Когда | Поля |
|---------|--------|------|
| Новый заказ | сразу после create | номер, ФИО, email, тел, сумма, **состав** |
| Заказ оплачен | вместе с `order_paid` покупателю | номер, ФИО, email, тел, сумма |
| Заказ отменён | вместе с `order_cancelled` (admin/ЛК; **не** abandon, **не** авто-TTL) | номер, ФИО, email, тел, сумма |
| Возврат | вместе с `order_refund` | номер, ФИО, email, тел, сумма (+ сумма возврата) |
| Сообщение в чате | клиент написал в чат заказа / поддержки | текст, клиент, ссылка в админку (throttle `ORDER_CHAT_EMAIL_MIN_INTERVAL_MS`) |

### Abandon checkout — без письма (осознанно, не регрессить)

`POST …/orders/:id/abandon` отменяет заказ **без** `order_cancelled`. Admin / ЛК — шлют письмо.

### CTA «Оплатить» (не регрессить)

`order.pay_url` только deep-link `/order/pay?…&payToken=…`. Profile URL **никогда** не подставлять в pay_url. ЛК — `{{cta.order}}`.

### Outbox (не регрессить)

**Не** возвращать send-before-bump без idempotency: при multi-instance будут дубли. Контракт: bump + `PAYMENT_REMIND(pending)` в tx → SMTP → `sent`; fail → retry pending.

---

## Редактируемые события (Admin)

Источник правды ключей/дефолтов: `EMAIL_NOTIFICATION_EVENTS` в `email-notification-events.ts`. В БД — `EmailNotificationTemplate` (сиды при первом list/ensureDefaults).

| Ключ | Когда | Кому |
|------|--------|------|
| `order_awaiting_payment` | ~5 мин, stage 1 | покупатель |
| `order_awaiting_payment_24h` | ~24 ч, stage 2 | покупатель |
| `order_awaiting_payment_48h` | ~48 ч, stage 3; авто-отмена отключена | покупатель |
| `order_paid` | успешная оплата обычного заказа | покупатель |
| `order_shipped` | отправка / трек | покупатель |
| `order_delivered` | статус доставлен | покупатель |
| `order_cancelled` | админ / ЛК — **не** checkout `abandon` | покупатель |
| `order_updated` | админ изменил адрес/состав (если включено) | покупатель |
| `order_surcharge` | доплата после увеличения суммы | покупатель |
| `order_refund` | возврат (admin / late / full) | покупатель |
| `gift_purchase_paid` | оплата сертификата на сайте → коды | покупатель |
| `gift_issued` | ручной выпуск / resend из админки | получатель |
| `gift_buyer_copy` | код ушёл на другой email | покупатель |
| `order_chat_reply` | ответ staff в чате **заказа** | покупатель |
| `order_chat_support_reply` | ответ staff в общем чате поддержки | покупатель |

Входящие сообщения **клиента** в чат → ops-дубль админу (`sendAdminChatNotify`, не editable). Ответы staff → editable `order_chat_*` покупателю (throttle общий).

**Не** в реестре (hardcoded в `MailService`): registration OTP, password reset (buyer), staff welcome / staff password reset, OPS-алерты (`sendRaw` / `notifyCustomer` / `sendAdminChatNotify`).

### Синтаксис шаблона

- Переменные: `{{order.number}}`, `{{site.url}}`, …
- Условия: `{{#if order.pay_url}}…{{/if}}` (пустое = блок скрыт)
- Сниппеты (не произвольный HTML): `{{cta.pay}}`, `{{cta.order}}`, `{{cta.site}}`, `{{block.order_card}}`, `{{block.items}}`, `{{block.totals}}`, `{{block.gift_items}}`

Preview в админке: variants `full` / `sparse` (sparse прячет `#if`-блоки).

### Частые переменные

| Ключ | Смысл |
|------|--------|
| `order.number` | номер заказа |
| `order.url` | ЛК / заказ |
| `order.pay_url` | deep-link оплаты (guest: `/order/pay?…`) |
| `order.reserve_hours` | ceil(TTL/60) — SLA overdue в тексте (не авто-отмена) |
| `order.total_label` / `*_label` | суммы с ₽ |
| `order.tracking` / `tracking_block` | трек |
| `order.cancel_reason` | текст отмены |
| `order.changes_summary` | что изменили |
| `order.surcharge_label` | доплата |
| `order.refund_*` | возврат |
| `gift.items_html` / `gift.items_text` | коды |
| `chat.snippet` / `chat.url` | чат |
| `customer.greeting` | «Анна, » или пусто |
| `site.url` / `site.name` | витрина / бренд |

Полный список по событию — в карточке шаблона в Admin и в `variables` реестра.

---

## Hardcoded (код)

| Письмо | Триггер | Где |
|--------|---------|-----|
| OTP регистрации | `auth/register/start` | `MailService.sendRegistrationOtp` |
| Сброс пароля покупателя | password-reset | `sendPasswordResetLink` |
| Welcome сотрудника | создание staff | `sendStaffAdminWelcome` |
| Сброс пароля staff | admin reset | `sendStaffAdminPasswordReset` |
| OPS / Ozon / late pay | мониторинг, сбои | `notifyCustomer` / `sendRaw` |

Их нельзя править в «Настройки → Email».

---

## Проверки

```bash
# SMTP / reminders на API
journalctl -u miraflores-api --since "1 hour ago" --no-pager \
  | grep -iE "awaiting-payment reminder|email_notification|SMTP not configured|Staff admin welcome"

# env на VPS
grep -E '^(ORDER_AWAITING_TTL|ORDER_PAY_REMIND|SMTP_|MAIL_|FRONTEND_PUBLIC)' \
  /opt/miraflores/backend/.env
```

В карточке заказа Admin: события `PAYMENT_REMIND` (stage / catch-up); `CANCELLED` — только при ручной отмене. Чипы awaiting-payment — см. [structure.md](../structure.md).

---

## Связанные файлы

| Файл | Роль |
|------|------|
| `backend/src/mail/email-notification-events.ts` | реестр ключей и дефолтов |
| `backend/src/mail/email-notifications.service.ts` | CRUD шаблонов, preview, render |
| `backend/src/mail/mail.service.ts` | SMTP + send* |
| `backend/src/orders/order-awaiting-payment.service.ts` | remind only |
| `backend/src/orders/order-awaiting-payment-schedule.ts` | remind_* / catch-up / timeline chips |
| `backend/src/orders/orders-expiry.worker.ts` | тик 1 мин + advisory lock |
| `Admin/…/orders/AwaitingPaymentChips.tsx` | чипы 5м/24ч/48ч/72ч |
| `docs/order-chat.md` | чат (письма reply — здесь) |

Ops-обзор remind/воркера: [structure.md](../structure.md), [deploy.md](../deploy.md).
