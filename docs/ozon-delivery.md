# Ozon Доставка

Как устроена интеграция Ozon Доставки в Miraflores: подключение, пункты выдачи, расчёт цены, оформление отправлений, мониторинг. Складской регламент — [runbooks/ozon-fulfillment.md](runbooks/ozon-fulfillment.md).

## Коротко

- Покупатель выбирает на витрине **пункт выдачи Ozon** (ПВЗ/постамат) или **курьера**. Цена — по **собственной тарифной сетке**: у приложения Ozon Доставки нет метода расчёта стоимости.
- Отправления **оформляются вручную в кабинете Ozon**: у API нет создания отправлений для нашего типа приложения. Номер отправления вносится в заказ как трек.
- Если Ozon не подключён или API недоступен, витрина **скрывает Ozon** и предлагает СДЭК. Ошибок 5xx на checkout нет.

## Архитектура

```
Front (витрина)                      backend (Nest)                               Ozon
─────────────────                    ─────────────────────────────                ─────────────
AddressDrawer / OzonPvzList  ──►  GET  /delivery/ozon/availability
                             ──►  POST /delivery/ozon/pickup-points  ──► OzonPointsService ──► /v1/delivery/point/list (кэш 1 ч)
                                                                                         └─► /v1/delivery/point/info (кэш 6 ч)
useCdekShippingEstimate      ──►  POST /orders/shipping-estimate/ozon ─► estimateOzonDelivery (ozon-tariff.ts)
OrderLeftPart (checkout)     ──►  POST /orders/shipping-quote  ──► тот же расчёт → HMAC-quote (15 мин)
                             ──►  POST /orders  (проверяет quote)

Admin                        ──►  /delivery/ozon/admin/*  (супер-админ)   OzonAuthService ──► OAuth xapi.ozon.ru
                             ──►  /orders/admin/:id/ship, /shipment-cost
                                  OzonHealthService (фон, каждые 30 мин) ──► токен + справочник ПВЗ → алерты
```

| Модуль | Файл |
|--------|------|
| OAuth, токены, статус подключения | `backend/src/ozon/ozon-auth.service.ts` (refresh token шифруется: `ozon-crypto.ts`) |
| Пункты выдачи | `backend/src/ozon/ozon-points.service.ts`, `ozon-points.util.ts` |
| Посылка из каталога | `backend/src/ozon/ozon-package.ts`, загрузка вариантов — `ozon-variant-dims.ts` |
| Тарифная сетка | `backend/src/ozon/ozon-tariff.ts` |
| Аудит габаритов каталога | `backend/src/ozon/ozon-dims-audit.ts`, `ozon-catalog-dims.service.ts` |
| Сверка тарифа | `backend/src/ozon/ozon-reconciliation.ts`, `ozon-reconciliation.service.ts` |
| Мониторинг | `backend/src/ozon/ozon-health.service.ts`, `ozon-health.util.ts` |
| Витрина | `Front/src/lib/carrierAvailability.ts`, `Front/src/utils/checkoutShipping.ts`, `OzonPvzList` |
| Админка | `Admin/app/(admin)/admin/settings/delivery/*`, `Admin/lib/shipping/ozonFulfillment.ts`, `Admin/app/(admin)/admin/orders/OzonShipmentPanel.tsx` |

Данные в БД:

| Таблица | Что хранит |
|---------|-----------|
| `OzonIntegration` (одна строка `default`) | Зашифрованный refresh token, кто и когда подключил, `lastError`, поля мониторинга (`lastCheckAt`, `lastCheckOk`, `lastPointCount`, `consecutiveFailures`, `alertState`, `lastAlertAt`) |
| `OzonHealthCheck` | История проверок за 14 дней |
| `Shipment` (provider `OZON`) | Трек; `carrierCostRub` (факт из кабинета), `estimatedCostRub`, `billableGrams`, `tariffVersion` (оценка на момент ввода факта) |

Обе служебные таблицы — под RLS с доступом только через системный bypass. Эндпоинты Ozon помечены `@SkipRlsTransaction`, сервисы открывают bypass-транзакцию сами.

## Переменные окружения

**backend/.env**

