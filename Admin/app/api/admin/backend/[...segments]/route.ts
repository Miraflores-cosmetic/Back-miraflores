import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_ACCESS_TOKEN_COOKIE } from '@/lib/adminAuth';
import { isAllowedAdminBackendPath } from '@/lib/adminBackendAllowlist';
import { getServerApiBase } from '@/lib/serverApiBase';
import { rejectForeignOriginMutations } from '@/lib/adminMutatingOrigin';

export const runtime = 'nodejs';

/**
 * Undici при следовании 301/302 часто шлёт второй запрос GET без тела.
 * `redirect: 'manual'`, затем повтор POST/PUT/PATCH с копией тела.
 */
async function fetchUpstream(
  target: string,
  method: string,
  init: RequestInit,
  bodyBackup: ArrayBuffer | null,
): Promise<Response> {
  let res = await fetch(target, { ...init, redirect: 'manual' });

  const hasBody =
    init.body != null && (method === 'POST' || method === 'PUT' || method === 'PATCH');
  const loc = res.headers.get('location');
  const retryPost = hasBody && loc != null && [301, 302, 307, 308].includes(res.status);

  if (retryPost) {
    try {
      await res.arrayBuffer();
    } catch {
      /* ignore */
    }
    const nextUrl = new URL(loc, target).href;
    const retryBody =
      bodyBackup != null && bodyBackup.byteLength > 0 ? bodyBackup.slice(0) : init.body;
    res = await fetch(nextUrl, {
      ...init,
      body: retryBody,
      redirect: 'manual',
    });
  }

  return res;
}

async function proxy(request: NextRequest, segments: string[], method: string) {
  const originBlock = rejectForeignOriginMutations(request);
  if (originBlock) return originBlock;

  if (!isAllowedAdminBackendPath(segments)) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  const token = cookies().get(ADMIN_ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const path = segments.join('/');
  const url = new URL(request.url);
  const target = `${getServerApiBase()}/${path}${url.search}`;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers, cache: 'no-store' };

  let bodyBackup: ArrayBuffer | null = null;

  if (!['GET', 'HEAD'].includes(method)) {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      if (!request.body) {
        return NextResponse.json({ message: 'Пустое тело запроса' }, { status: 400 });
      }
      if (ct) headers['Content-Type'] = ct;
      const cl = request.headers.get('content-length');
      if (cl) headers['Content-Length'] = cl;
      init.body = request.body;
      (init as RequestInit & { duplex?: 'half' }).duplex = 'half';
      bodyBackup = null;
    } else {
      const body = await request.arrayBuffer();
      if (body.byteLength > 0) {
        if (ct) headers['Content-Type'] = ct;
        init.body = body;
        bodyBackup = body;
      }
    }
  }

  let res: Response;
  try {
    res = await fetchUpstream(target, method, init, bodyBackup);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[admin/backend proxy] upstream fetch failed', target, msg);
    return NextResponse.json(
      { message: `Не удалось связаться с API: ${msg}` },
      { status: 502 },
    );
  }
  const out = new NextResponse(res.body, { status: res.status });
  const ct = res.headers.get('content-type');
  if (ct) out.headers.set('content-type', ct);
  return out;
}

type Ctx = { params: { segments: string[] } };

export async function GET(request: NextRequest, { params }: Ctx) {
  return proxy(request, params.segments, 'GET');
}

export async function POST(request: NextRequest, { params }: Ctx) {
  return proxy(request, params.segments, 'POST');
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  return proxy(request, params.segments, 'PATCH');
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  return proxy(request, params.segments, 'PUT');
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  return proxy(request, params.segments, 'DELETE');
}
