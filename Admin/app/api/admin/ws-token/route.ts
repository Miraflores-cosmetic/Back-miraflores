import { NextResponse } from 'next/server';
import { adminBackendJson } from '@/lib/adminBackendFetch';

/** GET — короткоживущий JWT для Socket.IO order-chat (Nest `aud=order-chat-ws`). */
export async function GET() {
  try {
    const data = await adminBackendJson<{ token?: string; sub?: string | null; exp?: number | null }>(
      'orders/admin/chat/ws-token',
    );
    const token = data.token?.trim();
    if (!token) {
      return NextResponse.json({ message: 'Нет токена для чата' }, { status: 502 });
    }
    return NextResponse.json(
      {
        token,
        sub: data.sub ?? null,
        exp: typeof data.exp === 'number' ? data.exp : null,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
}
