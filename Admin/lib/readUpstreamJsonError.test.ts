import { describe, expect, it } from 'vitest';
import { readUpstreamJsonErrorMessage } from '@/lib/readUpstreamJsonError';

describe('readUpstreamJsonErrorMessage', () => {
  it('uses plain text when body is not JSON', async () => {
    const res = new Response('upstream down', { status: 502, statusText: 'Bad Gateway' });
    await expect(readUpstreamJsonErrorMessage(res)).resolves.toBe('upstream down');
  });

  it('reads message from JSON body', async () => {
    const res = new Response(JSON.stringify({ message: 'Нет доступа' }), {
      status: 403,
      statusText: 'Forbidden',
    });
    await expect(readUpstreamJsonErrorMessage(res)).resolves.toBe('Нет доступа');
  });
});
