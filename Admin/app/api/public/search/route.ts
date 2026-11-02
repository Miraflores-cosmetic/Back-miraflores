import { NextRequest, NextResponse } from 'next/server';
import { buyerForwardHeaders } from '@/lib/buyerPublicBff';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  const base = getServerApiBase();
  try {
    const res = await fetch(
      `${base}/search?q=${encodeURIComponent(q)}`,
      {
        cache: 'no-store',
        headers: buyerForwardHeaders(),
        signal: request.signal,
      },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type':
          res.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return new NextResponse(null, { status: 499 });
    }
    return NextResponse.json({ message: 'Сервис недоступен' }, { status: 502 });
  }
}
