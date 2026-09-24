import { createHmac, timingSafeEqual } from 'crypto';
import { normalizeChatStorageKey } from '../storage/chat-upload-meta';

export const ORDER_CHAT_FILE_URL_TTL_SECONDS = 7 * 24 * 3600;
export const ORDER_CHAT_FILE_ROUTE = '/api/v1/order-chat/files';

export function resolveChatFileSigningSecret(config: {
  get: (key: string) => string | undefined;
}): string {
  const dedicated = config.get('ORDER_CHAT_FILE_SIGN_SECRET')?.trim();
  if (dedicated) return dedicated;
  const jwt = config.get('JWT_SECRET')?.trim();
  if (jwt) return jwt;
  return 'dev-chat-file-signing-change-me';
}

function signPayload(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}\n${exp}`).digest('base64url');
}

export function signChatStorageKey(
  secret: string,
  publicBase: string,
  storageKey: string,
  expUnix?: number,
): string {
  const key = storageKey.replace(/^\/+/, '');
  const exp = expUnix ?? Math.floor(Date.now() / 1000) + ORDER_CHAT_FILE_URL_TTL_SECONDS;
  const sig = signPayload(secret, key, exp);
  const base = publicBase.replace(/\/+$/, '');
  const q = new URLSearchParams({
    key,
    exp: String(exp),
    sig,
  });
  return `${base}${ORDER_CHAT_FILE_ROUTE}?${q.toString()}`;
}

export function verifyChatFileSignature(
  secret: string,
  key: string,
  exp: number,
  sig: string,
): boolean {
  if (!key.startsWith('chat/')) return false;
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = signPayload(secret, key, exp);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Из signed URL, legacy /uploads/… или сырого storage key. */
export function extractChatStorageKeyFromRef(
  ref: string,
  publicBase: string,
): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('chat/')) {
    try {
      return normalizeChatStorageKey(trimmed, 'chat');
    } catch {
      return null;
    }
  }

  const base = publicBase.replace(/\/+$/, '');
  const signedPrefix = `${base}${ORDER_CHAT_FILE_ROUTE}`;
  if (trimmed.startsWith(signedPrefix)) {
    try {
      const u = new URL(trimmed);
      const key = u.searchParams.get('key')?.trim();
      if (!key) return null;
      return normalizeChatStorageKey(key, 'chat');
    } catch {
      return null;
    }
  }

  const uploadsPrefix = `${base}/uploads/`;
  if (trimmed.startsWith(uploadsPrefix)) {
    try {
      const raw = decodeURIComponent(trimmed.slice(uploadsPrefix.length));
      return normalizeChatStorageKey(raw, 'chat');
    } catch {
      return null;
    }
  }

  return null;
}

export function isChatStorageKey(key: string): boolean {
  return key.replace(/^\/+/, '').startsWith('chat/');
}
