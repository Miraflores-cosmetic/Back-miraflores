import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveOrderPaySecret } from '../auth/jwt-secret';
import { resolveAwaitingRemindSchedule } from './order-awaiting-payment-schedule';

type PayTokenPayload = {
  v: 1;
  orderId: string;
  guestId: string;
  exp: number;
};

@Injectable()
export class OrderPayTokenService {
  constructor(private readonly config: ConfigService) {
    // Fail-fast в production без ORDER_PAY_SECRET.
    resolveOrderPaySecret(this.config);
  }

  private secret(): string {
    return resolveOrderPaySecret(this.config);
  }

  /** TTL в секундах: ORDER_AWAITING_TTL_MINUTES + 15 мин запас. */
  ttlSeconds(): number {
    return (this.awaitingTtlMinutes() + 15) * 60;
  }

  /** Минуты ожидания оплаты (для UI «оплатите до …»). Default 72 ч. */
  awaitingTtlMinutes(): number {
    return resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    }).ttlMinutes;
  }

  issue(orderId: string, guestId: string): string {
    const payload: PayTokenPayload = {
      v: 1,
      orderId,
      guestId,
      exp: Math.floor(Date.now() / 1000) + this.ttlSeconds(),
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const sig = createHmac('sha256', this.secret())
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  verify(
    token: string | undefined | null,
    expectedOrderId?: string,
  ): { orderId: string; guestId: string } {
    const raw = token?.trim();
    if (!raw) throw new BadRequestException('payToken обязателен');

    const [body, sig] = raw.split('.');
    if (!body || !sig) throw new BadRequestException('Некорректный payToken');

    const expected = createHmac('sha256', this.secret())
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Некорректный payToken');
    }

    let payload: PayTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as PayTokenPayload;
    } catch {
      throw new BadRequestException('Некорректный payToken');
    }

    if (payload.v !== 1 || !payload.orderId || !payload.guestId) {
      throw new BadRequestException('Некорректный payToken');
    }
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Срок действия payToken истёк');
    }
    if (expectedOrderId && payload.orderId !== expectedOrderId) {
      throw new BadRequestException('payToken не для этого заказа');
    }

    return { orderId: payload.orderId, guestId: payload.guestId };
  }
}
