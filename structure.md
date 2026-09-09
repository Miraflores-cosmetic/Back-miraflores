# Structure — Miraflores 3.0

Магазин косметики: витрина (Vite) + Nest API + Next Admin.  
Прод и деплой: [deploy.md](./deploy.md).

Покупательская витрина (каталог, PDP, отзывы `/reviews`) — только **Front** (Vite).
`Admin/app/(site)` — превью/служебный site-контур (не публичная витрина отзывов); PDP там показывает те же атрибуты товара, что и Front.

---

## Репозитории

| Папка / репо | Содержимое | Git remote |
|--------------|------------|------------|
| корень монорепо | `backend/`, `Admin/`, `packages/`, `deploy/` | `Miraflores-cosmetic/Back-miraflores` |
| `Front/` | витрина (отдельный git) | `Miraflores-cosmetic/Front-end-site` |

npm workspaces в корне: `backend`, `Admin`, `packages/*`.  
`Front/` **не** в workspaces и **в `.gitignore`** монорепо.

---

## Слои

| Слой | Пакет | Порт (local) | Прод |
|------|-------|--------------|------|
| Front | Vite + React (в `Front/`) | `:5173` | static `/var/www/miraflores-front` |
| Admin | `miraflores-admin` (Next 14) | `:3010` | `/admin`, BFF `/api/*` |
| API | `miraflores-api` (Nest) | `:3001` | `/api/v1`, `/uploads` |
| Shared | `@miraflores/admin-sections`, `@miraflores/admin-types` | build → API + Admin | — |
| DB | Postgres `miraflores` | `:5432` | docker `miraflores_db` |
| 1С | Nest `1c/exchange` | — | `/api/v1/1c/exchange` (Битрикс CommerceML) |

Локально:

```bash
# mono
cp backend/.env.example backend/.env
cp Admin/.env.example Admin/.env.local
npm ci
npm run build -w @miraflores/admin-sections
npm run build -w @miraflores/admin-types
npm run dev:api      # :3001
npm run dev:admin    # :3010

# front (отдельный каталог)
cd Front && npm ci && npm run dev   # :5173
```

Админ seed: см. `ADMIN_SEED_*` в `backend/.env.example`.

---

## Дерево (значимое)

```
Miraflores 3.0/
├── deploy.md                 ← этот гайд: деплой
├── structure.md              ← структура
├── package.json              ← workspaces (без Front)
├── backend/                  ← Nest API (miraflores-api)
│   ├── prisma/               ← schema + migrations
│   │   └── … ProductAttributeOption / ProductAttributeCatalog
│   ├── src/
│   │   ├── auth/ staff/ orders/ catalog/ …
│   │   ├── onec/             ← обмен 1С CommerceML (заказы → 1C, опц. offers → сайт)
│   │   ├── user-groups/      ← группы, цены, visibility, commerce context, shared cache
│   │   ├── settings/         ← FAQ, hero, homepage-sets, menu, product-attributes, …
│   │   ├── mail/             ← SMTP, шаблоны писем
│   │   └── …
│   └── .env.example
├── Admin/                    ← Next admin + BFF
│   ├── app/(admin)/admin/    ← UI разделов
│   │   └── settings/
│   │       ├── user-groups/  ← группы, цены, visibility, участники (pickers)
│   │       └── attributes/   ← списки атрибутов товара
│   ├── app/(site)/product/   ← служебный PDP (meta: type/purpose/shelfLife/storage)
│   ├── app/api/              ← cdek, yandex, yookassa, …
│   └── .env.example
├── packages/
│   ├── admin-sections/       ← ACL-секции навигации
│   └── admin-types/          ← общие типы staff/ACL
├── deploy/
│   ├── deploy.env.example    → скопировать в deploy.env
│   ├── scripts/
│   │   ├── deploy-front.sh
│   │   ├── deploy-backend.sh
│   │   ├── lib.sh
│   │   ├── fix-localhost-urls.sql
│   │   ├── 00-survey.sh      ← разово (wipe)
│   │   └── 01-backup-saleor.sh
│   ├── nginx/miraflores.conf
│   ├── systemd/
│   └── docker-compose.yml    ← Postgres
├── Front/                    ← отдельный репозиторий
│   ├── src/
│   └── …
└── scripts/etl/              ← разовый ETL Saleor → miraflores (не runtime)
```

