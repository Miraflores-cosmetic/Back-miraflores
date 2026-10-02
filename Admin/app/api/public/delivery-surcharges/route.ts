import { NextResponse } from 'next/server';
import { DELIVERY_SURCHARGE_DEFAULTS } from '@/lib/deliverySurcharge';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = `${getServerApiBase()}/settings/delivery-surcharges`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    });
  } catch {
    return NextResponse.json(DELIVERY_SURCHARGE_DEFAULTS, { status: 200 });
  }
}
