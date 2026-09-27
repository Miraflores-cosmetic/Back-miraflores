import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveOrderPaySecret } from '../auth/jwt-secret';
import type { CheckoutCarrier } from './order-shipping.resolve';

export type ShippingQuotePayload = {
  v: 1;
  cost: number;
  method: CheckoutCarrier;
  addrHash: string;
  linesHash: string;
  /** Subtotal товаров на момент quote (для аудита). */
  goodsSubtotal: number;
  freePvz: boolean;
  exp: number;
  /** Опционально с клиента (СДЭК tariff_code / сроки). */
  tariffId?: number | null;
  tariffName?: string | null;
  daysMin?: number | null;
  daysMax?: number | null;
};

export function hashShippingAddress(
  addr: {
    city: string;
    address: string;
    apartment?: string | null;
    region?: string | null;
    district?: string | null;
    postalCode?: string | null;
    comment?: string | null;
    pvzCode?: string | null;
    phone?: string | null;
    recipientName?: string | null;
  },
  method: string,
): string {
  const norm = [
    method.trim().toUpperCase(),
    (addr.city ?? '').trim().toLowerCase(),
    (addr.address ?? '').trim().toLowerCase(),
    (addr.apartment ?? '').trim().toLowerCase(),
    (addr.region ?? '').trim().toLowerCase(),
    (addr.district ?? '').trim().toLowerCase(),
    (addr.postalCode ?? '').trim(),
    (addr.comment ?? '').trim(),
    (addr.pvzCode ?? '').trim(),
    (addr.phone ?? '').trim(),
    (addr.recipientName ?? '').trim(),
  ].join('\n');
  return createHash('sha256').update(norm, 'utf8').digest('hex');
}

export function hashCartLines(
  lines: Array<{ variantId: string; shadeId?: string | null; qty: number }>,
): string {
  const parts = lines
    .map((l) => `${l.variantId.trim()}:${Math.floor(l.qty)}`)
    .sort();
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

@Injectable()
export class ShippingQuoteService {
  constructor(private readonly config: ConfigService) {
    resolveOrderPaySecret(this.config);
  }

  private secret(): string {
    return resolveOrderPaySecret(this.config);
  }

  /** TTL quote: 15 мин (корзина/тариф не должны устаревать дольше). */
  ttlSeconds(): number {
    const raw = Number.parseInt(
      this.config.get<string>('SHIPPING_QUOTE_TTL_SECONDS') || '900',
      10,
    );
    return Math.min(3600, Math.max(120, Number.isFinite(raw) ? raw : 900));
  }

  issue(input: Omit<ShippingQuotePayload, 'v' | 'exp'>): {
    quote: string;
    expiresAt: string;
    payload: ShippingQuotePayload;
  } {
    const payload: ShippingQuotePayload = {
      v: 1,
      cost: Math.floor(input.cost),
      method: input.method,
      addrHash: input.addrHash,
      linesHash: input.linesHash,
      goodsSubtotal: Math.floor(input.goodsSubtotal),
      freePvz: Boolean(input.freePvz),
      exp: Math.floor(Date.now() / 1000) + this.ttlSeconds(),
      ...(input.tariffId != null
        ? { tariffId: Math.floor(Number(input.tariffId)) }
        : {}),
      ...(input.tariffName
        ? { tariffName: String(input.tariffName).slice(0, 160) }
        : {}),
      ...(input.daysMin != null
        ? { daysMin: Math.floor(Number(input.daysMin)) }
        : {}),
      ...(input.daysMax != null
        ? { daysMax: Math.floor(Number(input.daysMax)) }
        : {}),
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const sig = createHmac('sha256', this.secret())
      .update(`shipping-quote.v1.${body}`)
      .digest('base64url');
    return {
      quote: `${body}.${sig}`,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      payload,
    };
  }

  verify(token: string | undefined | null): ShippingQuotePayload {
    const raw = token?.trim();
    if (!raw) {
      throw new BadRequestException('shippingQuote обязателен');
    }
    const [body, sig] = raw.split('.');
    if (!body || !sig) {
      throw new BadRequestException('Некорректный shippingQuote');
    }
    const expected = createHmac('sha256', this.secret())
      .update(`shipping-quote.v1.${body}`)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Некорректный shippingQuote');
    }

    let payload: ShippingQuotePayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as ShippingQuotePayload;
    } catch {
      throw new BadRequestException('Некорректный shippingQuote');
    }

    if (
      payload.v !== 1 ||
      (payload.method !== 'CDEK' &&
        payload.method !== 'YANDEX' &&
        payload.method !== 'OZON') ||
      typeof payload.addrHash !== 'string' ||
      typeof payload.linesHash !== 'string' ||
      !Number.isFinite(payload.cost) ||
      !Number.isFinite(payload.exp)
    ) {
      throw new BadRequestException('Некорректный shippingQuote');
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException(
        'Срок действия расчёта доставки истёк. Обновите расчёт.',
      );
    }
    return payload;
  }
}