Не в runtime: `dumps/`, `static/` (legacy), `scripts/etl/` — только миграция данных.

---

## Маршруты и ответственность

### Nest (`/api/v1`)

- Auth / регистрация / reset password  
- Каталог, корзина, checkout, заказы  
- **Группы пользователей** (см. раздел ниже): `user-groups/admin/*`, `catalog/admin/visibility`  
- Staff ACL, настройки, сертификаты, блог, отзывы, …  
- Атрибуты товара (опции списков):
  - `GET|PUT /settings/admin/product-attributes` — CRUD опций (super-admin / settings); PUT с `expectedRevision` (optimistic concurrency, иначе 409)
  - `GET /catalog/admin/product-attribute-options` — read-only для формы товара (ACL catalog)
- **1С обмен** (см. раздел ниже): `GET|POST /api/v1/1c/exchange`  
- Uploads: `LOCAL_UPLOADS_*`  
- Почта: SMTP (заказы, staff welcome/reset)

### Next Admin (`/admin` + BFF)

- Операционка: заказы, каталог, staff, контент  
- Hub `/admin/settings` → **Атрибуты** (`/admin/settings/attributes`) — тип / для чего / срок / хранение  
- Форма товара: select по `*OptionId`; на Product хранятся FK + denormalized labels для витрины  
- BFF: СДЭК, Яндекс Доставка/карты, webhook ЮKassa  
- ACL: разделы из `@miraflores/admin-sections` (`orders`, `catalog`, `users`, `blog`, …); hub `/admin/settings` — только super-admin (`staff`)  
- **Группы** (`/admin/settings/user-groups`) — ACL `users`; nav: **Настройки → Группы пользователей** (grant `users`; не в группе «Пользователи»); hub «Настройки» — карточка у **super-admin** (badge «доступ: Пользователи»); legacy `/admin/user-groups/*` → redirect; pickers каталога требуют grant `catalog`

### Front (Vite)

- Витрина, ЛК, checkout (отдельный git, см. `Front/`)  
- API через `/api/v1` (прокси nginx → Nest)  
- PDP: meta type/purpose/shelfLife + хранение в описании; карточки (наборы, меню, квиз) — `productType`  
- Карты: `VITE_PUBLIC_YANDEX_MAP_API_KEY`  
- **Группы / промо:** см. gaps N1 и ISR ниже — parity с Admin `(site)` не полная

### Admin `(site)` — превью витрины (Next)

- Тот же buyer JWT + BFF, что и для checkout в Admin  
- ISR каталог (guest shell) + client hydrate для залогиненных — см. раздел «ISR / buyer context»

---

## Обмен с 1С (CommerceML)

Протокол как у Битрикс: `GET|POST /api/v1/1c/exchange?type=…&mode=…`.  
**Группы пользователей и групповые цены в 1С не участвуют** — только номенклатура (`onecId`), заказы и опционально offers.

### URL и auth

| Env | Назначение |
|-----|------------|
| `ONEC_LOGIN` / `ONEC_PASSWORD` | Basic Auth (задаёте сами; те же в настройках «Обмен с сайтом» в 1С) |
| `ONEC_CATALOG_IMPORT` | `0` (default) — **только заказы site→1C; `1` — ещё import offers.xml |
| `ONEC_EXPORT_CANCELLED` | `1` — выгружать CANCELLED/REFUNDED (default: PAID…DELIVERED) |
| `ONEC_EXCHANGE_DIR` | temp files (default `backend/.data/1c-exchange`) |

Prod URL: `https://miraflores-shop.com/api/v1/1c/exchange`

### Сценарии обмена

| type | mode | Направление | Поведение |
|------|------|-------------|-----------|
| — | `checkauth` | — | Basic → cookie-сессия `ONEC_SESSION_COOKIE` |
| `catalog` | `init` | — | `zip=no`, лимит файла |
| `catalog` | `file` | 1C → сайт | сохранить XML во temp |
| `catalog` | `import` | 1C → сайт | **offers.xml** → `ProductVariant.price/stock` по `onecId` (если `ONEC_CATALOG_IMPORT=1`); import.xml/catalog cards — skip |
| `sale` | `query` | сайт → 1C | CommerceML заказы с `onecExportedAt IS NULL` |
| `sale` | `success` | — | проставить `Order.onecExportedAt` |
| `sale` | `file` | 1C → сайт | no-op (статусы из 1С пока не применяем) |

