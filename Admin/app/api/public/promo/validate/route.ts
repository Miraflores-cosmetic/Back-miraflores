import { NextRequest, NextResponse } from 'next/server';
import { buyerForwardHeaders } from '@/lib/buyerPublicBff';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const base = getServerApiBase();
  try {
    const body = await request.text();
    const res = await fetch(`${base}/promo/validate`, {
      method: 'POST',
      cache: 'no-store',
      headers: buyerForwardHeaders({
        'Content-Type': 'application/json',
      }),
      body,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    });
  } catch {
    return NextResponse.json({ message: 'Сервис недоступен' }, { status: 502 });
  }
}
