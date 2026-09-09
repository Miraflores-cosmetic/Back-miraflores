# Structure — Miraflores 3.0

Магазин косметики: витрина (Vite) + Nest API + Next Admin.  
Прод и деплой: [deploy.md](./deploy.md).

Покупательская витрина (каталог, PDP, отзывы `/reviews`) — только **Front** (Vite).
`Admin/app/(site)` не является второй публичной витриной для отзывов.

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
│   ├── src/
│   │   ├── auth/ staff/ orders/ catalog/ …
│   │   ├── mail/             ← SMTP, шаблоны писем
│   │   └── …
│   └── .env.example
├── Admin/                    ← Next admin + BFF
│   ├── app/(admin)/admin/    ← UI разделов
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
- Staff ACL, настройки, сертификаты, блог, отзывы, …  
- 1С обмен: `GET|POST /api/v1/1c/exchange` (по умолчанию только заказы site→1C; `ONEC_CATALOG_IMPORT=1` — ещё цены/остатки)  
- Uploads: `LOCAL_UPLOADS_*`  
- Почта: SMTP (заказы, staff welcome/reset)

### Next Admin (`/admin` + BFF)

- Операционка: заказы, каталог, staff, контент  
- BFF: СДЭК, Яндекс Доставка/карты, webhook ЮKassa  
- ACL: разделы из `@miraflores/admin-sections` (`orders`, `catalog`, `blog`, …); hub `/admin/settings` — только super-admin (`staff`)

### Front (Vite)

- Витрина, ЛК, checkout  
- API через `/api/v1` (прокси nginx → Nest)  
- Карты: `VITE_PUBLIC_YANDEX_MAP_API_KEY`

---

## Staff / ACL (кратко)

- Роли: `ADMIN` (все секции), `MODERATOR` (список `adminSections`)  
- Создание сотрудника → welcome-письмо с временным паролем (или пароль в модалке, если SMTP упал)  
- Кэш ACL: in-memory или `REDIS_URL`  
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