### Модель данных

| Поле | Где | Зачем |
|------|-----|-------|
| `ProductVariant.onecId` | UUID номенклатуры 1С | match offers + строки заказа в XML |
| `ProductVariant.sku` | fallback в логах | — |
| `Order.onecExportedAt` | флаг выгрузки | не дублировать в `sale/query` |
| `OrderItem` без `onecId` / gratitude gift | — | не попадают в XML для 1С |

Строки заказа: `backend/src/onec/onec-orders.xml.ts` (доставка отдельной строкой без onecId).

### Утилиты

```bash
# Разово проставить onecId из offers.xml (из backend/):
npm run prisma:fill-onec-ids -- /path/to/offers.xml --dry-run
npm run prisma:fill-onec-ids -- /path/to/offers.xml
```

### Ключевые файлы

```
backend/src/onec/
  onec.controller.ts      ← HTTP exchange
  onec.service.ts         ← import/query/success
  onec-auth.ts            ← Basic + session cookie
  onec-session.ts         ← in-memory session + pending order ids
  onec-offers.parser.ts   ← offers.xml → price/stock/onecId
  onec-orders.xml.ts      ← Order[] → CommerceML
backend/.env.example      ← ONEC_*
```

---

## Атрибуты товара (модель)

| Kind | Product label (denorm) | Product FK |
|------|------------------------|------------|
| `productType` | `productType` | `productTypeOptionId` |
| `purpose` | `purpose` | `purposeOptionId` |
| `shelfLife` | `shelfLife` | `shelfLifeOptionId` |
| `storage` | `storageHtml` (plain, не rich HTML) | `storageOptionId` |

- Справочник: `ProductAttributeOption` (`@@unique([kind, label])`)  
- Версия каталога: `ProductAttributeCatalog` (`id=default`, `version`) — для PUT replace  
- Usage / rename / delete — по FK; публичный API по-прежнему отдаёт строки labels  

---

## LLM-ассистент админки (дашборд)

UI: панель **🤦‍♀️ Ассистент** на дашборде и в chrome (`AdminAssistantPanel`); ACL — `staffCanAssistant` (super-admin или grant analytics).

Backend: `POST /api/v1/assistant/admin/chat` (SSE), `AssistantService` + GPTunnel, tools только **read-only** (KPI, заказы, каталог, контент, **группы пользователей**).

| Tool | ACL | Назначение |
|------|-----|------------|
| `list_user_groups` | `users` | список групп, kind, флаги, counts |
| `get_user_group` | `users` | профиль + optional include (category_prices, variant_prices, visibility, members) |
| `list_discounts` | `discounts` | кампании Discount; `live=true` — идут сейчас |
| `get_discount` | `discounts` | кампания: scope, категории/товары, rules |
| `list_promo_codes` | `discounts` | промокоды checkout |
| `get_promo_code` | `discounts` | промокод по id/code; optional redemptions |
| `list_catalog_visibility` | `users` **or** `catalog` | global visibility rules |

Справочники prompt: `assistant-knowledge/user-groups.ts`, `assistant-knowledge/discounts-promo-visibility.ts`.

**Справочники для ответов «как настроить»** (не tools, не Cursor Skill) — блоки в system prompt:

| Тема | Файл |
|------|------|
| Группы пользователей | `backend/src/assistant/assistant-knowledge/user-groups.ts` → подмешивается в `ASSISTANT_SYSTEM_PROMPT` |

При добавлении новых доменов — новый файл в `assistant-knowledge/` + import в `assistant.constants.ts`. `structure.md` — для разработчиков; ассистент читает только prompt.

---

## Группы пользователей (User Groups)

Site-only (не синхронизируются с 1С). Один `User.groupId` на покупателя; контекст цен/видимости/промо — через `CommerceContextService`.

### Модель (Prisma)

