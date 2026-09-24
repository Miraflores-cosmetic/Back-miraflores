import { describe, expect, it, vi } from 'vitest';
import { issueOrderChatWsToken, ORDER_CHAT_WS_JWT_AUD } from './order-chat-ws-token';

describe('issueOrderChatWsToken', () => {
  it('signs short-lived token with order-chat audience', () => {
    const jwt = {
      sign: vi.fn().mockReturnValue('signed.ws.token'),
    };
    const config = { get: vi.fn().mockReturnValue('3m') };

    const out = issueOrderChatWsToken(jwt as never, config as never, {
      sub: 'u1',
      role: 'CUSTOMER',
      tv: 2,
    });

    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 'u1', role: 'CUSTOMER', tv: 2 },
      { expiresIn: '3m', audience: ORDER_CHAT_WS_JWT_AUD },
    );
    expect(out.token).toBe('signed.ws.token');
    expect(out.sub).toBe('u1');
  });
});
