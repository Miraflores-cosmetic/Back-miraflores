import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

const PROD_API = 'https://pay.yandex.ru/api/merchant/v1';
const SANDBOX_API = 'https://sandbox.pay.yandex.ru/api/merchant/v1';
const PROD_API_V2 = 'https://pay.yandex.ru/api/merchant/v2';
const SANDBOX_API_V2 = 'https://sandbox.pay.yandex.ru/api/merchant/v2';
const PROD_JWKS = 'https://pay.yandex.ru/api/jwks';
const SANDBOX_JWKS = 'https://sandbox.pay.yandex.ru/api/jwks';

/** Ставка «без НДС» в фискализации Яндекс Пэй (как vat_code=1 в ЮKassa). */
const RECEIPT_TAX_NO_VAT = 1;

export type YandexPayCartItem = {
  productId: string;
  title: string;
  quantity: number;
  /** Итого по позиции, ₽ (unit × qty после скидок). */
  totalRub: number;
};

export type CreateYandexPayOrderInput = {
  /** Merchant orderId: `{Order.id}:{attempt}` (см. yandex-pay-order-id.ts). */
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  amountRub: number;
  items: YandexPayCartItem[];
  redirectUrls: {
    onSuccess: string;
    onError: string;
    onAbort: string;
  };
};

export type YandexPayRemoteOrder = {
  orderId: string;
  paymentStatus?: string;
  /** Сумма корзины в рублях, если удалось прочитать. */
  amountRub: number | null;
  raw: unknown;
};

export type YandexPayWebhookPayload = {
  merchantId?: string;
  event?: string;
  eventTime?: string;
  order?: {
    orderId?: string;
    paymentStatus?: string;
  };
  operation?: {
    operationId?: string;
    orderId?: string;
    status?: string;
    operationType?: string;
  };
};

