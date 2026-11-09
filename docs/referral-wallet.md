# Реферальный кошелёк Miraflores (MF)

Внутренний wallet магазина (`?mf=`), **отдельно** от партнёрки YouRich. Оба могут жить на одном заказе независимо; в админке и ЛК UI разделён.

Smoke перед prod: [runbooks/referral-smoke.md](./runbooks/referral-smoke.md).

## YouRich vs MF

| | **YouRich** | **MF referral wallet** |
|---|-------------|------------------------|
| Цель | Внешняя партнёрка / CRM lead | Баланс в магазине (earn → spend на checkout) |
| Атрибуция | promo affiliate / refHash YouRich | `?mf=` → `OrderReferralAttribution` |
| База % | `computeCommissionBase` (= leadSum) | тот же `computeCommissionBase` |
| Выплаты | YouRich outbox / CRM | Ledger `ReferralWalletLedger` (PENDING → POSTED) |
| Spend | — | XOR с promo / gift; cap `%` от total |
| Админка | блок YouRich на заказе | `/admin/settings/referral` + блок «Рефералка Miraflores» |

Общая база: `backend/src/orders/commission-base.ts` — goods − promo − gift − wallet − refunds (без доставки).

## Поток (happy path)

1. Реферер получает код (`ensure` / regenerate) → шарит `?mf=CODE` (+ UTM).
2. Покупатель оформляет заказ с attribution (self-block: userId / email / phone).
3. **PAID** → `EARN` PENDING (+ опционально `INVITEE_BONUS` PENDING, только auth, lifetime 1×).
4. Карантин: `DELIVERED` **или** worker `DAYS_AFTER_PAID` (snapshot в note) → POSTED.
5. Cancel / refund → void PENDING или `CLAWBACK` ≤ available.
6. Checkout spend → `SPEND_HOLD` (≡ capture); cancel unpaid / full refund → `SPEND_RELEASE`.

## Admin knobs

UI: **Настройки → Реферальная программа** (`/admin/settings/referral`).  
API: `GET|PUT /settings/admin/referral` (ACL `settings`).

| Knob | Смысл | Ретроактивность |
|------|--------|-----------------|
| `enabled` / `enabledAt` | Программа вкл; `enabledAt` stamp при false→true | Attribution до `enabledAt` не earn |
| `earnPercent` | % от commission base | Только новые EARN (snapshot в note) |
| `earnMode` | `EVERY` \| `FIRST_GOODS_ORDER` | Новые заказы |
| `linkTtlDays` | TTL attribution в **localStorage** (`miraflores.mf.ref.v1`); публично `GET /settings/referral`, также `/account/me` → `referralLinkTtlDays` | Новые клики `?mf=` |
| `minOrderRub` | Мин. заказ для create earn | Только create |
| `quarantineMode` / `quarantineDays` | `DELIVERED` или N дней после PAID | Snapshot на EARN; live settings не двигают старые |
| `inviteeBonusEnabled` / `inviteeBonusRub` | Бонус приглашённому (auth only) | Новые |
| `spendCapPercent` | max wallet ≤ % от total заказа | Checkout |
| `shareText` | Шаблон шаринга `{link}` `{code}` | ЛК |

Смена % / quarantine **не** пересчитывает уже созданные ledger-строки.

## Ledger kinds

| Kind | Знак | Когда |
|------|------|--------|
| `EARN` | + | Реферер, PAID |
| `INVITEE_BONUS` | + | Buyer, first qualifying (не в referrer earned) |
| `CLAWBACK` | − | Cancel/refund после POSTED; ≤ available. Note: `clawback earn;` vs `clawback invitee;` — earnedNet только earn |
| `SPEND_HOLD` | − | Checkout hold (**≡ capture**): available↓ сразу при create |
| `SPEND_RELEASE` | + | Отмена unpaid / полный refund wallet |
| `ADJUST` | ± | Ручная корректировка админом (Idempotency-Key) |
| `SPEND_CAPTURE` | — | **Dead.** В enum оставлен (PG enum drop дорогой); **не писать**. Hold≡capture → только `SPEND_HOLD`. Фильтр `kind ≠ SPEND_CAPTURE` в ЛК/order summary. **Миграция удаления enum — позже** (не в текущем релизе). |

### Earn note + quarantine snapshot

Новые EARN/INVITEE_BONUS: `base=…;pct=…;qMode=DELIVERED|DAYS_AFTER_PAID;qDays=N`.

| Note | Поведение |
|------|-----------|
| Полный snapshot (`qMode`+`qDays`) | Карантин **только** из note; live settings не двигают |
| **Legacy** `base=…;pct=…` без `q*` | `resolveQuarantine` подставляет **live** `quarantineMode`/`quarantineDays` (единственный fallback). Shrink PENDING **не** дописывает live q* в note. **Оставить как есть** — не вычищать legacy rows / не форсить rewrite note. |

ЛК labels (Front `ReferralContent`): CLAWBACK = «Списание начисления», ADJUST = «Корректировка» (не смешивать).

## API (кратко)

| Метод | Путь | Назначение |
|-------|------|------------|
| GET/PUT | `settings/admin/referral` | Settings |
| GET | `settings/admin/referral/referrers` | Список (earnedGross / earnedNet / inviteeClawback) |
| POST | `settings/admin/referral/users/:id/adjust` | ADJUST (`Idempotency-Key`) |
| PUT | `settings/admin/referral/users/:id/active` | Вкл/выкл кода (ACL **settings**) |
| POST | `settings/admin/referral/users/:id/regenerate` | Новый код (ACL **settings**; страница рефералки) |
| POST | `users/admin/:id/referral/regenerate` | Тот же regenerate (ACL **users**; карточка покупателя) |
| GET | `settings/referral` | Public: `{ linkTtlDays }` для витрины |
| GET | `account/me` | `referralLinkTtlDays` (+ wallet / cap) |
| GET | `account/me/referral` + ledger | ЛК dual balance / история (`?filter=all\|pending\|spend`) |

**Dual ACL:** disable + regenerate на `/admin/settings/referral` идут через `settings/admin/referral/*` — staff с секцией `settings` без `users` может менять код. Карточка `/admin/users/:id` по-прежнему зовёт `users/admin/.../regenerate` (нужен grant `users`).

## Specs (Phase 6 coverage)

| Тема | Файл |
|------|------|
| Earn / quarantine / clawback / enabledAt / minOrder / FIRST | `referral-wallet.service.spec.ts` |
| Spend hold/release / cap / P2002 | `referral-wallet-spend.spec.ts` |
| XOR / guest / refund release | `referral-spend.flow.spec.ts` |
| Invitee bonus + ledger PII | `referral-invitee-bonus.spec.ts` |
| Self-ref + inactive | `referral-attribution.spec.ts` |
| Codes | `referral-code.spec.ts` |
| Admin list / ADJUST idempotency / order summary | `referral-admin.spec.ts` |
| Commission base | `orders/commission-base.spec.ts` |

```bash
cd backend && npx vitest run src/referral src/orders/commission-base.spec.ts
```

## Out of scope

Вывод денег, multi-level, лимит earn/мес, антифрод-фильтр, экспорт earned, guest как реферер.