| Переменная | Назначение |
|-----------|-----------|
| `OZON_CLIENT_ID`, `OZON_CLIENT_SECRET` | Приложение «Ozon Доставка» (dev.ozon.ru). Секрет же — ключ шифрования refresh token: при смене секрета нужно переподключиться |
| `OZON_OAUTH_REDIRECT_URI` | По умолчанию `${FRONTEND_PUBLIC_URL}/api/v1/delivery/ozon/oauth/callback`; должен совпадать с настройкой приложения |
| `OZON_OAUTH_SCOPE` | По умолчанию `seller-api.ozon-logistics` |
| `OZON_OAUTH_AUTHORIZE_URL`, `OZON_OAUTH_TOKEN_URL`, `OZON_API_URL` | Переопределение адресов Ozon (обычно не нужно) |
| `OZON_SELLER_ID`, `OZON_API_KEY` | Альтернатива OAuth: ключ Seller API |
| `ADMIN_PUBLIC_URL` | Куда вернуть после OAuth; ссылка в письмах-алертах |
| `OZON_TARIFF_PVZ_TIERS` | Override сетки ПВЗ: `"0.4:49,1:79,…,max:799"` (кг:₽, цены не убывают). Невалидная строка игнорируется — берётся дефолт |
| `OZON_TARIFF_COURIER_MULTIPLIER` | Курьер = цена ПВЗ × множитель (1–5, по умолчанию 1.8) |
| `OZON_TARIFF_VERSION` | Метка версии сетки при override (попадает в отправления для сверки) |
| `OZON_HEALTH_INTERVAL_MIN` | Интервал фоновых проверок, мин (по умолчанию 30, минимум 5, `0` — выключить) |
| `OPS_ALERT_EMAIL` (или `SUPPORT_EMAIL`) | Куда слать алерты |
| `SHIPPING_QUOTE_TTL_SECONDS` | Время жизни подписанного quote (по умолчанию 900) |
| `YANDEX_DELIVERY_ENABLED` | Яндекс Доставка скрыта; `true` — вернуть |

**Admin/.env**: `NEXT_PUBLIC_OZON_CABINET_URL` (ссылка «Открыть кабинет», по умолчанию `https://seller.ozon.ru/`), `NEXT_PUBLIC_YANDEX_DELIVERY_ENABLED`.

**Front/.env**: `VITE_YANDEX_DELIVERY_ENABLED`.

## Подключение

1. В dev.ozon.ru в приложении «Ozon Доставка» указать Redirect URI (виден в админке).
2. Админка → Настройки → **Службы доставки** → «Подключить Ozon» → вход в кабинет продавца → разрешить доступ.
3. «Проверить API» — должен загрузиться справочник пунктов.

Подключённым Ozon считается, если есть refresh token (при заданных `OZON_CLIENT_ID`/`SECRET`) или ключ API. Если Ozon отвечает `invalid_grant` / `invalid_refresh_token`, токен удаляется, и витрина сразу перестаёт предлагать Ozon.

## Мета доставки в адресе

Выбор покупателя хранится в первой строке `streetAddress2` (витрина) / `comment` (заказ):

```
__VSP:carrier=ozon|lon=37.6|lat=55.7|pvz=1011000000123|dropoff=pvz__
Человекочитаемое описание пункта…
```

- `carrier` — `cdek` | `ozon` | `yandex`; `dropoff` — `pvz` | `courier`.
- `pvz` — для Ozon это **`map_point_id`** (не код ПВЗ СДЭК); дублируется в `shippingAddress.pvzCode`.
- Админка пишет эквивалентный формат `__JCOS:…__`; читаются оба (`Admin/lib/shipping/addressShippingMeta.ts`).
- Для Ozon ПВЗ без `pvz` заказ не создаётся; в админке такой заказ помечается блокером в чеклисте.

## Оценка и quote

| | Оценка (estimate) | Quote |
|-|-------------------|-------|
| Эндпоинт | `POST /orders/shipping-estimate/ozon` | `POST /orders/shipping-quote` |
| Для чего | Показать цену в корзине/адресе | Зафиксировать цену перед созданием заказа |
| Подпись | Нет | HMAC, живёт 15 мин; `POST /orders` без валидного quote отклоняется |
| Если Ozon не подключён | Отдаёт цену (сетка своя) — витрина всё равно скрывает Ozon по `availability` | 400 «Ozon Доставка временно недоступна…» |

Обе ветки вызывают одну функцию `estimateOzonDelivery(lines, dropoff)`, поэтому цена в корзине и в заказе совпадает. Бесплатная доставка в ПВЗ — по порогу из раздела «Корзина» (флаг `freePvz` в quote).

## Посылка и оплачиваемый вес

Для каждой строки корзины (`ozon-package.ts`):

1. **Вес и габариты варианта** из каталога, если они правдоподобны (5 г – 30 кг; стороны 5–1500 мм; вес не больше «5 г на мл + 400 г»).
2. Иначе **типоразмер по объёму** (`volumeMl`). Лесенка откалибрована по заполненным вариантам: 15 мл — 60 г, 39×39×110; 50 мл — 90 г, 39×39×152; до 100 мл — 140 г, 49×49×170; до 150 мл — 180 г; больше — `мл×1.1+40` г, 60×60×200.
3. Иначе **куб из `packageVolume`** (литры).
4. Иначе дефолт «средняя баночка»: 120 г, 45×45×140 мм. Раньше дефолт был 300 г / 3 л и завышал оплачиваемый вес примерно в четыре раза.

