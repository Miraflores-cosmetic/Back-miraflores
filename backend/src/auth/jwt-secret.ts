import { ConfigService } from '@nestjs/config';

const WEAK = new Set(['', 'dev-secret', 'change-me', 'change-me-in-production']);

function isProdEnv(config: ConfigService): boolean {
  return (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
}

/**
 * JWT secret: в production — обязателен и не слабый.
 * В development допускается fallback `dev-secret`.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const raw = config.get<string>('JWT_SECRET')?.trim() ?? '';

  if (isProdEnv(config)) {
    if (!raw || WEAK.has(raw)) {
      throw new Error(
        'JWT_SECRET must be set to a strong non-default value when NODE_ENV=production',
      );
    }
    return raw;
  }

  if (!raw || WEAK.has(raw)) {
    return raw || 'dev-secret';
  }
  return raw;
}

/**
 * Секрет completionToken регистрации.
 * Production: обязателен, не слабый, не равен JWT_SECRET.
 * Development: REGISTRATION_TOKEN_SECRET → JWT_SECRET → `dev-secret`.
 */
export function resolveRegistrationTokenSecret(config: ConfigService): string {
  const reg = config.get<string>('REGISTRATION_TOKEN_SECRET')?.trim() ?? '';
  const jwt = config.get<string>('JWT_SECRET')?.trim() ?? '';

  if (isProdEnv(config)) {
    if (!reg || WEAK.has(reg)) {
      throw new Error(
        'REGISTRATION_TOKEN_SECRET must be set to a strong non-default value when NODE_ENV=production',
      );
    }
    if (jwt && reg === jwt) {
      throw new Error(
        'REGISTRATION_TOKEN_SECRET must differ from JWT_SECRET when NODE_ENV=production',
      );
    }
    return reg;
  }

  if (reg && !WEAK.has(reg)) return reg;
  if (jwt && !WEAK.has(jwt)) return jwt;
  return 'dev-secret';
}

/**
 * HMAC-секрет payToken заказа.
 * Production: ORDER_PAY_SECRET обязателен, не слабый, ≠ JWT_SECRET.
 * Development: ORDER_PAY_SECRET → JWT_SECRET → `dev-order-pay-secret`.
 */
/**
 * Секрет короткоживущего JWT только для Socket.IO order-chat (aud=order-chat-ws).
 * Production: ORDER_CHAT_WS_JWT_SECRET обязателен, не слабый, ≠ JWT_SECRET.
 * Development: ORDER_CHAT_WS_JWT_SECRET → JWT_SECRET → `dev-order-chat-ws-secret`.
 */
export function resolveOrderChatWsJwtSecret(config: ConfigService): string {
  const ws = config.get<string>('ORDER_CHAT_WS_JWT_SECRET')?.trim() ?? '';
  const jwt = config.get<string>('JWT_SECRET')?.trim() ?? '';

  if (isProdEnv(config)) {
    if (!ws || WEAK.has(ws) || ws === 'dev-order-chat-ws-secret') {
      throw new Error(
        'ORDER_CHAT_WS_JWT_SECRET must be set to a strong non-default value when NODE_ENV=production',
      );
    }
    if (jwt && ws === jwt) {
      throw new Error(
        'ORDER_CHAT_WS_JWT_SECRET must differ from JWT_SECRET when NODE_ENV=production',
      );
    }
    return ws;
  }

  if (ws && !WEAK.has(ws) && ws !== 'dev-order-chat-ws-secret') return ws;
  if (jwt && !WEAK.has(jwt)) return jwt;
  return 'dev-order-chat-ws-secret';
}

export function resolveOrderPaySecret(config: ConfigService): string {
  const pay = config.get<string>('ORDER_PAY_SECRET')?.trim() ?? '';
  const jwt = config.get<string>('JWT_SECRET')?.trim() ?? '';

  if (isProdEnv(config)) {
    if (!pay || WEAK.has(pay) || pay === 'dev-order-pay-secret') {
      throw new Error(
        'ORDER_PAY_SECRET must be set to a strong non-default value when NODE_ENV=production',
      );
    }
    if (jwt && pay === jwt) {
      throw new Error(
        'ORDER_PAY_SECRET must differ from JWT_SECRET when NODE_ENV=production',
      );
    }
    return pay;
  }

  if (pay && !WEAK.has(pay) && pay !== 'dev-order-pay-secret') return pay;
  if (jwt && !WEAK.has(jwt)) return jwt;
  return 'dev-order-pay-secret';
}
