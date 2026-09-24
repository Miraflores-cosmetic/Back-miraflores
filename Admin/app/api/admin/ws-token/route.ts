import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_ACCESS_TOKEN_COOKIE } from '@/lib/adminAuth';
import { readAdminApiError } from '@/lib/adminBackendFetch';
import { getServerApiBase } from '@/lib/serverApiBase';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** GET — короткоживущий JWT для Socket.IO order-chat (Nest `aud=order-chat-ws`). */
export async function GET() {
  const token = cookies().get(ADMIN_ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const res = await fetch(`${getServerApiBase()}/orders/admin/chat/ws-token`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const message = await readAdminApiError(res);
    return NextResponse.json({ message }, { status: res.status, headers: NO_STORE_HEADERS });
  }

  let data: { token?: string; sub?: string | null; exp?: number | null };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return NextResponse.json({ message: 'Некорректный ответ сервера' }, { status: 502, headers: NO_STORE_HEADERS });
  }

  const wsToken = data.token?.trim();
  if (!wsToken) {
    return NextResponse.json({ message: 'Нет токена для чата' }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json(
    {
      token: wsToken,
      sub: data.sub ?? null,
      exp: typeof data.exp === 'number' ? data.exp : null,
    },
    { headers: NO_STORE_HEADERS },
  );
}
