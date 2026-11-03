# Публичный поиск

Контракт для `GET /api/v1/search?q=` и витрины (header drawer + PLP `/catalog?q=`).

## API

| | |
|--|--|
| Endpoint | `GET /search?q=` (throttle 40/мин) |
| Auth | `@Public()` + **optional** buyer JWT (`role=USER`) |
| Service | `SearchPublicService` |
| BFF (Admin Next) | `GET /api/public/search` → `buyerForwardHeaders()` |

Ответ: `{ q, groups: [{ key, label, items }] }`.

| `key` | Label | Смысл |
|-------|-------|--------|
| `category` | Каталог | категории |
| `product` | Товар | **именно `product`** (не `products`) |
| `tag` | Зона | теги |
| `collection` | Коллекция | коллекции |
| `blog` | Блог | опубликованные статьи → `/articles/:slug` |

PLP hydrate (`catalogLoad`) ищет `g.key === 'product'`. Неверный ключ → пустой `/catalog?q=`.

## Что индексируется

### Товары (two-phase)

1. **Primary:** `name`, `slug`, `shortDescription`, варианты (`sku`, `nationalCatalogName`, `name`, оттенки).
2. **Content fillers:** plain-колонка `Product.compositionSearchText` (GIN `pg_trgm`).

`compositionSearchText` при записи товара = strip HTML от:

- `compositionHtml` (INCI / состав)
- `descriptionHtml`
- `actionEffectHtml`

Миграция: `20261102120000_search_plain_trgm`. Утилита: `htmlToSearchText` / `buildProductContentSearchText`.

### Статьи

1. **Primary:** `title`, `excerpt`
2. **Body fillers:** `BlogPost.bodySearchText` (strip HTML при create/update поста)

`hit.subtitle` для блога: `category.name` или **stripped** excerpt (без сырого HTML).

## Ранжирование

- Окно primary / content раздельно → merge → `scoreTitleMatch` (exact > prefix > tokens > contains).
- Composition-only / body-only получают низкий score (10) и **не вытесняют** title-хиты из окна.
- Лимит товаров в ответе: до 48.

## HTML-noise

Короткие q вроде `div`, `href`, `span` (`isHtmlNoiseQuery`) **не** ищут composition/body — только primary поля. Иначе били бы теги/атрибуты.

## Buyer context (S1 — закрыт)

При JWT покупателя:

1. `CatalogVisibilityService` — скрытые варианты/товары убираются из hits.
2. `GroupPricingService` — subtitle цены = group price.

PLP `/catalog?q=`:

- SSR: guest search + guest cards by slug.
- Client (залогинен): `CatalogClient` → `fetchPublicProductsPageClient({ slugs })` с BFF JWT (не skip при `q`).

Front Vite: `fetchProductList` / `searchCatalog` уже шлют Bearer из `localStorage`.

## UX

Placeholder поиска (Front + Admin header): **«Товар, состав, статья или категория»**.

Hero CTA «Программа благодарности» (Front `HomeHero`): `SITE_GRATITUDE_HREF` = `/articles/programma-blagodarnosti-2` (не `#gratitude-program`).

## Файлы

| Файл | Роль |
|------|------|
| `backend/src/search/search.public.service.ts` | поиск |
| `backend/src/common/html-to-search-text.util.ts` | strip / noise / content blob |
| `backend/prisma/migrations/20261102120000_search_plain_trgm/` | cols + GIN |
| `Admin/app/(site)/catalog/catalogLoad.ts` | PLP hydrate, key=`product` |
| `Front/src/pages/Catalog/catalogLoad.ts` | то же для Vite-витрины |
| `Admin/app/(site)/catalog/CatalogClient.tsx` | buyer slug hydrate при `q` |
| `Admin/app/api/public/search/route.ts` | BFF + JWT |
| `Front/src/components/home-hero/HomeHero.tsx` | gratitude CTA |
| `Front/src/config/siteNavLinks.ts` | `SITE_GRATITUDE_HREF` |
