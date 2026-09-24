import { describe, expect, it, vi } from 'vitest';
import { issueOrderChatWsToken, ORDER_CHAT_WS_JWT_AUD } from './order-chat-ws-token';

describe('issueOrderChatWsToken', () => {
  it('signs short-lived token with order-chat audience', () => {
    const jwt = {
      sign: vi.fn().mockReturnValue('signed.ws.token'),
    };
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'ORDER_CHAT_WS_JWT_EXPIRES_IN') return '3m';
        if (key === 'JWT_SECRET') return 'ws-test-jwt-secret';
        return undefined;
      }),
    };

    const out = issueOrderChatWsToken(jwt as never, config as never, {
      sub: 'u1',
      role: 'CUSTOMER',
      tv: 2,
    });

    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 'u1', role: 'CUSTOMER', tv: 2 },
      expect.objectContaining({
        expiresIn: '3m',
        audience: ORDER_CHAT_WS_JWT_AUD,
        secret: 'ws-test-jwt-secret',
      }),
    );
    expect(out.token).toBe('signed.ws.token');
    expect(out.sub).toBe('u1');
  });
});