Посылка: сумма по строкам + 40 г упаковки; объём × 1.25 на пустоты. **Оплачиваемый вес** = max(вес, объём в литрах / 5).

Полнота каталога видна в «Службы доставки» → **«Габариты каталога»**: сколько вариантов заполнено, что подозрительно (например, 70 000 г у 30 мл), и предложения. Предложения берутся из самого каталога: сначала вариант того же товара с тем же объёмом, потом самый частый типоразмер этого объёма, потом лесенка. Если у варианта уже валидная коробка, вес берётся у вариантов того же объёма с той же коробкой (30 мл в 39×39×110 весит 70 г, а в 49×49×170 — 170 г). «Применить» записывает только пустые или ошибочные поля. Варианты без объёма (пробники, «Стандарт», твёрдые «20 г») предложений не получают: их правят кнопкой «Править» в строке — вес в граммах и три стороны упаковки в мм (стороны меняются только тройкой, границы 5–30 000 г и 5–1 500 мм). API: `GET /delivery/ozon/admin/catalog-dims`, `POST /delivery/ozon/admin/catalog-dims/apply { variantIds }`, `PATCH /delivery/ozon/admin/catalog-dims/:variantId { weightGrams?, lengthMm?, widthMm?, heightMm? }` (возвращает обновлённый аудит).

## Тарифная сетка

Дефолт — `DEFAULT_OZON_TARIFF` в `ozon-tariff.ts` (версия `2026-09-local-v1`):

| Оплачиваемый вес, кг | ≤0.4 | ≤1 | ≤2 | ≤3 | ≤5 | ≤10 | ≤20 | ≤35 | больше |
|----------------------|------|----|----|----|----|-----|-----|-----|--------|
| ПВЗ, ₽ | 49 | 79 | 99 | 129 | 169 | 249 | 399 | 599 | 799 |

Курьер — ПВЗ × 1.8. Сроки: ПВЗ 3–6 дней, курьер 2–4.

### Регламент сверки (раз в месяц)

1. Склад вносит фактическую стоимость каждого отправления из кабинета Ozon в заказ: «Отправления» → «Стоимость у Ozon, ₽» (`PATCH /orders/admin/:id/shipment-cost`). Вместе с фактом сохраняются оценка по действующей сетке, оплачиваемый вес и версия сетки. Незаполненные — чип «Ozon без факта стоимости» в списке заказов (`GET /orders/admin?flag=ozon_no_cost`, счётчики — `GET /orders/admin/ozon-flags`); карточка тарифа показывает их число со ссылкой.
2. Супер-админ открывает «Службы доставки» → **«Тарифная сетка Ozon»** (`GET /delivery/ozon/admin/tariff-reconciliation?days=90`):
   - смещение по сумме (факт − сетка) и средняя ошибка;
   - по каждой ступени ПВЗ — медиана факта; ступень помечается, если по ней **≥ 5 отправлений** и отклонение **≥ 10 %**;
   - для курьера — медиана отношения факт / цена ПВЗ против текущего множителя.
3. Если есть помеченные ступени, карточка показывает готовые строки `OZON_TARIFF_PVZ_TIERS` / `OZON_TARIFF_COURIER_MULTIPLIER` / `OZON_TARIFF_VERSION`. Проверить, добавить в `backend/.env`, перезапустить backend.
4. В ближайший релиз перенести сетку в `DEFAULT_OZON_TARIFF`, поднять `version`, убрать override из env.

Смещение в плюс означает, что Ozon берёт больше, чем мы закладываем: доставка недополучает деньги. Смещение в минус означает, что покупатель переплачивает и конверсия страдает.

### Почему не API-калькулятор

- У приложения «Ozon Доставка» (scope `seller-api.ozon-logistics`) нет метода цены: доступны справочник пунктов и данные о них.
- Метод `/v1/delivery/calculate` есть у отдельного продукта Ozon Rocket. Он требует своего договора и склада отгрузки (`fromPlaceId`) и возвращает цену по его тарифам, а не по нашему договору.
- Если Ozon откроет расчёт цены для приложения, достаточно заменить `estimateOzonDelivery` вызовом API в `ShippingServerEstimateService.estimateOzon`: оценка и quote уже идут через него. Сетку стоит оставить fallback-ом при недоступности API.

