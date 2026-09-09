import { NextRequest, NextResponse } from 'next/server';
import { buyerForwardHeaders } from '@/lib/buyerPublicBff';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const base = getServerApiBase();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ items: [], removedKeys: [] }, { status: 400 });
  }
  try {
    const headers = buyerForwardHeaders({ 'Content-Type': 'application/json' });
    const res = await fetch(`${base}/catalog/cart/sync`, {
      method: 'POST',
      cache: 'no-store',
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    });
  } catch {
    return NextResponse.json({ items: [], removedKeys: [] }, { status: 502 });
  }
}
