# Чат заказов и поддержки (Order Chat)

Переписка покупателя с магазином: чат по заказу и общий диалог поддержки. REST для истории и отправки, Socket.IO для live-событий, отдельные короткоживущие JWT для WebSocket.

## Архитектура

| Слой | Назначение |
|------|------------|
| **Nest `backend/src/order-chat/`** | API, WS gateway, RLS, retention, signed URLs вложений, email throttle |
| **`@miraflores/order-chat-core`** | Общие константы, типы, маппер API→UI, фабрика socket-менеджера (без React) |
| **Admin** | BFF `/api/admin/backend/*`, ws-token, `ChatWindow`, заказы + support threads |
| **Front** (отдельный репозиторий) | FAB + lazy-модалка, ЛК, `file:../packages/order-chat-core` при локальной разработке рядом с монорепо |

### Транспорт

- **REST**: сообщения, read, upload, revoke черновых файлов, threads (ЛК).
- **WebSocket**: namespace `/order-chat`, события `message_created` / `message_deleted`, join комнат `orderChat:{orderId}` / `supportChat:{userId}`.
- **JWT WS**: `aud=order-chat-ws`, выдача через `GET /account/chat/ws-token` (покупатель) и Admin BFF `GET /api/admin/ws-token`.

## Монорепо

### Сборка

```bash
npm install
npm run build -w @miraflores/order-chat-core   # перед api/admin, если меняли core
npm run build:api
npm run build:admin
```

### Миграции

```bash
cd backend && npx prisma migrate deploy
```

Ключевые миграции: `20260924140000_order_chat`, `20260924160000_order_chat_author_snapshot`, `20260924180000_order_chat_hardening` (RLS, `clientMessageId`, hardening).

### Переменные окружения

См. `backend/.env.example` и `Admin/.env.example` (JWT, signing secret для chat files, origins).

### Безопасность (кратко)

- RLS на `ChatConversation`, `ChatMessage`, `ChatAttachment`, `ChatReadState`.
- Подписанные URL вложений (`/api/v1/order-chat/files/...`); nginx не отдаёт `/uploads/chat/` напрямую.
- Admin BFF: проверка `Origin` на мутирующих запросах; multipart upload **стримится** в API (без двойной буферизации).
- `@Throttle` на POST сообщений и upload; email staff→customer не чаще 10 мин / беседа, если клиент не online в WS.

### Admin

- Список заказов: иконка чата + badge unread.
- Карточка заказа: вкладка «Чат» (мобильная вёрстка ≤815px).
- `/admin/orders/chat` — support threads.
- E2E: `Admin/e2e/order-chat-orders-list.spec.ts`.

### Пакет `packages/order-chat-core`

Экспорт: `constants`, `types`, `formatOrderChatDaySeparator`, `orderChatDeletionUi`, `orderChatUploadError`, `parseJwtPayloadUnverified`, `mapOrderChatApiMessageToUi`, `createOrderChatSocketManager`.

Socket-менеджер: один сокет на `variant` (`account` | `admin`), TTL refresh JWT, **без** шторма recreate на `transport close` (R1), инжекция `loadIo` + `fetchWsToken`.

## Front (репозиторий `Front-end-site`)

Локально Front лежит в `Front/` (в `.gitignore` монорепо). Зависимость:

```json
"@miraflores/order-chat-core": "file:../packages/order-chat-core"
```

**Важно:** для CI/CD отдельного Front-репо нужно либо:

- клонировать монорепо и собирать Front из `Front/` с доступом к `packages/order-chat-core`, либо
- публиковать `@miraflores/order-chat-core` в registry / vendoring `dist`.

### Поведение витрины

- **OrderChatFab** — лёгкий бандл; модалка и `socket.io-client` — lazy.
- После входа: `postAuthOpenChat` (sessionStorage + `state.openChat`) открывает чат с нужным тредом.
- Logout: `authListenerMiddleware` → dynamic teardown WS (не тянуть socket.io в `authSlice`).
- Мобильная модалка: lock scroll, `visualViewport`, safe-area, input ≥16px.
- PhotoSwipe (lazy) для галереи вложений.

### Запуск локально

```bash
# API + Admin (из корня монорепо)
npm run dev:api
npm run dev:admin

# Front (из Front/)
npm install && npm run dev
```

Proxy Vite: `/api/v1`, `/uploads`, `/socket.io` → backend `:3001`.

## Тесты

```bash
npm run test -w @miraflores/order-chat-core
npm run test:admin
cd backend && npm test          # order-chat gateway/service specs
cd Front && npm test            # postAuthOpenChat, ws teardown, events
```

## Полезные пути

| Область | Путь |
|---------|------|
| Core | `packages/order-chat-core/src/` |
| Backend service | `backend/src/order-chat/order-chat.service.ts` |
| Admin WS wrapper | `Admin/lib/orderChat/orderChatWsShared.ts` |
| Front WS wrapper | `Front/src/lib/orderChat/orderChatWsShared.ts` |
| BFF proxy | `Admin/app/api/admin/backend/[...segments]/route.ts` |

## Операционка

- **Retention worker** (`OrderChatRetentionWorker`): purge бесед по `retentionPurgesAt`; orphan uploads на диске старше 6 ч без `ChatAttachment`.
- **Revoke upload**: `POST …/chat/upload/revoke` — удаление файла, не прикреплённого к сообщению (снятие из черновика).