## Оформление отправлений

- **Автосоздания нет.** В заказе Ozon блок «Отправка» показывает плашку «Автосоздание отправления Ozon недоступно» с шагами и ссылкой на кабинет. «Данные для формы и чеклист» открывает все поля для формы Ozon с копированием.
- Пункт в блоке «Доставка» — **«Пункт Ozon · выбран покупателем»** с `map_point_id` и адресом. Он только для чтения: сменить можно через «Изменить адрес».
- В заказах Ozon служба отправки ограничена вариантами «Ozon» / «Самовывоз». Кнопок СДЭК («Создать в СДЭК», «пусто = создать в СДЭК») нет. «Заказ отправлен» требует трек.
- Чеклист — шаги из `OZON_CHECKLIST_STEPS`. Автоматические шаги отмечаются по статусу, треку, письму и факту стоимости; ручные хранятся на сервере в `OrderChecklistMark` (`PUT /orders/admin/:id/checklist {checklist:'ozon', stepId, done}`, в `getById` приходят как `checklist.ozon.<stepId> = {doneAt, doneBy}`) и видны всем сменам. Допустимые шаги — `ORDER_CHECKLIST_MANUAL_STEPS` в `backend/src/orders/order-checklist.ts`; старые отметки из `localStorage` переносятся на сервер при первом открытии чеклиста.

## Мониторинг и алерты

`OzonHealthService` раз в `OZON_HEALTH_INTERVAL_MIN` (первая проверка — через минуту после старта) и по кнопке «Проверить API» выполняет:

1. **Статус.** Если Ozon был подключён (`connectedAt`), а токена больше нет, сбой — `disconnected`.
2. **Токен** (`authHeaders`, при необходимости refresh). Ошибка — `refresh_failed`.
3. **Справочник ПВЗ.** Ошибка или устаревший кэш после ошибки — `points_failed`; ноль пунктов — `points_empty`.

Результат пишется в `OzonHealthCheck` (хранится 14 дней) и в поля `OzonIntegration`. **Алерт** уходит после 2 неудачных проверок подряд; пока сбой продолжается, повтор — не чаще раза в 6 часов. После первой успешной проверки уходит письмо «восстановлено». Канал: лог `OPS_ALERT ozon_health …` и письмо на `OPS_ALERT_EMAIL` / `SUPPORT_EMAIL`.

Если Ozon ни разу не подключали, проверки ничего не пишут и не алертят.

Дашборд — «Службы доставки» → **«Мониторинг Ozon»**: последняя проверка, число пунктов, доля успешных за 24 ч, настроены ли письма, полоса истории (наведение показывает детали). API: `GET /delivery/ozon/admin/health`.

## Ограничения API Ozon

- Нет расчёта цены и нет создания отправлений (см. выше).
- `point/list` — весь справочник одним ответом (десятки тысяч точек, до 2 минут). Кэш 1 час; при ошибке отдаётся прошлый список, и мониторинг это отмечает.
- `point/info` — до 100 id за запрос, кэш 6 часов, до 20 000 записей в памяти.
- Access token живёт около часа, refresh — по требованию. При 401 токен сбрасывается, и запрос повторяется один раз.
- Кэш в памяти процесса: при нескольких инстансах backend у каждого свой.

## Эндпоинты

| Метод | Путь (`/api/v1/…`) | Доступ |
|-------|--------------------|--------|
| GET | `delivery/ozon/availability` | публичный |
| POST | `delivery/ozon/pickup-points` | публичный, всегда 200 |
| GET | `delivery/ozon/oauth/callback` | OAuth |
| POST | `orders/shipping-estimate/ozon` | публичный |
| GET | `delivery/ozon/admin/status`, `health`, `tariff`, `tariff-reconciliation`, `catalog-dims` | супер-админ |
| POST | `delivery/ozon/admin/authorize-url`, `disconnect`, `test`, `catalog-dims/apply` | супер-админ |
| PATCH | `delivery/ozon/admin/catalog-dims/:variantId` | супер-админ |
| PUT | `orders/admin/:id/checklist` | админ |
| PATCH | `orders/admin/:id/shipment-cost` | админ (раздел «Заказы») |
| GET | `orders/admin?flag=ozon_no_track\|ozon_no_cost`, `orders/admin/ozon-flags` | админ (раздел «Заказы») |

## Ссылки в админке

- Настройки → Службы доставки: `/admin/settings/delivery` (подключение, мониторинг, тариф, габариты).
- Заказ: `/admin/orders/<id>` → «Отправка» и «Отправления».
- Вариант товара (вес и габариты): `/admin/catalog/products/<productId>/variants/<variantId>`.
