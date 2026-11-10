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
2. Покупатель: `?mf=` → LS; регистрация/login → sticky `referredByUserId`; createOrder подставляет код с сервера в TTL. Self-block: userId / email / phone (+ флаг адреса).
3. **PAID** → `EARN` PENDING (+ опционально `INVITEE_BONUS` PENDING, только auth, lifetime 1×).
4. Карантин: `DELIVERED` (touch сразу) **или** `DELIVERED_PLUS_DAYS` (touch ставит `availableAt=delivered+N`, worker) **или** `DAYS_AFTER_PAID` (`availableAt=paid+N`, worker).
5. Cancel / refund → void PENDING или `CLAWBACK` ≤ available.
6. Checkout spend → `SPEND_HOLD` (≡ capture); cancel unpaid / full refund → `SPEND_RELEASE`.

## Admin knobs

UI: **Настройки → Реферальная программа** (`/admin/settings/referral`).  
API: `GET|PUT /settings/admin/referral` (ACL `settings`).

| Knob | Смысл | Ретроактивность |
|------|--------|-----------------|
| `enabled` / `enabledAt` | Программа вкл; `enabledAt` stamp **только при первом** включении (re-enable не сбрасывает) | Attribution до `enabledAt` не earn |
| `earnPercent` | % от commission base | Только новые EARN (snapshot в колонках + note) |
| `earnMode` | Default `FIRST_GOODS_ORDER`; `EVERY` + опц. окно | Новые заказы |
| `earnWindowMaxOrders` / `earnWindowDays` | При `EVERY`: N заказов в M днях от первой покупки; max=0 → без лимита | Create |
| `monthlyEarnCapRub` | Месячный cap Σ EARN на реферера; 0 = ∞ | Create (урезает amount) |
| `linkTtlDays` | TTL: localStorage `miraflores.mf.ref.v1` **и** sticky `User.referredBy*` | Новые клики / bind |
| `minOrderRub` | Мин. заказ для create earn | Только create |
| `quarantineMode` / `quarantineDays` | `DELIVERED` \| `DELIVERED_PLUS_DAYS` \| `DAYS_AFTER_PAID` | Snapshot на EARN; live settings не двигают старые |
| `inviteeBonusEnabled` / `inviteeBonusRub` | Бонус приглашённому (auth only) | Новые |
| `spendCapPercent` | max wallet ≤ % от total заказа | Checkout |
| `shareText` | Шаблон шаринга `{link}` `{code}` | ЛК |

Self-ref: блок по userId/email/phone; совпадение адреса/ПВЗ → `addressMatchSuspect` на attribution (админка), attribution не отменяется.

Смена % / quarantine **не** пересчитывает уже созданные ledger-строки.

Regenerate: по умолчанию в админке **без grace** (aliases пользователя удаляются). `grace: true` — старый код в `ReferralCodeAlias` на `linkTtlDays`.

Частичный card refund при wallet: пропорциональный `SPEND_RELEASE` + уменьшение `referralWalletAmount` + рост `referralWalletReleasedAmount` (base = remaining+released, иначе вернувшийся credit раздувает earn). Gift/purchase — по-прежнему только полный refund.

## Ledger kinds

| Kind | Знак | Когда |
|------|------|--------|
| `EARN` | + | Реферер, PAID |
| `INVITEE_BONUS` | + | Buyer, first qualifying (не в referrer earned) |
| `CLAWBACK` | − | Cancel/refund после POSTED; ≤ available. Note: `clawback earn;` vs `clawback invitee;` — earnedNet только earn. `clawback debt;` — погашение DEBT из будущих EARN |
| `DEBT` | + (учёт) | Недостающий clawback при available=0; **не** в available. Spend блокируется при debt>0; погашение при postEarn |
| `SPEND_HOLD` | − | Checkout hold (**≡ capture**): available↓ сразу при create |
| `SPEND_RELEASE` | + | Отмена unpaid / полный refund wallet |
| `ADJUST` | ± | Ручная корректировка админом (Idempotency-Key) |

`enabled=false` гейтит только **create** EARN/INVITEE_BONUS; void / clawback / post / quarantine / **spend** — всегда (баланс не замораживается).

