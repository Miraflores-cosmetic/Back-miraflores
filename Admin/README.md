# Miraflores Admin

Next.js: `/admin` + BFF (`/api/cdek`, yandex, yookassa).

Публичная витрина для покупателей — **Vite Front** (`Front/`, отдельный git).
`Admin/app/(site)` — внутренний/вспомогательный Next-site (превью каталога и т.п.);
рейтинг и `/reviews` живут только на Front. Не синхронизируем отзывы в Admin `(site)` PDP.

Локальный запуск и структура: [structure.md](../structure.md) · деплой: [deploy.md](../deploy.md).
