import { describe, expect, it } from 'vitest';
import {
  resolveJwtSecret,
  resolveRegistrationTokenSecret,
  resolveOrderPaySecret,
  resolveOrderChatWsJwtSecret,
} from './jwt-secret';

function cfg(map: Record<string, string | undefined>) {
  return {
    get: (key: string) => map[key],
  } as never;
}

describe('resolveJwtSecret', () => {
  it('prod без секрета — throw', () => {
    expect(() => resolveJwtSecret(cfg({ NODE_ENV: 'production' }))).toThrow(/JWT_SECRET/);
  });

  it('prod со слабым секретом — throw', () => {
    expect(() =>
      resolveJwtSecret(cfg({ NODE_ENV: 'production', JWT_SECRET: 'dev-secret' })),
    ).toThrow(/JWT_SECRET/);
  });

  it('prod с нормальным секретом — ok', () => {
    expect(
      resolveJwtSecret(cfg({ NODE_ENV: 'production', JWT_SECRET: 'a-strong-secret-value' })),
    ).toBe('a-strong-secret-value');
  });

  it('dev без секрета — fallback', () => {
    expect(resolveJwtSecret(cfg({ NODE_ENV: 'development' }))).toBe('dev-secret');
  });
});

describe('resolveRegistrationTokenSecret', () => {
  it('prod без секрета — throw', () => {
    expect(() =>
      resolveRegistrationTokenSecret(
        cfg({ NODE_ENV: 'production', JWT_SECRET: 'a-strong-secret-value' }),
      ),
    ).toThrow(/REGISTRATION_TOKEN_SECRET/);
  });

  it('prod со слабым секретом — throw', () => {
    expect(() =>
      resolveRegistrationTokenSecret(
        cfg({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-strong-secret-value',
          REGISTRATION_TOKEN_SECRET: 'change-me-in-production',
        }),
      ),
    ).toThrow(/REGISTRATION_TOKEN_SECRET/);
  });

  it('prod равный JWT_SECRET — throw', () => {
    expect(() =>
      resolveRegistrationTokenSecret(
        cfg({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-strong-secret-value',
          REGISTRATION_TOKEN_SECRET: 'a-strong-secret-value',
        }),
      ),
    ).toThrow(/differ from JWT_SECRET/);
  });

  it('prod с отдельным секретом — ok', () => {
    expect(
      resolveRegistrationTokenSecret(
        cfg({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-strong-secret-value',
          REGISTRATION_TOKEN_SECRET: 'another-strong-registration-secret',
        }),
      ),
    ).toBe('another-strong-registration-secret');
  });

  it('dev без reg — fallback на JWT', () => {
    expect(
      resolveRegistrationTokenSecret(
        cfg({ NODE_ENV: 'development', JWT_SECRET: 'local-jwt-secret' }),
      ),
    ).toBe('local-jwt-secret');
  });

  it('dev с reg — берёт reg', () => {
    expect(
      resolveRegistrationTokenSecret(
        cfg({
          NODE_ENV: 'development',
          JWT_SECRET: 'local-jwt-secret',
          REGISTRATION_TOKEN_SECRET: 'local-reg-secret',
        }),
      ),
    ).toBe('local-reg-secret');
  });
});

describe('resolveOrderChatWsJwtSecret', () => {
  it('prod без секрета — throw', () => {
    expect(() =>
      resolveOrderChatWsJwtSecret(
        cfg({ NODE_ENV: 'production', JWT_SECRET: 'a-strong-secret-value' }),
      ),
    ).toThrow(/ORDER_CHAT_WS_JWT_SECRET/);
  });

  it('prod равный JWT_SECRET — throw', () => {
    expect(() =>
      resolveOrderChatWsJwtSecret(
        cfg({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-strong-secret-value',
          ORDER_CHAT_WS_JWT_SECRET: 'a-strong-secret-value',
        }),
      ),
    ).toThrow(/differ from JWT_SECRET/);
  });

  it('prod с отдельным секретом — ok', () => {
    expect(
      resolveOrderChatWsJwtSecret(
        cfg({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-strong-secret-value',
          ORDER_CHAT_WS_JWT_SECRET: 'another-strong-ws-secret',
        }),
      ),
    ).toBe('another-strong-ws-secret');
  });

  it('dev без ws — fallback на JWT', () => {
    expect(
      resolveOrderChatWsJwtSecret(
        cfg({ NODE_ENV: 'development', JWT_SECRET: 'local-jwt-secret' }),
      ),
    ).toBe('local-jwt-secret');
  });
});

describe('resolveOrderPaySecret', () => {
  it('prod без секрета — throw', () => {
    expect(() =>
      resolveOrderPaySecret(
        cfg({ NODE_ENV: 'production', JWT_SECRET: 'a-strong-secret-value' }),
      ),
    ).toThrow(/ORDER_PAY_SECRET/);
  });

  it('prod равный JWT_SECRET — throw', () => {
    expect(() =>
      resolveOrderPaySecret(
        cfg({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-strong-secret-value',
          ORDER_PAY_SECRET: 'a-strong-secret-value',
        }),
      ),
    ).toThrow(/differ from JWT_SECRET/);
  });

  it('prod с отдельным секретом — ok', () => {
    expect(
      resolveOrderPaySecret(
        cfg({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-strong-secret-value',
          ORDER_PAY_SECRET: 'another-strong-order-pay-secret',
        }),
      ),
    ).toBe('another-strong-order-pay-secret');
  });

  it('dev без pay — fallback на JWT', () => {
    expect(
      resolveOrderPaySecret(
        cfg({ NODE_ENV: 'development', JWT_SECRET: 'local-jwt-secret' }),
      ),
    ).toBe('local-jwt-secret');
  });
});
