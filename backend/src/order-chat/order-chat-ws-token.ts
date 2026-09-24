import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { resolveOrderChatWsJwtSecret } from '../auth/jwt-secret';

/** Audience для короткоживущего JWT только Socket.IO order-chat (не access token). */
export const ORDER_CHAT_WS_JWT_AUD = 'order-chat-ws';

export type OrderChatWsTokenResponse = {
  token: string;
  sub: string | null;
  exp: number | null;
};

function parseJwtPayloadUnverified(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad === 2) b64 += '==';
    else if (pad === 3) b64 += '=';
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const o = JSON.parse(json) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function orderChatWsTokenExpiresIn(config: ConfigService): string {
  const raw = config.get<string>('ORDER_CHAT_WS_JWT_EXPIRES_IN', '3m')?.trim();
  return raw && raw.length > 0 ? raw : '3m';
}

export function issueOrderChatWsToken(
  jwt: JwtService,
  config: ConfigService,
  user: JwtPayload,
): OrderChatWsTokenResponse {
  const expiresIn = orderChatWsTokenExpiresIn(config);
  const token = jwt.sign(
    {
      sub: user.sub,
      role: user.role,
      tv: user.tv,
    },
    {
      secret: resolveOrderChatWsJwtSecret(config),
      expiresIn: expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      audience: ORDER_CHAT_WS_JWT_AUD,
    },
  );
  const p = parseJwtPayloadUnverified(token);
  const sub = typeof p?.sub === 'string' ? p.sub : user.sub;
  const exp = typeof p?.exp === 'number' && Number.isFinite(p.exp) ? p.exp : null;
  return { token, sub, exp };
}
