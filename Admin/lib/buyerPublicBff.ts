import { cookies } from 'next/headers';
import { readBuyerTokenFromCookies } from './buyerAuth';

/** Nest catalog/orders: forward buyer JWT from httpOnly cookie (if any). */
export function buyerForwardHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  const token = readBuyerTokenFromCookies(cookies());
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}
