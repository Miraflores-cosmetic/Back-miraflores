# robots.txt и sitemap.xml

- **Источник:** Nest `GET /robots.txt` и `GET /sitemap.xml` (корень приложения, **не** под `/api/v1`).
- **Nginx:** `location = /robots.txt` и `location = /sitemap.xml` → `proxy_pass` на `miraflores_api` (`deploy/nginx/miraflores.conf`).
- **Базовый домен в URL:** `PUBLIC_SITE_URL` или `FRONTEND_PUBLIC_URL` (см. `backend/.env.example`). Иначе fallback `https://miraflores-shop.com`.

## sitemap

Включает:

| Тип | Условие | URL |
|-----|---------|-----|
| Главная | — | `/` |
| Категории | все категории | `/catalog/{root}` или `/catalog/{root}/{leaf}` (как на витрине) |
| Товары | `active`, не `excludeFromCatalog`, не `seoNoIndex` | `/product/{slug}` |
| Коллекции | `active` | `/catalog?collection={slug}` |
| Статьи | опубликованные, не `seoNoIndex` | `/articles/{slug}` |

После смены nginx на сервере: `nginx -t && systemctl reload nginx`.

## Prerender для Google / Yandex (и соцсетей)

Ботам с плохим/без JS отдаётся **лёгкий HTML** с `<title>`, `meta description`, `canonical`, OG/Twitter — не полный React.

- **API:** `GET /api/v1/seo/bot-html` с заголовком **`X-Bot-Request-URI: $request_uri`** (nginx передаёт полный путь + query). Ответ **200 или 404** (нет товара/статьи/неверный каталог/collection/tag — не «soft 404»).
- **Nginx:** `map $http_user_agent $seo_bot_prerender` → для **любого пути** под SPA (в т.ч. `/quiz/...`) кроме статики: `location /` + `location = /` с `if ($seo_bot_prerender) return 418` → `@seo_bot_prerender`.
- **Каталог:** `renderOpenGraphHtml` с валидацией сегментов `/catalog`, категорий, `collection`, `tag`; иначе **404** + `noindex` в теле.
- **Товары и статьи:** данные из БД + `SiteSettings` (home meta — для `/`).

Люди в браузере по-прежнему получают **тот же Vite `index.html`** и SPA — визуально ничего не меняется. Отличие только в **первом ответе** для перечисленных ботов.
