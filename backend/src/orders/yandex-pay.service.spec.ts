import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';

const decodeProtectedHeader = vi.fn();
const jwtVerify = vi.fn();
const createRemoteJWKSet = vi.fn(() => ({}));

vi.mock('jose', () => ({
  createRemoteJWKSet: (...args: unknown[]) => createRemoteJWKSet(...args),
  decodeProtectedHeader: (...args: unknown[]) => decodeProtectedHeader(...args),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}));

import { YandexPayService } from './yandex-pay.service';

describe('YandexPayService', () => {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'YANDEX_PAY_MERCHANT_ID') return 'mid-test';
      if (key === 'YANDEX_PAY_API_KEY') return 'key-test';
      if (key === 'YANDEX_PAY_ENV') return 'sandbox';
      return undefined;
    }),
  };

  let service: YandexPayService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.YANDEX_PAY_MERCHANT_ID = 'mid-test';
    process.env.YANDEX_PAY_API_KEY = 'key-test';
    process.env.YANDEX_PAY_ENV = 'sandbox';
    config.get.mockImplementation((key: string) => {
      if (key === 'YANDEX_PAY_MERCHANT_ID') return 'mid-test';
      if (key === 'YANDEX_PAY_API_KEY') return 'key-test';
      if (key === 'YANDEX_PAY_ENV') return 'sandbox';
      return undefined;
    });
    service = new YandexPayService(config as never);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('createOrder', () => {
    it('шлёт cart items с receipt.tax=1 (без НДС) и paymentUrl', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: { paymentUrl: 'https://pay.yandex.ru/l/abc' },
          }),
      });

      const res = await service.createOrder({
        orderId: 'ord1:1',
        orderNumber: 'MF-1',
        customerEmail: 'a@b.co',
        amountRub: 1500,
        items: [
          {
            productId: 'v1',
            title: 'Крем',
            quantity: 1,
            totalRub: 1500,
          },
        ],
        redirectUrls: {
          onSuccess: 'https://shop/ok',
          onError: 'https://shop/err',
          onAbort: 'https://shop/abort',
        },
      });

      expect(res.paymentUrl).toBe('https://pay.yandex.ru/l/abc');
      expect(fetchMock).toHaveBeenCalled();
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        cart: { items: Array<{ receipt?: { tax?: number }; total: string }> };
      };
      expect(body.cart.items[0].receipt?.tax).toBe(1);
      expect(body.cart.items[0].total).toBe('1500.00');
    });

    it('пустая корзина → BadRequest', async () => {
      await expect(
        service.createOrder({
          orderId: 'ord1:1',
          orderNumber: 'MF-1',
          customerEmail: 'a@b.co',
          amountRub: 100,
          items: [],
          redirectUrls: {
            onSuccess: 's',
            onError: 'e',
            onAbort: 'a',
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('verifyWebhookJwt', () => {
    it('TOKEN_EXPIRED при exp в protected header', async () => {
      decodeProtectedHeader.mockReturnValue({
        alg: 'ES256',
        exp: Math.floor(Date.now() / 1000) - 60,
      });

      await expect(service.verifyWebhookJwt('a.b.c')).rejects.toMatchObject({
        response: expect.objectContaining({ reasonCode: 'TOKEN_EXPIRED' }),
      });
      expect(jwtVerify).not.toHaveBeenCalled();
    });

    it('UNAUTHORIZED без merchantId', async () => {
      decodeProtectedHeader.mockReturnValue({
        alg: 'ES256',
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      jwtVerify.mockResolvedValue({
        payload: {
          event: 'ORDER_STATUS_UPDATED',
          order: { orderId: 'x', paymentStatus: 'CAPTURED' },
        },
      });

      await expect(service.verifyWebhookJwt('a.b.c')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      try {
        await service.verifyWebhookJwt('a.b.c');
      } catch (e) {
        expect((e as UnauthorizedException).getResponse()).toMatchObject({
          reasonCode: 'UNAUTHORIZED',
          reason: 'merchantId',
        });
      }
    });

    it('UNAUTHORIZED при чужом merchantId', async () => {
      decodeProtectedHeader.mockReturnValue({
        alg: 'ES256',
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      jwtVerify.mockResolvedValue({
        payload: {
          merchantId: 'other',
          event: 'ORDER_STATUS_UPDATED',
        },
      });

      try {
        await service.verifyWebhookJwt('a.b.c');
        expect.fail('should throw');
      } catch (e) {
        expect((e as UnauthorizedException).getResponse()).toMatchObject({
          reasonCode: 'UNAUTHORIZED',
        });
      }
    });

    it('ok при merchantId + живом header.exp', async () => {
      decodeProtectedHeader.mockReturnValue({
        alg: 'ES256',
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      const payload = {
        merchantId: 'mid-test',
        event: 'ORDER_STATUS_UPDATED',
        order: { orderId: 'ord1:1', paymentStatus: 'CAPTURED' },
      };
      jwtVerify.mockResolvedValue({ payload });

      await expect(service.verifyWebhookJwt('a.b.c')).resolves.toEqual(payload);
    });
  });
});
