import { NextRequest, NextResponse } from 'next/server';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

/**
 * Callback URL в ЛК Яндекс Пэй: https://miraflores-shop.com/api/yandexpay
 * (Яндекс добавляет /v1/webhook → этот route).
 *
 * Тело: JWT (Content-Type: application/octet-stream). Проксируем на Nest;
 * подпись ES256 проверяет Nest по JWKS.
 * Ответ по схеме Merchant API: 200 `{status:"success"}` или 400 `{status:"fail", reasonCode}`.
 */
export async function POST(request: NextRequest) {
  const base = getServerApiBase();
  try {
    const buf = Buffer.from(await request.arrayBuffer());
    const res = await fetch(`${base}/orders/yandexpay/webhook`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type':
          request.headers.get('content-type') || 'application/octet-stream',
        ...(request.headers.get('x-request-id')
          ? { 'X-Request-Id': request.headers.get('x-request-id')! }
          : {}),
      },
      body: buf,
    });
    const text = await res.text();
    // Прозрачный прокси тела Nest (уже Yandex schema). Fallback только при пустом ответе.
    const fallback =
      res.status >= 200 && res.status < 300
        ? '{"status":"success"}'
        : '{"status":"fail","reasonCode":"OTHER"}';
    return new NextResponse(text || fallback, {
      status: res.status,
      headers: {
        'content-type':
          res.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    });
  } catch {
    return NextResponse.json(
      { status: 'fail', reasonCode: 'OTHER', reason: 'upstream unavailable' },
      { status: 400 },
    );
  }
}
