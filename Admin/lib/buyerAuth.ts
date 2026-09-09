/** httpOnly cookie с JWT покупателя (Miraflores). */
export const BUYER_ACCESS_TOKEN_COOKIE = 'miraflores_buyer_token';

/** Legacy Win-Win / Jcos — читаем при миграции, новые сессии пишем только в BUYER_ACCESS_TOKEN_COOKIE. */
export const BUYER_ACCESS_TOKEN_COOKIE_LEGACY = 'jcos_buyer_token';

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

export function readBuyerTokenFromCookies(store: CookieReader): string | undefined {
  const primary = store.get(BUYER_ACCESS_TOKEN_COOKIE)?.value?.trim();
  if (primary) return primary;
  return store.get(BUYER_ACCESS_TOKEN_COOKIE_LEGACY)?.value?.trim() || undefined;
}

/** Edge middleware (NextRequest.cookies). */
export function readBuyerTokenFromRequest(request: {
  cookies: CookieReader;
}): string | undefined {
  return readBuyerTokenFromCookies(request.cookies);
}

export const BUYER_TOKEN_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export function buyerCookieSecure(request: Request): boolean {
  const v = process.env.BUYER_COOKIE_SECURE?.toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'on') return true;
  const fwd = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (fwd === 'https') return true;
  if (fwd === 'http') return false;
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}
