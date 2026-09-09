import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { readBuyerTokenFromCookies } from '@/lib/buyerAuth';
import { getServerApiBase } from '@/lib/serverApiBase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = readBuyerTokenFromCookies(cookies());
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  try {
    const res = await fetch(`${getServerApiBase()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ authenticated: false });
    }
    const user = (await res.json()) as {
      id: string;
      email: string;
      role: string;
      displayName: string | null;
      phone: string | null;
    };
    if (!user?.id || user.role !== 'USER') {
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        phone: user.phone ?? null,
      },
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
