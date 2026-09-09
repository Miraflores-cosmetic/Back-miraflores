import { NextResponse } from 'next/server';
import {
  BUYER_ACCESS_TOKEN_COOKIE,
  BUYER_ACCESS_TOKEN_COOKIE_LEGACY,
  buyerCookieSecure,
} from '@/lib/buyerAuth';

function clearBuyerCookie(request: Request, response: NextResponse, name: string) {
  response.cookies.set({
    name,
    value: '',
    httpOnly: true,
    secure: buyerCookieSecure(request),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  clearBuyerCookie(request, response, BUYER_ACCESS_TOKEN_COOKIE);
  clearBuyerCookie(request, response, BUYER_ACCESS_TOKEN_COOKIE_LEGACY);
  return response;
}
