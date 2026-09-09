import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_ACCESS_TOKEN_COOKIE } from '@/lib/adminAuth';
import { isAdminStaffRole } from '@/lib/adminStaffRole';
import { readBuyerTokenFromRequest } from '@/lib/buyerAuth';
import { peekJwtPayload } from '@/lib/peekJwtPayload';

/**
 * Next behind nginx (-H 127.0.0.1) often builds nextUrl as http://localhost:3000.
 * Rebuild absolute redirect from public Host / X-Forwarded-*.
 */
function redirectPublic(
  request: NextRequest,
  pathname: string,
  opts?: { status?: number; setFrom?: string; clearParams?: string[] },
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;

  if (opts?.clearParams) {
    for (const key of opts.clearParams) url.searchParams.delete(key);
  }
  if (opts?.setFrom) {
    url.searchParams.set('from', opts.setFrom);
  }

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = request.headers.get('host')?.trim();
  const publicHost = forwardedHost || hostHeader;
  if (publicHost) {
    const [hostname, port] = publicHost.split(':');
    if (hostname) {
      url.hostname = hostname;
      url.port = port ?? '';
    }
  }

  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (proto === 'http' || proto === 'https') {
    url.protocol = `${proto}:`;
  }

  return NextResponse.redirect(url, opts?.status ?? 307);
}

/** Cookie есть, но роль не buyer / JWT битый / истёк — на login. */
function buyerTokenLooksValid(token: string): boolean {
  const payload = peekJwtPayload(token);
  if (!payload) return false;
  if (payload.role !== 'USER') return false;
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return false;
  }
  return true;
}

/** Cookie есть, но роль не staff / JWT битый / истёк — на login. */
function adminTokenLooksValid(token: string): boolean {
  const payload = peekJwtPayload(token);
  if (!payload) return false;
  if (!isAdminStaffRole(payload.role)) return false;
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return false;
  }
  return true;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy /catalog?cat=&sub= → /catalog/[cat]/[sub]
  if (pathname === '/catalog') {
    const cat = request.nextUrl.searchParams.get('cat')?.trim();
    const sub = request.nextUrl.searchParams.get('sub')?.trim();
    if (cat) {
      const nextPath = sub
        ? `/catalog/${encodeURIComponent(cat)}/${encodeURIComponent(sub)}`
        : `/catalog/${encodeURIComponent(cat)}`;
      return redirectPublic(request, nextPath, {
        status: 308,
        clearParams: ['cat', 'sub'],
      });
    }
  }

  if (pathname === '/account' || pathname.startsWith('/account/')) {
    const token = readBuyerTokenFromRequest(request);
    if (!token || !buyerTokenLooksValid(token)) {
      return redirectPublic(request, '/login', { setFrom: pathname });
    }
    return NextResponse.next();
  }

  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  if (pathname === '/admin/login') {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const token = request.cookies.get(ADMIN_ACCESS_TOKEN_COOKIE)?.value?.trim();
  if (!token || !adminTokenLooksValid(token)) {
    return redirectPublic(request, '/admin/login', { setFrom: pathname });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/admin/:path*', '/catalog', '/account', '/account/:path*'],
};
