import { NextRequest, NextResponse } from 'next/server';
import { buyerForwardHeaders } from '@/lib/buyerPublicBff';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const base = getServerApiBase();
  const slug = params.slug?.trim();
  if (!slug) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  try {
    const res = await fetch(`${base}/catalog/products/${encodeURIComponent(slug)}`, {
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
    return NextResponse.json({ message: 'Сервис недоступен' }, { status: 502 });
  }
}