Touch: `ReferralTouchOutbox` upsert **в tx** смены статуса + after-commit touch; worker retry PENDING/ERROR; после MAX → `DEAD` (админка → Retry). `reconcileMissedTouches` — PAID без outbox / cancel без clawback.

Address/ПВЗ overlap с заказами реферера → `addressMatchSuspect`; earn/invitee не POSTED до «Разрешить начисление» в карточке заказа.

DEBT гасится из любого положительного POSTED (EARN / SPEND_RELEASE / ADJUST+), не только postEarn; earnedNet учитывает clawback `source=debt`.

### Ledger meta (колонки + note)

Canonical snapshot на `ReferralWalletLedger`: `qMode`, `qDays`, `earnBase`, `earnPct`, `source` (`earn` \| `invitee` \| `debt` для CLAWBACK/DEBT). Note остаётся human-readable (`encodeEarnMeta` / префиксы clawback) и fallback для legacy.

| Строка | Поведение |
|--------|-----------|
| Колонки заполнены | Карантин / % / source из колонок; live settings не двигают. При create: `availableAt = paidAt+qDays` (DAYS) или `null` (DELIVERED) |
| **Legacy** только note (`base=…;pct=…` ± `q*`) | `earnMetaFromRow` / `resolveLedgerSource` читают note. Без `q*` — live `quarantineMode`/`quarantineDays`. Backfill колонок: `20261110200000_referral_ledger_meta_drop_capture`. |

Worker `processDueQuarantine`: SQL `status=PENDING AND availableAt ≤ now` (не сканирует DELIVERED-mode с `availableAt=null` — иначе starvation).

ЛК labels (Front `ReferralContent`): CLAWBACK = «Списание начисления», ADJUST = «Корректировка» (не смешивать).

## Воронка / клики (?mf=)

Таблица `ReferralMfVisitDaily` (день Москва × код, `visits++`).

| Слой | Путь |
|------|------|
| Beacon | Front `postMfVisit` — dedupe код×день (МСК) + session; только после `captureMfFromUrl` |
| Public | `POST settings/referral/visit` — пишет только **resolved** live/alias; мусор не создаёт строк |
| Admin | `GET settings/admin/referral/funnel?period=last_7` → totals / rates / topCodes / series |
| UI | Админка → Реферальная программа → вкладка «Воронка» |

Стадии: **клики** (агрегат) → **sticky** (`User.referredByAt`) → **заказы** (`OrderReferralAttribution`) → **оплачено** (PAID\|PACKING\|SHIPPED\|DELIVERED).

## Email (mail module)

После commit RLS-транзакции (`scheduleAfterRlsCommitWithBypass`):

| Событие | Ключ шаблона | Когда |
|---------|--------------|--------|
| Created | `referral_earn_created` | create PENDING `EARN` / `INVITEE_BONUS` (не на P2002) |
| Posted | `referral_earn_posted` | `postEarn` (touch DELIVERED / quarantine worker) |
| Clawback | `referral_clawback` | `clawbackIfNeeded` при `take > 0` (не debt-repay) |

Админка → Email-уведомления: шаблоны редактируемые. Push/FCM в проекте нет.

## API (кратко)

| Метод | Путь | Назначение |
|-------|------|------------|
| GET/PUT | `settings/admin/referral` | Settings (+ audit revision на PUT) |
| GET | `settings/admin/referral/liability` | Σ available + pending (+ debt) |
| GET | `settings/admin/referral/revisions` | История смен настроек |
| GET | `settings/admin/referral/funnel` | Воронка клик→sticky→заказ→оплата |
| GET | `settings/admin/referral/referrers` | Список + sort=`earned\|invitees\|gmv\|id`, invitees, GMV |
| POST | `settings/referral/visit` | Public beacon клика ?mf= |
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
| Mail sendReferral* | `mail/mail.service.spec.ts` |
| Commission base | `orders/commission-base.spec.ts` |

```bash
cd backend && npx vitest run src/referral src/orders/commission-base.spec.ts
```

## Out of scope

Вывод денег, multi-level, антифрод-фильтр, экспорт earned, guest как реферер, push.
