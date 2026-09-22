import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const YOOKASSA_API_URL = 'https://api.yookassa.ru/v3';
/** АУСН / УСН без НДС — «Без НДС» в справочнике ЮKassa (не путать с legacy-кодами 4=20%). */
const YOOKASSA_RECEIPT_VAT_CODE = 1;
/** УСН доходы → в АТОЛ уходит company.sno=usn_income (для АУСН отдельного кода нет). */
const YOOKASSA_RECEIPT_TAX_SYSTEM_CODE = 2;

export type YooKassaAmount = { value: string; currency: string };

export type YooKassaPayment = {
  id: string;
  status: string;
  paid: boolean;
  amount?: YooKassaAmount;
  confirmation?: { type?: string; confirmation_token?: string; confirmation_url?: string };
  metadata?: Record<string, string>;
};

export type CreateEmbeddedPaymentInput = {
  amountRub: number;
  description: string;
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  returnUrl: string;
  receiptItems: Array<{
    description: string;
    quantity: number;
    amountRub: number;
  }>;
};

@Injectable()
export class YooKassaService {
  private readonly logger = new Logger(YooKassaService.name);

  constructor(private readonly config: ConfigService) {}

  private envCred(key: 'YOOKASSA_SHOP_ID' | 'YOOKASSA_SECRET_KEY'): string {
    // process.env first: systemd EnvironmentFile is authoritative in prod;
    // ConfigService can miss keys depending on load order / cache.
    return (process.env[key] ?? this.config.get<string>(key) ?? '').trim();
  }

  private credentials(): { shopId: string; secretKey: string } {
    const shopId = this.envCred('YOOKASSA_SHOP_ID');
    const secretKey = this.envCred('YOOKASSA_SECRET_KEY');
    if (!shopId || !secretKey) {
      throw new ServiceUnavailableException(
        'Оплата временно недоступна: не настроены ключи ЮKassa',
      );
    }
    return { shopId, secretKey };
  }

  private authHeader(): string {
    const { shopId, secretKey } = this.credentials();
    return `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotenceKey?: string,
  ): Promise<YooKassaPayment> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: this.authHeader(),
    };
    if (method === 'POST') {
      headers['Idempotence-Key'] =
        idempotenceKey || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const res = await fetch(`${YOOKASSA_API_URL}/${path.replace(/^\//, '')}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new BadRequestException(`ЮKassa: некорректный ответ (${res.status})`);
    }

    if (!res.ok) {
      const desc = String(json.description || json.code || res.status);
      this.logger.error(`YooKassa ${method} ${path} failed: ${desc}`);
      throw new BadRequestException(desc || 'Не удалось создать платёж ЮKassa');
    }

    return json as unknown as YooKassaPayment;
  }

  async createEmbeddedPayment(
    input: CreateEmbeddedPaymentInput,
  ): Promise<{ payment: YooKassaPayment; confirmationToken: string }> {
    const amount = Math.max(0, Math.round(input.amountRub));
    if (amount <= 0) {
      throw new BadRequestException('Сумма оплаты должна быть больше 0');
    }

    const receiptItems = input.receiptItems
      .filter((i) => i.quantity > 0 && i.amountRub > 0)
      .map((i) => ({
        description: i.description.slice(0, 128),
        quantity: i.quantity,
        amount: {
          value: i.amountRub.toFixed(2),
          currency: 'RUB',
        },
        vat_code: YOOKASSA_RECEIPT_VAT_CODE,
        payment_mode: 'full_payment',
        payment_subject: 'commodity',
      }));

    if (!receiptItems.length) {
      throw new BadRequestException('Нет позиций для чека');
    }

    // Подгонка суммы позиций чека под amount (копейки)
    const sum = receiptItems.reduce(
      (s, i) => s + Number(i.amount.value) * i.quantity,
      0,
    );
    const target = amount;
    if (Math.abs(sum - target) >= 0.01 && receiptItems.length) {
      const last = receiptItems[receiptItems.length - 1]!;
      const others = sum - Number(last.amount.value) * last.quantity;
      const unit = Math.max(0.01, (target - others) / last.quantity);
      last.amount.value = unit.toFixed(2);
    }

    const payment = await this.request(
      'POST',
      'payments',
      {
        amount: { value: amount.toFixed(2), currency: 'RUB' },
        capture: true,
        description: input.description.slice(0, 128),
        confirmation: {
          type: 'embedded',
          return_url: input.returnUrl,
        },
        metadata: {
          orderId: input.orderId,
          orderNumber: input.orderNumber,
        },
        receipt: {
          customer: { email: input.customerEmail },
          tax_system_code: YOOKASSA_RECEIPT_TAX_SYSTEM_CODE,
          items: receiptItems,
        },
      },
      `order-${input.orderId}-${amount}`,
    );

    const token = payment.confirmation?.confirmation_token;
    if (!token) {
      throw new BadRequestException('ЮKassa не вернула confirmation_token');
    }

    return { payment, confirmationToken: token };
  }

  /**
   * Redirect-оплата (ссылка в письме / админке) — доплата по заказу.
   */
  async createRedirectPayment(input: {
    amountRub: number;
    description: string;
    orderId: string;
    orderNumber: string;
    customerEmail: string;
    returnUrl: string;
    kind?: string;
    receiptItems: Array<{
      description: string;
      quantity: number;
      amountRub: number;
    }>;
  }): Promise<{ payment: YooKassaPayment; confirmationUrl: string }> {
    const amount = Math.max(0, Math.round(input.amountRub));
    if (amount <= 0) {
      throw new BadRequestException('Сумма оплаты должна быть больше 0');
    }

    const receiptItems = input.receiptItems
      .filter((i) => i.quantity > 0 && i.amountRub > 0)
      .map((i) => ({
        description: i.description.slice(0, 128),
        quantity: i.quantity,
        amount: {
          value: i.amountRub.toFixed(2),
          currency: 'RUB',
        },
        vat_code: YOOKASSA_RECEIPT_VAT_CODE,
        payment_mode: 'full_payment',
        payment_subject: 'commodity',
      }));

    if (!receiptItems.length) {
      throw new BadRequestException('Нет позиций для чека');
    }

    const sum = receiptItems.reduce(
      (s, i) => s + Number(i.amount.value) * i.quantity,
      0,
    );
    const target = amount;
    if (Math.abs(sum - target) >= 0.01 && receiptItems.length) {
      const last = receiptItems[receiptItems.length - 1]!;
      const others = sum - Number(last.amount.value) * last.quantity;
      const unit = Math.max(0.01, (target - others) / last.quantity);
      last.amount.value = unit.toFixed(2);
    }

    const metadata: Record<string, string> = {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
    };
    if (input.kind) metadata.kind = input.kind;

    const payment = await this.request(
      'POST',
      'payments',
      {
        amount: { value: amount.toFixed(2), currency: 'RUB' },
        capture: true,
        description: input.description.slice(0, 128),
        confirmation: {
          type: 'redirect',
          return_url: input.returnUrl,
        },
        metadata,
        receipt: {
          customer: { email: input.customerEmail },
          tax_system_code: YOOKASSA_RECEIPT_TAX_SYSTEM_CODE,
          items: receiptItems,
        },
      },
      `surcharge-${input.orderId}-${amount}-${Date.now()}`,
    );

    const confirmationUrl = payment.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      throw new BadRequestException('ЮKassa не вернула confirmation_url');
    }

    return { payment, confirmationUrl };
  }

