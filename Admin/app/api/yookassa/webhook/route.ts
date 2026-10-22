import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

/** Официальные диапазоны ЮKassa: https://yookassa.ru/developers/using-api/webhooks */
const CIDRS = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.154.128/25',
] as const;
const EXACT = new Set(['77.75.156.11', '77.75.156.35']);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const octet = Number(p);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8) + octet;
  }
  return n >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipN = ipv4ToInt(ip);
  const baseN = ipv4ToInt(base);
  if (ipN == null || baseN == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

function isYooKassaIp(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, '');
  if (!ip) return false;
  if (EXACT.has(ip)) return true;
  if (ip.toLowerCase().startsWith('2a02:5180:')) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip.includes('.') ? ip : null;
  if (!v4) return false;
  return CIDRS.some((c) => inCidr(v4, c));
}

function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip')?.trim() || null;
}

function secretsEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Прокси вебхука ЮKassa → Nest.
 * Auth: секрет в URL (?secret=) или заголовке + IP allowlist (prod).
 */
export async function POST(request: NextRequest) {
  const expected = process.env.YOOKASSA_WEBHOOK_SECRET?.trim();
  const provided =
    request.nextUrl.searchParams.get('secret')?.trim() ||
    request.headers.get('x-yookassa-webhook-secret')?.trim() ||
    '';

  if (expected) {
    if (!provided || !secretsEqual(expected, provided)) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
  }

  const checkIpEnv = process.env.YOOKASSA_WEBHOOK_CHECK_IP;
  const checkIp =
    checkIpEnv === '1' ||
    checkIpEnv === 'true' ||
    (process.env.NODE_ENV === 'production' &&
      checkIpEnv !== '0' &&
      checkIpEnv !== 'false' &&
      !expected);

  if (checkIp) {
    const ip = clientIp(request);
    if (!ip || !isYooKassaIp(ip)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
  }

  const base = getServerApiBase();
  try {
    const body = await request.text();
    const nestUrl = new URL(`${base}/orders/yookassa/webhook`);
    if (expected) nestUrl.searchParams.set('secret', expected);

    const res = await fetch(nestUrl.toString(), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(expected
          ? { 'x-yookassa-webhook-secret': expected }
          : {}),
        ...(clientIp(request)
          ? { 'x-forwarded-for': clientIp(request)! }
          : {}),
      },
      body,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type':
          res.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    });
  } catch {
    return NextResponse.json({ message: 'Сервис недоступен' }, { status: 502 });
  }
}
