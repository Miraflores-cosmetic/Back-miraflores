import { NextRequest, NextResponse } from 'next/server';
import { buyerForwardHeaders } from '@/lib/buyerPublicBff';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const base = getServerApiBase();
  const qs = request.nextUrl.searchParams.toString();
  try {
    const res = await fetch(`${base}/catalog/products${qs ? `?${qs}` : ''}`, {
      cache: 'no-store',
      headers: buyerForwardHeaders(),
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
    return NextResponse.json({ items: [], total: 0, page: 1, limit: 48 }, { status: 502 });
  }
}
