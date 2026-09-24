/**
 * Origin хоста для Socket.IO (без path вида `/api/v1`).
 * По умолчанию берётся из `NEXT_PUBLIC_API_URL` (тот же host, что у BFF).
 * Если API в браузере идёт через Next (`…/api`), а Socket.IO слушает на Nest (другой upstream),
 * на nginx нужен `location` для `/socket.io/` на порт Nest (см. docs/DEPLOY.md), либо задайте
 * `NEXT_PUBLIC_SOCKET_ORIGIN` — публичный origin, с которого браузер реально достучится до engine.io.
 */
export function getWsOrigin(): string {
  const override = process.env.NEXT_PUBLIC_SOCKET_ORIGIN?.trim();
  if (override) {
    try {
      return new URL(override).origin;
    } catch {
      /* fall through */
    }
  }
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://localhost:3001';
  }
}