  getPayment(paymentId: string) {
    return this.request('GET', `payments/${encodeURIComponent(paymentId)}`);
  }

  isConfigured(): boolean {
    return Boolean(
      this.envCred('YOOKASSA_SHOP_ID') && this.envCred('YOOKASSA_SECRET_KEY'),
    );
  }

  /**
   * Отмена платежа в ЮKassa (pending / waiting_for_capture).
   * Идемпотентно: уже canceled — ок.
   */
  async cancelPayment(paymentId: string): Promise<YooKassaPayment> {
    const id = paymentId.trim();
    if (!id) throw new BadRequestException('paymentId обязателен');
    try {
      return await this.request(
        'POST',
        `payments/${encodeURIComponent(id)}/cancel`,
        {},
        `cancel-${id}`,
      );
    } catch (e) {
      // Уже отменён / нельзя отменить — не валим abandon
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`YooKassa cancel ${id}: ${msg}`);
      throw e;
    }
  }

  /** Best-effort отмена списка PENDING payments на стороне провайдера. */
  async cancelPaymentsBestEffort(externalIds: string[]): Promise<void> {
    if (!this.isConfigured()) return;
    for (const raw of externalIds) {
      const id = raw?.trim();
      if (!id) continue;
      try {
        await this.cancelPayment(id);
      } catch {
        /* logged in cancelPayment */
      }
    }
  }

  /**
   * Возврат через ЮKassa.
   * Админ может сделать refund с `providerRefund: false` (только учёт в БД).
   */
  async createRefund(input: {
    paymentId: string;
    amountRub: number;
    description?: string;
  }): Promise<{ id: string; status: string; amount?: YooKassaAmount }> {
    const amount = Math.max(0, Math.round(input.amountRub));
    if (amount <= 0) {
      throw new BadRequestException('Сумма возврата должна быть больше 0');
    }
    const json = await this.request(
      'POST',
      'refunds',
      {
        payment_id: input.paymentId,
        amount: { value: amount.toFixed(2), currency: 'RUB' },
        description: (input.description ?? 'Возврат').slice(0, 250),
      },
      `refund-${input.paymentId}-${amount}-${Date.now()}`,
    );
    return json as unknown as { id: string; status: string; amount?: YooKassaAmount };
  }
}
