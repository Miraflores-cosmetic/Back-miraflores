import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { rejectForeignOriginMutations } from '@/lib/adminMutatingOrigin';

describe('rejectForeignOriginMutations', () => {
  it('allows same-origin POST', () => {
    const req = new NextRequest('http://localhost:3010/api/admin/backend/x', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3010',
        host: 'localhost:3010',
      },
    });
    expect(rejectForeignOriginMutations(req)).toBeNull();
  });

  it('blocks foreign origin POST', () => {
    const req = new NextRequest('http://localhost:3010/api/admin/backend/x', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        host: 'localhost:3010',
      },
    });
    expect(rejectForeignOriginMutations(req)?.status).toBe(403);
  });
});
