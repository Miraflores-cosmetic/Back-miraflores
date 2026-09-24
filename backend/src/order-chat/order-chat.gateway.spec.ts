import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { OrderChatGateway } from './order-chat.gateway';
import { ORDER_CHAT_WS_JWT_AUD } from './order-chat-ws-token';

describe('OrderChatGateway', () => {
  const jwt = { verify: vi.fn() };
  const chat = {
    registerGateway: vi.fn(),
    verifyJoinRoom: vi.fn(),
    verifyJoinSupportRoom: vi.fn(),
    assertWsConnectionAllowed: vi.fn(),
  };

  let gateway: OrderChatGateway;
  let join: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new OrderChatGateway(jwt as never, chat as never);
    join = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();
  });

  function client(authToken?: string) {
    return {
      handshake: {
        auth: authToken ? { token: authToken } : {},
        headers: {},
      },
      data: {} as Record<string, unknown>,
      join,
      disconnect,
    };
  }

  it('joins staff room when moderator has orders section', async () => {
    jwt.verify.mockReturnValue({ sub: 'm1', role: UserRole.MODERATOR, tv: 1 });
    chat.assertWsConnectionAllowed.mockResolvedValue({ staffInbox: true });

    await gateway.handleConnection(client('tok') as never);

    expect(jwt.verify).toHaveBeenCalledWith('tok', { audience: ORDER_CHAT_WS_JWT_AUD });
    expect(chat.assertWsConnectionAllowed).toHaveBeenCalled();
    expect(join).toHaveBeenCalledWith('staffOrderChat');
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('allows buyer without staff room', async () => {
    jwt.verify.mockReturnValue({ sub: 'u1', role: UserRole.USER, tv: 2 });
    chat.assertWsConnectionAllowed.mockResolvedValue({ staffInbox: false });

    await gateway.handleConnection(client('tok') as never);

    expect(join).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('disconnects when assertWsConnectionAllowed fails', async () => {
    jwt.verify.mockReturnValue({ sub: 'u1', role: UserRole.USER, tv: 0 });
    chat.assertWsConnectionAllowed.mockRejectedValue(new Error('token revoked'));

    await gateway.handleConnection(client('tok') as never);

    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects on invalid token', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('bad token');
    });

    await gateway.handleConnection(client('bad') as never);

    expect(disconnect).toHaveBeenCalledWith(true);
  });
});