@Injectable()
export class YandexPayService {
  private readonly logger = new Logger(YandexPayService.name);
  private jwksProd: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksSandbox: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly config: ConfigService) {}

  private env(key: string): string {
    return (process.env[key] ?? this.config.get<string>(key) ?? '').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.env('YANDEX_PAY_MERCHANT_ID') && this.env('YANDEX_PAY_API_KEY'));
  }

  merchantId(): string {
    const id = this.env('YANDEX_PAY_MERCHANT_ID');
    if (!id) {
      throw new ServiceUnavailableException(
        'Оплата Яндекс Пэй временно недоступна: не задан Merchant ID',
      );
    }
    return id;
  }

  /** sandbox | production — влияет на API host и JWKS. */
  isSandbox(): boolean {
    const raw = this.env('YANDEX_PAY_ENV').toLowerCase();
    return raw === 'sandbox' || raw === 'test';
  }

  private apiBase(version: 1 | 2 = 1): string {
    if (version === 2) {
      return this.isSandbox() ? SANDBOX_API_V2 : PROD_API_V2;
    }
    return this.isSandbox() ? SANDBOX_API : PROD_API;
  }

  private apiKey(): string {
    const key = this.env('YANDEX_PAY_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'Оплата Яндекс Пэй временно недоступна: не задан API-ключ',
      );
    }
    return key;
  }

  private jwks() {
    if (this.isSandbox()) {
      this.jwksSandbox ??= createRemoteJWKSet(new URL(SANDBOX_JWKS));
      return this.jwksSandbox;
    }
    this.jwksProd ??= createRemoteJWKSet(new URL(PROD_JWKS));
    return this.jwksProd;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    requestId?: string,
    apiVersion: 1 | 2 = 1,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Api-Key ${this.apiKey()}`,
      Accept: 'application/json',
      'X-Request-Id':
        requestId ||
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      'X-Request-Timeout': '10000',
      'X-Request-Attempt': '0',
    };
    if (body != null) headers['Content-Type'] = 'application/json';

    const res = await fetch(
      `${this.apiBase(apiVersion)}/${path.replace(/^\//, '')}`,
      {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      },
    );

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new BadRequestException(
        `Яндекс Пэй: некорректный ответ (${res.status})`,
      );
    }

    if (!res.ok) {
      const desc = String(
        (json as { message?: string }).message ||
          (json as { reasonCode?: string }).reasonCode ||
          json.code ||
          res.status,
      );
      this.logger.error(`YandexPay ${method} ${path} failed: ${desc}`);
      throw new BadRequestException(desc || 'Не удалось создать платёж Яндекс Пэй');
    }

    return json as T;
  }

  /**
   * POST /v1/orders → paymentUrl для Web SDK onPayButtonClick.
   */
  async createOrder(
    input: CreateYandexPayOrderInput,
  ): Promise<{ paymentUrl: string; raw: unknown }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Оплата Яндекс Пэй временно недоступна',
      );
    }
    const amount = Math.max(0, Math.round(input.amountRub));
    if (amount <= 0) {
      throw new BadRequestException('Сумма оплаты должна быть больше 0');
    }

    const items = input.items
      .filter((i) => i.quantity > 0 && i.totalRub > 0)
      .map((i) => ({
        productId: i.productId.slice(0, 128),
        title: i.title.slice(0, 128),
        quantity: { count: String(i.quantity) },
        total: i.totalRub.toFixed(2),
        receipt: { tax: RECEIPT_TAX_NO_VAT },
      }));

    if (!items.length) {
      throw new BadRequestException('Пустая корзина для Яндекс Пэй');
    }

    const cartTotal = items.reduce((s, i) => s + Number(i.total), 0);
    // Подгоняем последнюю позицию к order.total (копейки / shipping).
    const diff = amount - Math.round(cartTotal * 100) / 100;
    if (Math.abs(diff) >= 0.01 && items.length) {
      const last = items[items.length - 1];
      last.total = (Number(last.total) + diff).toFixed(2);
    }

    const body = {
      orderId: input.orderId,
      currencyCode: 'RUB',
      availablePaymentMethods: ['CARD', 'SPLIT'],
      fiscalContact: input.customerEmail,
      cart: {
        externalId: input.orderNumber,
        items,
        total: { amount: amount.toFixed(2) },
      },
      redirectUrls: input.redirectUrls,
      metadata: input.orderNumber.slice(0, 128),
      purpose: `Заказ ${input.orderNumber}`.slice(0, 128),
    };

    const res = await this.request<{
      code?: number;
      data?: { paymentUrl?: string };
      paymentUrl?: string;
    }>('POST', 'orders', body, `yp-create-${input.orderId}`);

    const paymentUrl =
      res.data?.paymentUrl?.trim() ||
      (typeof res.paymentUrl === 'string' ? res.paymentUrl.trim() : '');
    if (!paymentUrl) {
      this.logger.error(`YandexPay createOrder: no paymentUrl ${JSON.stringify(res)}`);
      throw new BadRequestException('Яндекс Пэй не вернул ссылку на оплату');
    }
    return { paymentUrl, raw: res };
  }

  /**
   * Аннулирует платёжную ссылку (PENDING → FAILED) — аналог YooKassa cancel.
   * Exclusive / abandon / admin cancel unpaid.
   */
  async cancelOrderBestEffort(merchantOrderId: string): Promise<void> {
    const id = merchantOrderId?.trim();
    if (!id || !this.isConfigured()) return;
    try {
      await this.request(
        'POST',
        `orders/${encodeURIComponent(id)}/rollback`,
        {},
        `yp-rollback-${id}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`YandexPay cancel/rollback ${id}: ${msg}`);
    }
  }

  /** @deprecated alias — используйте cancelOrderBestEffort */
  async rollbackOrderBestEffort(orderId: string): Promise<void> {
    return this.cancelOrderBestEffort(orderId);
  }

  async cancelOrdersBestEffort(merchantOrderIds: string[]): Promise<void> {
    if (!this.isConfigured()) return;
    for (const raw of merchantOrderIds) {
      await this.cancelOrderBestEffort(raw);
    }
  }

  /**
   * Возврат средств (Merchant API v2) — зеркало YooKassa createRefund.
   * Полный/частичный: передаём только refundAmount (корзина целиком).
   */
  async createRefund(input: {
    merchantOrderId: string;
    amountRub: number;
    reason?: string;
    externalOperationId?: string;
  }): Promise<{ id: string; status: string; raw: unknown }> {
    const id = input.merchantOrderId?.trim();
    if (!id) throw new BadRequestException('merchantOrderId обязателен');
    const amount = Math.max(0, Math.round(input.amountRub));
    if (amount < 1) {
      throw new BadRequestException('Сумма возврата должна быть ≥ 1 ₽');
    }
    const externalOperationId =
      input.externalOperationId?.trim() ||
      `rf-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const res = await this.request<{
      code?: number;
      status?: string;
      data?: {
        operation?: {
          operationId?: string;
          status?: string;
        };
      };
    }>(
      'POST',
      `orders/${encodeURIComponent(id)}/refund`,
      {
        refundAmount: amount.toFixed(2),
        externalOperationId,
      },
      `yp-refund-${externalOperationId}`,
      2,
    );

    const op = res.data?.operation;
    return {
      id: op?.operationId || externalOperationId,
      status: op?.status || res.status || 'PENDING',
      raw: res,
    };
  }

  async getOrder(orderId: string): Promise<YandexPayRemoteOrder> {
    const res = await this.request<Record<string, unknown>>(
      'GET',
      `orders/${encodeURIComponent(orderId)}`,
    );

    const data = (
      res.data && typeof res.data === 'object' ? res.data : res
    ) as {
      orderId?: string;
      paymentStatus?: string;
      orderAmount?: string | number;
      cart?: { total?: { amount?: string } };
    };
    const amountRaw = data.cart?.total?.amount ?? data.orderAmount;
    let amountRub: number | null = null;
    if (amountRaw != null && amountRaw !== '') {
      const n = Math.round(Number(amountRaw));
      if (Number.isFinite(n)) amountRub = n;
    }

    return {
      orderId: String(data.orderId || orderId),
      paymentStatus: data.paymentStatus,
      amountRub,
      raw: res,
    };
  }

  /**
   * Проверка JWT вебхука (ES256 + JWKS).
   * Yandex кладёт exp в protected header — проверяем явно + require merchantId.
   */
  async verifyWebhookJwt(token: string): Promise<YandexPayWebhookPayload> {
    const raw = token.trim();
    if (!raw) {
      throw new UnauthorizedException({
        status: 'fail',
        reasonCode: 'OTHER',
        reason: 'empty token',
      });
    }

    try {
      let header: ReturnType<typeof decodeProtectedHeader>;
      try {
        header = decodeProtectedHeader(raw);
      } catch {
        throw new UnauthorizedException({
          status: 'fail',
          reasonCode: 'UNAUTHORIZED',
          reason: 'invalid jwt header',
        });
      }

      // Доки Yandex: exp / iat в header (не только в payload).
      const nowSec = Math.floor(Date.now() / 1000);
      const headerExp =
        typeof header.exp === 'number'
          ? header.exp
          : typeof (header as { exp?: string }).exp === 'string'
            ? Number.parseInt((header as { exp: string }).exp, 10)
            : null;
      if (headerExp != null && Number.isFinite(headerExp) && headerExp < nowSec) {
        throw new UnauthorizedException({
          status: 'fail',
          reasonCode: 'TOKEN_EXPIRED',
          reason: 'jwt header exp',
        });
      }

      const { payload } = await jwtVerify(raw, this.jwks(), {
        algorithms: ['ES256'],
      });
      const data = payload as YandexPayWebhookPayload;
      const expected = this.merchantId();
      const got = (data.merchantId || '').trim();
      if (!got || got !== expected) {
        this.logger.warn(
          `YandexPay webhook merchantId missing/mismatch: ${got || '(none)'}`,
        );
        throw new UnauthorizedException({
          status: 'fail',
          reasonCode: 'UNAUTHORIZED',
          reason: 'merchantId',
        });
      }
      return data;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/expir/i.test(msg) || /"exp"/i.test(msg)) {
        throw new UnauthorizedException({
          status: 'fail',
          reasonCode: 'TOKEN_EXPIRED',
          reason: msg,
        });
      }
      this.logger.warn(`YandexPay webhook JWT invalid: ${msg}`);
      throw new UnauthorizedException({
        status: 'fail',
        reasonCode: 'UNAUTHORIZED',
        reason: msg,
      });
    }
  }
}
