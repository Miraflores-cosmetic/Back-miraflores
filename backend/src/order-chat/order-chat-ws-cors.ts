/**
 * CORS для Socket.IO namespace order-chat.
 * - development: origin: true (отражение Origin клиента).
 * - production: whitelist ORDER_CHAT_SOCKET_CORS_ORIGINS; иначе падение при старте.
 *   Аварийно: ORDER_CHAT_SOCKET_CORS_RELAXED=1 → permissive + предупреждение.
 */

function parseCommaSeparatedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    try {
      out.push(new URL(s).origin);
    } catch {
      /* skip invalid */
    }
  }
  return [...new Set(out)];
}

function envFlagTrue(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function getOrderChatWebSocketCorsOptions(): { origin: boolean | string[]; credentials: true } {
  const credentials = true as const;
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';

  const explicit = parseCommaSeparatedOrigins(process.env.ORDER_CHAT_SOCKET_CORS_ORIGINS);
  if (explicit.length > 0) {
    if (isProd) {
      for (const o of explicit) {
        if (o.startsWith('http://')) {
          // eslint-disable-next-line no-console
          console.warn(
            `[Miraflores][order-chat WS] NODE_ENV=production: whitelist contains HTTP (${o}); prefer HTTPS for public site.`,
          );
        }
      }
    }
    return { origin: explicit, credentials };
  }

  if (!isProd) {
    return { origin: true, credentials };
  }

  if (envFlagTrue('ORDER_CHAT_SOCKET_CORS_RELAXED')) {
    // eslint-disable-next-line no-console
    console.warn(
      '[Miraflores][order-chat WS] ORDER_CHAT_SOCKET_CORS_RELAXED: permissive CORS (origin: true). ' +
        'Set ORDER_CHAT_SOCKET_CORS_ORIGINS and remove the flag when possible.',
    );
    return { origin: true, credentials };
  }

  throw new Error(
    '[Miraflores][order-chat WS] NODE_ENV=production and empty ORDER_CHAT_SOCKET_CORS_ORIGINS: set whitelist ' +
      '(comma-separated full URLs, e.g. https://miraflores-shop.com). ' +
      'Emergency: ORDER_CHAT_SOCKET_CORS_RELAXED=1.',
  );
}