| Сущность | Назначение |
|----------|------------|
| `UserGroup` | slug, flags, `allowCatalogDiscounts`, `allowPromoCodes`, `priceRounding` |
| `GroupVariantPrice` | override цены SKU (`groupId` + `variantId`) |
| `GroupCategoryPrice` | правило на **leaf**-категорию (`PERCENT_OFF` / `FIXED_OFF` / `FIXED_PRICE`) |
| `CatalogGroupVisibility` | правила видимости (PRODUCT / CATEGORY / VARIANT) |
| `User.groupId` | кастомная группа (nullable → registered default) |
| `Order.pricingGroupId/Name/Context` | snapshot группы на checkout |
| `OrderItem.baseUnitPrice` / `groupUnitPrice` | snapshot цен строки |

Системные группы (seed): `isDefaultGuest` (`guests`), `isDefaultRegistered` (`retail-registered`); partial unique на default-флаги. Удаление системных групп запрещено; **slug/active** системных — только read (service guard).

### Контекст покупателя (`CommerceContext`)

| kind | Когда |
|------|--------|
| `guest` | нет JWT / staff token / неактивный USER |
| `registered_default` | USER без `groupId` или неактивная кастомная группа |
| `registered_group` | USER + `groupId` + active group |

Приоритет цены: **SKU override** → **category rule** (walk ancestors, nearest wins) → base price.  
Кампании Discount — только если `allowCatalogDiscounts`. Промокод — только если `allowPromoCodes` (validate + create order).

### Цены категорий (write vs read)

| Слой | Поведение |
|------|-----------|
| **Admin write (category prices)** | Только **leaf**-категории: `assertLeafCategory()` + `DiscountCategoryPickerModal` (`leafOnly`) |
| **Admin write (visibility CATEGORY)** | Любая категория (`DiscountCategoryPickerModal` без `leafOnly`) — можно скрыть родительскую ветку |
| **Pricing engine read** | `category-tree.util` / `findNearestCategoryRule()` — **walk ancestors**, nearest rule wins |

Category prices: parent rule **нельзя** задать в UI цен категорий — только leaf; для ветки целиком — правило на каждый leaf или SKU override. Visibility на parent category — отдельно, через вкладку «Видимость».

**Витрина:** групповая цена в `price` на карточке/PDP; зачёркнутая база (`oldPrice`/`compareAt`) — только от `compareAt` в каталоге или кампании Discount, не автоматически от правила группы.

### Visibility

Режимы: `HIDE_FROM_GUESTS`, `HIDE_FROM_REGISTERED`, `HIDE_FROM_GROUP`, `SHOW_ONLY_REGISTERED`, `SHOW_ONLY_GROUP`.  
Category rules матчат **ancestors** продукта. **VARIANT** rules — на уровне variant (listing/PDP/cart/favorites), не на весь product.  
Каталог `listProducts`: при активных rules — paginate **после** visibility-фильтра (pool до `PUBLIC_PRODUCTS_IN_MEMORY_MAX`).

### Shared cache (`REDIS_URL`)

`UserGroupsSharedCacheService`: defaults + visibility rules; version key + pub/sub invalidate (`user-groups:shared:*`). Без Redis — in-memory + 30s TTL.  
Инвалидация при мутациях групп/visibility/defaults.

### Nest API

| Prefix | ACL | Содержимое |
|--------|-----|------------|
| `GET\|POST\|PATCH\|DELETE /user-groups/admin` | **`users`** | CRUD групп, SKU/category prices, members |
| `GET\|POST\|PATCH\|DELETE /user-groups/admin/:id/visibility` | **`users`** | visibility **конкретной группы** (UI: вкладка «Видимость») |
| `GET\|POST\|PATCH\|DELETE /catalog/admin/visibility` | **`catalog`** | **глобальный** реестр visibility (фильтры mode/target/groupId); отдельного UI пока нет |

**ACL split (hardened):** `resolveAdminSectionFromApiPath` — `/user-groups/admin` → `users`, `/catalog/admin/*` → `catalog`. Модератор с `users` правит visibility в карточке группы; с `catalog` — глобальный API (без привязки к одной группе). Nav: `/admin/settings/user-groups` → `users` (`packages/admin-sections`).

Members: `GET/POST /user-groups/admin/:id/members`, `DELETE …/members/:userId`.

