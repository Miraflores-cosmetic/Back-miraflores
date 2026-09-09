import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { readBuyerTokenFromCookies } from '@/lib/buyerAuth';
import { readNestError } from '@/lib/nestBff';
import { getServerApiBase } from '@/lib/serverApiBase';

export async function buyerNestFetch(
  path: string,
  init?: RequestInit,
): Promise<Response | NextResponse> {
  const token = readBuyerTokenFromCookies(cookies());
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    return await fetch(`${getServerApiBase()}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Нет связи с API' }, { status: 502 });
  }
}

export async function nestJsonResponse(res: Response | NextResponse) {
  if (res instanceof NextResponse) return res;
  if (!res.ok) {
    const msg = await readNestError(res);
    return NextResponse.json(
      { error: msg ?? 'Ошибка запроса' },
      { status: res.status },
    );
  }
  if (res.status === 204) {
    return NextResponse.json({ ok: true });
  }
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data);
}
