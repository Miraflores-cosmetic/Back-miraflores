import { NextRequest, NextResponse } from 'next/server';
import { buyerForwardHeaders } from '@/lib/buyerPublicBff';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const base = getServerApiBase();
  const payToken = request.nextUrl.searchParams.get('payToken')?.trim() || '';
  const qs = payToken ? `?payToken=${encodeURIComponent(payToken)}` : '';

  try {
    const res = await fetch(
      `${base}/orders/${encodeURIComponent(params.orderId)}/checkout-status${qs}`,
      { cache: 'no-store', headers: buyerForwardHeaders() },
    );
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