### Admin UI

| Путь | UX |
|------|-----|
| `/admin/settings/user-groups` | список: поиск, фильтр **active** (все/активные/выкл.), колонки counts (участники, SKU, категории, visibility); create в **modal** (auto-slug из названия via `Admin/lib/slugify.ts`); после create → `/[id]` (вкладка «Общее») |
| `/admin/settings/user-groups/[id]?tab=` | deep-link вкладок; `resolveUserGroupTab()` — `?tab=members` на системной группе → fallback **general** |
| `/admin/user-groups/*` | legacy redirect → settings path |

**Карточка группы** — тонкий `UserGroupDetailClient` (shell + tabs + `refreshGroupMeta` для счётчиков):

| Вкладка | Компонент | Заметки |
|---------|-----------|---------|
| Общее | `UserGroupGeneralTab` | профиль, flags, delete (каскад SKU/category/visibility); системные — без delete |
| Участники | `UserGroupMembersTab` | только `assignable`; paginated; `ConfirmDialog` на remove |
| Цены | `UserGroupPricingTab` | pill-чипы **Категории** / **Товары**; `?tab=prices&section=products`; legacy `?tab=categories` → prices |
| ↳ Категории | `UserGroupCategoryPricesTab` | leaf-only; pill тип правила; soft limit ~50 |
| ↳ Товары | `UserGroupProductPricesTab` | один товар → −% или фикс ₽ по вариантам; список SKU-цен paginated (25) |
| Видимость | `UserGroupVisibilityTab` | self-load rules; product/category/variant pickers |

**Pickers (reuse catalog/discounts, не raw UUID):**

| Задача | Модалка |
|--------|---------|
| Product (visibility) | `DiscountProductPickerModal` (`single`) |
| Category prices | `DiscountCategoryPickerModal` (`single` + `leafOnly`) |
| Category visibility | `DiscountCategoryPickerModal` (`single`) |
| Variant (SKU price / visibility) | `VariantPickerModal` (gratitude/orders) |
| Member | `UserGroupMemberPickerModal` |

**IA / breadcrumbs:** `UserGroupPageNav` — «← Настройки» (+ «← Группы» на detail). Бейджи типа: `UserGroupKindBadge` — `catalogAdmin.badge*` (как статусы на `/admin/orders`). Розница/гости: «Авто · все зарег. без группы» / «Авто · все гости» (не пугающий 0 участников).

Instant-save чекбоксы и destructive — **toast** + **`ConfirmDialog`** (единый паттерн, не `window.confirm`).

`/admin/users/[id]` — dropdown группы (как раньше). Назначение — вкладка «Участники» или карточка пользователя.

### Storefront / BFF (Admin `app/(site)` + `app/api/public`)

- Cookie покупателя: `miraflores_buyer_token` (legacy `jcos_buyer_token` читается)  
- `buyerForwardHeaders()` — JWT на catalog/cart/orders/promo validate  
- `GET /account/me` → `pricing.group`; профиль ЛК показывает группу  
- Избранное: `listItems` — group price + visibility + campaigns; **add без visibility** (см. F1)  
- Admin order + buyer order detail: `pricingGroupName` / snapshot  
- **Admin cart/checkout:** `CartContext` читает `pricing.allowPromoCodes` из `cart/sync`; drawer/checkout блокируют промо

### ISR / buyer context (каталог)

SSR/ISR всегда **guest** (Nest без JWT): `Admin/lib/publicCatalog.ts` → `fetch(url, { next: { revalidate: 120, tags: ['catalog'] } })`.  
On-demand: `POST /api/admin/revalidate-catalog`.

| Поверхность | SSR (guest shell) | Client hydrate (buyer JWT) | Статус |
|-------------|-------------------|----------------------------|--------|
| PLP `/catalog/*` (без `?q`) | `fetchPublicProductsPage` | `CatalogClient` → `fetchPublicProductsPageClient` | ✅ |
| PLP `/catalog?q=…` | `fetchPublicSearch` + `fetchPublicProductsPage(slugs)` | **`CatalogClient` skip hydrate при `q`** (`if (q) return`) | ❌ guest |
| PDP `/product/[slug]` | `fetchPublicProduct` | `ProductInteractive` → refetch via BFF | ✅ |
| Set siblings | ISR | `ProductSetSiblings` → `fetchPublicSetSiblingsClient` | ✅ |
| **Home `/`** | `fetchPublicProducts` + `fetchPublicCollections` (featured + main collections, `includeProducts=1`) | `fetchPublicCollectionsClient()` **есть, не используется** | ❌ guest |
| BFF | — | `/api/public/catalog/*` + `buyerForwardHeaders()` | ✅ |

