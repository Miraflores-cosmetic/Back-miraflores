# Miraflores Admin

Next.js: `/admin` + BFF (`/api/cdek`, yandex, yookassa).

Публичная витрина для покупателей — **Vite Front** (`Front/`, отдельный git).
`Admin/app/(site)` — внутренний/вспомогательный Next-site (превью каталога и т.п.);
рейтинг и `/reviews` живут только на Front. Не синхронизируем отзывы в Admin `(site)` PDP.

**Checkout parity:** `Admin/app/(site)/checkout` — вспомогательный; flow «не удалось найти адрес» / `needsAddressClarification` — **только Front `/order`**. В Admin правьте адрес в карточке заказа и выставляйте ссылку на оплату.

Локальный запуск и структура: [structure.md](../structure.md) · деплой: [deploy.md](../deploy.md).
