import { NextRequest, NextResponse } from 'next/server';

/** CSRF: мутирующие запросы к BFF только с нашего Origin (cookie + SameSite=Lax недостаточно). */
export function rejectForeignOriginMutations(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;

  const origin = request.headers.get('origin')?.trim();
  if (!origin) {
    const site = request.headers.get('sec-fetch-site');
    if (site === 'same-origin' || site === 'none') return null;
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '')
    .split(',')[0]
    ?.trim();
  if (!host) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const allowed = new Set([`https://${host}`, `http://${host}`]);
  const extra = process.env.ADMIN_APP_ORIGIN?.trim();
  if (extra) allowed.add(extra.replace(/\/$/, ''));

  if (!allowed.has(origin)) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  return null;
}