Первый paint для залогиненного на home — гостевые цены/видимость в «все товары», **FeaturedCollections** и остальных коллекциях; после client refetch (где есть) — актуальный контекст.

**Search:** `GET /search` → `SearchPublicService` — прямой Prisma, **без** `CommerceContextService` (base `variant.price`, без visibility filter). PLP search hydrate: `catalogLoad.hydrateSearchPage` → guest `fetchPublicSearch` + guest cards by slug.

### Известные пробелы (groups / storefront)

| ID | Проблема | Admin `(site)` | Vite `Front/` |
|----|----------|----------------|---------------|
| **N1** | `cart/sync` → `pricing.allowPromoCodes` | ✅ `CartContext` + checkout/drawer | ❌ нет в `CartSyncResponse` / `checkoutSlice` |
| **H1** | Home: featured collections + product strip — guest ISR | ❌ `page.tsx` только `fetchPublicCollections` / `fetchPublicProducts`; **`fetchPublicCollectionsClient` не wired** | ❌ аналогично |
| **S1** | Search без commerce ctx | ❌ `SearchPublicService` + `hydrateSearchPage`; при `?q` client hydrate **отключён** | ❌ `/search` + PLP search guest |
| **ISR** | Guest shell (общее) | PLP/PDP/set-siblings ✅ | client refetch коллекций с buyer JWT |

**N1 fix (Front):** parity `Admin/lib/cart/CartContext.tsx` — gating промо по `pricing.allowPromoCodes`.

**H1 fix:** client wrapper на `Admin/app/(site)/page.tsx` → `fetchPublicCollectionsClient()` + refetch «все товары» (`fetchPublicProductsPageClient`) при login.

**S1 fix:** `SearchPublicService.search()` через commerce pipeline (visibility + group price); PLP `?q` — buyer-aware hydrate (re-search + slugs через BFF); убрать `if (q) return` в `CatalogClient` или отдельный search hydrate path.

### Улучшения (backlog)

| ID | Область | Сейчас | Цель |
|----|---------|--------|------|
| **F1** | Избранное | `add` / `replace` — только `requireActiveVariant` (active + не excludeFromCatalog); **visibility не проверяется**. `listIds` — все variantId. **Фильтр visibility только в `listItems`**. | На add/replace — `filterVisibleVariantIds` для контекста покупателя; опционально чистить «невидимые» при listIds или lazy purge |
| **A1** | Admin ACL + UX | Visibility группы — ✅ вкладка `/admin/settings/user-groups/[id]` (`users` ACL). Pickers — ✅ reuse `Discount*PickerModal` + `VariantPickerModal`. Глобальный `catalog/admin/visibility` — API есть, **UI нет**. | Общий **VisibilityRulesEditor** + global UI под `catalog` ACL; group tab — thin wrapper (`groupId` preset). Category prices list — paginate при >~50 |
| **O1** | Admin заказ | `OrderItem.baseUnitPrice` / `groupUnitPrice` пишутся на create (`orders.public.service`); **admin serializer не отдаёт** → UI только `unitPrice` (финал после кампаний). `pricingGroupName` на заказе — ✅ | Строки заказа в admin: base / group / charged; tooltip «групповая скидка»; опционально buyer order detail |
| **G1** | Cart sync + gratitude | Catalog lines: `baseUnitPrice` + `groupUnitPrice` в `cart/sync`. **Gift denom** — только `price`/`listPrice`, без snapshot-полей. **Gratitude** attach на create — `price: 0`, без base/group snapshot; `getApplicableGift` — subtotal + OOS, **без commerce ctx / visibility** | Gift lines — те же snapshot-поля где уместно; gratitude — catalog value snapshot + политика: skip если variant hidden для buyer ctx; preview `applicable-gift` с JWT |

