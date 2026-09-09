import { NextResponse } from 'next/server';
import { getServerApiBase } from '@/lib/serverApiBase';
import {
  BUYER_ACCESS_TOKEN_COOKIE,
  BUYER_ACCESS_TOKEN_COOKIE_LEGACY,
  BUYER_TOKEN_MAX_AGE_SEC,
  buyerCookieSecure,
} from './buyerAuth';

export function setBuyerCookie(
  request: Request,
  response: NextResponse,
  token: string,
): void {
  const secure = buyerCookieSecure(request);
  const base = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
  };
  response.cookies.set({
    ...base,
    name: BUYER_ACCESS_TOKEN_COOKIE,
    value: token,
    maxAge: BUYER_TOKEN_MAX_AGE_SEC,
  });
  response.cookies.set({
    ...base,
    name: BUYER_ACCESS_TOKEN_COOKIE_LEGACY,
    value: '',
    maxAge: 0,
  });
}

/**
 * Ставит buyer cookie только если JWT принадлежит role=USER.
 * Admin token (тот же JWT secret) в buyer cookie не попадёт.
 */
export async function setBuyerCookieIfUser(
  request: Request,
  response: NextResponse,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${getServerApiBase()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const user = (await res.json()) as { id?: string; role?: string };
    if (!user?.id || user.role !== 'USER') return false;
    setBuyerCookie(request, response, token);
    return true;
  } catch {
    return false;
  }
}
