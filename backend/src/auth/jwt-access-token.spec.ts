import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { assertStandardAccessJwtPayload } from './jwt-access-token';

describe('assertStandardAccessJwtPayload', () => {
  it('allows standard access payload', () => {
    expect(() =>
      assertStandardAccessJwtPayload({
        sub: 'u1',
        role: 'USER',
        tv: 1,
      }),
    ).not.toThrow();
  });

  it('rejects aud (chat WS token)', () => {
    expect(() =>
      assertStandardAccessJwtPayload({
        sub: 'u1',
        role: 'USER',
        aud: 'order-chat-ws',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects typ (password reset token)', () => {
    expect(() =>
      assertStandardAccessJwtPayload({
        sub: 'u1',
        typ: 'pwreset',
        purpose: 'password_reset',
      }),
    ).toThrow(UnauthorizedException);
  });
});