**F1** files: `backend/src/account/favorites.service.ts` (`add`, `replace` vs `listItems`).

**A1** files: `UserGroupVisibilityTab.tsx`, `UserGroupCategoryPricesTab.tsx`, `DiscountScopePickerModal.tsx` (`single`/`leafOnly`), `packages/admin-sections` (ACL matrix), future `/admin/catalog/visibility`.

**O1** files: `orders-admin.service.ts` (items map), `Admin/lib/adminOrderTypes.ts`, `OrderDetailClient.tsx`.

**G1** files: `catalog.public.service.ts` (`syncCart` giftItems), `orders.public.service.ts` (`resolveGratitudeGiftLine`), `settings.service.ts` (`getApplicableGift`).

### Тесты (`backend/src/user-groups/`)

| Файл | Что |
|------|-----|
| `catalog-visibility.matrix.spec.ts` | guest / registered / group × hide / show / variant-level |
| `commerce-context.matrix.spec.ts` | resolve context matrix |
| `user-groups-admin.service.spec.ts` | system guards, leaf category, visibility labels |
| `category-tree.util.spec.ts` | ancestor walk, nearest category rule |
| `group-price.util.spec.ts` | PERCENT_OFF / FIXED / rounding |

### Ключевые файлы

```
backend/src/user-groups/
  commerce-context.service.ts
  group-pricing.service.ts
  catalog-visibility.service.ts
  category-tree.util.ts
  user-groups-shared-cache.service.ts
  user-groups-admin.service.ts
  user-groups-admin.controller.ts

backend/src/catalog/catalog.public.service.ts   ← finalizeProductCards, listProducts visibility pool
backend/src/search/search.public.service.ts     ← search (пока без commerce ctx)
Admin/app/(site)/page.tsx                       ← home ISR guest
Admin/app/(site)/catalog/catalogLoad.ts         ← hydrateSearchPage (guest)
Admin/app/(site)/catalog/CatalogClient.tsx      ← skip hydrate when q
backend/src/promo/promo.public.controller.ts    ← validate + allowPromoCodes
backend/src/account/favorites.service.ts        ← commerce pipeline
backend/src/orders/orders.public.service.ts     ← pricing snapshot on create

Admin/app/(admin)/admin/settings/user-groups/
  UserGroupsAdminClient.tsx UserGroupDetailClient.tsx
  UserGroupGeneralTab.tsx UserGroupMembersTab.tsx UserGroupPricingTab.tsx
  UserGroupCategoryPricesTab.tsx UserGroupProductPricesTab.tsx UserGroupVisibilityTab.tsx
  UserGroupKindBadge.tsx UserGroupPageNav.tsx UserGroupMemberPickerModal.tsx
Admin/lib/adminUserGroupTypes.ts userGroupDetailTabs.ts userGroupPricing.ts userGroupAdminUi.ts slugify.ts
backend/src/assistant/assistant-knowledge/user-groups.ts   ← справочник для LLM-ассистента
backend/src/assistant/assistant.constants.ts               ← ASSISTANT_SYSTEM_PROMPT + knowledge
Admin/lib/buyerPublicBff.ts
Admin/app/(admin)/admin/discounts/DiscountScopePickerModal.tsx  ← shared category/product pickers
packages/admin-sections/src/index.ts            ← user-groups → users; settings excludePaths
Admin/app/(admin)/admin/adminNav.ts             ← Users group canonical; Settings exclude user-groups
Admin/lib/settingsHub.ts                        ← hub card super-admin only
```

---

## Staff / ACL (кратко)

- Роли: `ADMIN` (все секции), `MODERATOR` (список `adminSections`)  
- Создание сотрудника → welcome-письмо с временным паролем (или пароль в модалке, если SMTP упал)  
- Кэш ACL: in-memory или `REDIS_URL` (staff ACL + user-groups defaults/visibility — один `REDIS_URL`, см. `backend/.env.example`)  
- Логи: `staff_created`, `Staff admin welcome email sent to …`

---

## Команды mono

```bash
npm run build          # packages + api + admin
npm run build:api
npm run build:admin
npm run test:api
npm run test:admin
```

Front: `cd Front && npm run build` (на проде делает `deploy-front.sh`).
