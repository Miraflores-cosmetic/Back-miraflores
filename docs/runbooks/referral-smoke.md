# Smoke: MF referral wallet (перед prod)

Ручной прогон happy path. Предусловия: миграции referral применены, seed settings, SMTP/оплата как в staging.

Контракт: [docs/referral-wallet.md](../referral-wallet.md).

## 0. Prep

- [ ] Admin → **Настройки → Реферальная программа**: `enabled=on`, `%` > 0, quarantine `DELIVERED`, invitee bonus по желанию, `spendCapPercent` (напр. 50).
- [ ] Зафиксировать `enabledAt` (read-only под чекбоксом).
- [ ] Два покупателя: **реферер** A и **приглашённый** B (разные email/phone).
- [ ] У A есть код (ЛК или admin «Новый код»).

## 1. Link → attribution

- [ ] Открыть витрину с `?mf=<CODE_A>` (или скопировать из ЛК A).
- [ ] Cookie / attribution держится до checkout.
- [ ] Self-check: залогиниться как A с своим `?mf=` → attribution **не** должна создаться.

## 2. Order → PAID → pending

- [ ] B оформляет товарный заказ ≥ `minOrderRub`, без promo/gift если планируете spend позже.
- [ ] Оплатить → статус **PAID**.
- [ ] Admin заказ → «Рефералка Miraflores»: код, реферер A, **Earned / pending** > 0 (PENDING).
- [ ] Если invitee bonus вкл и B auth: строка **«Бонус приглашённому»**; ledger role invitee.
- [ ] ЛК A: pending баланс; история с номером заказа, без PII B.

## 3. DELIVERED → available

- [ ] Admin: заказ → **DELIVERED**.
- [ ] Ledger A: EARN → **POSTED**; ЛК A: available увеличился, pending упал.
- [ ] (Если quarantine = DAYS_AFTER_PAID: ждать worker ~60s после N дней — на staging временно `quarantineDays=1` + подкрутка `paidAt` только на dev.)

## 4. Spend

- [ ] B (или A) на checkout включает «списать с реф. кошелька».
- [ ] С promo **или** gift → отказ (XOR).
- [ ] Сумма ≤ `available` и ≤ `spendCapPercent` × total.
- [ ] Создать заказ → `referralWalletAmount` > 0; ledger `SPEND_HOLD`.
- [ ] Cancel unpaid → `SPEND_RELEASE`, баланс вернулся.

## 5. Clawback / ADJUST (кратко)

- [ ] Отдельный заказ: PAID → DELIVERED → cancel/refund → clawback ≤ available, available не < 0.
- [ ] Admin ADJUST +100 → повтор того же запроса с тем же Idempotency-Key → `replayed`, баланс не удвоился.
- [ ] ADJUST amount `0` → 400 (DTO).

## 6. Disable / regenerate

- [ ] Admin: Выкл код A → confirm → новый `?mf=` не атрибутирует.
- [ ] Вкл обратно.
- [ ] «Новый код» → confirm → старый CODE невалиден, новый работает.

## Pass criteria

Все чекбоксы без P0. Автопокрытие тех же веток: `npx vitest run src/referral` в `backend/` (см. таблицу в `docs/referral-wallet.md`).
