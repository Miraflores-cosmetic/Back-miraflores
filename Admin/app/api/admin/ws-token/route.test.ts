import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ACCESS_TOKEN_COOKIE } from '@/lib/adminAuth';

const cookiesGet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: cookiesGet,
  }),
}));

vi.mock('@/lib/serverApiBase', () => ({
  getServerApiBase: () => 'http://api.test/api/v1',
}));

describe('GET /api/admin/ws-token', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    cookiesGet.mockReset();
  });

  it('401 без admin cookie', async () => {
    cookiesGet.mockReturnValue(undefined);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('проксирует Nest с Bearer и no-store', async () => {
    cookiesGet.mockImplementation((name: string) =>
      name === ADMIN_ACCESS_TOKEN_COOKIE ? { value: 'staff-jwt' } : undefined,
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'ws-jwt', sub: 'staff-1', exp: 1_700_000_000 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { token?: string; sub?: string | null; exp?: number | null };
    expect(body.token).toBe('ws-jwt');
    expect(body.sub).toBe('staff-1');
    expect(body.exp).toBe(1_700_000_000);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/orders/admin/chat/ws-token',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Authorization: 'Bearer staff-jwt' },
      }),
    );
  });

  it('пробрасывает статус Nest при ошибке', async () => {
    cookiesGet.mockImplementation((name: string) =>
      name === ADMIN_ACCESS_TOKEN_COOKIE ? { value: 'staff-jwt' } : undefined,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })),
    );

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe('Forbidden');
  });

  it('502 если Nest вернул пустой token', async () => {
    cookiesGet.mockImplementation((name: string) =>
      name === ADMIN_ACCESS_TOKEN_COOKIE ? { value: 'staff-jwt' } : undefined,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: '  ' }), { status: 200 })),
    );

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
