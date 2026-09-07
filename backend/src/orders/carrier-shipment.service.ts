import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShipmentProvider } from '@prisma/client';
import {
  isPvzShippingComment,
  resolvePvzCode,
} from './order-shipping.resolve';

export type OrderForCarrierRegister = {
  id: string;
  number: string;
  email: string;
  phone: string;
  customerName: string | null;
  shippingMethod: ShipmentProvider | null;
  shippingAddress: unknown;
  items: Array<{
    title: string;
    sku: string;
    qty: number;
    unitPrice: number;
    isGratitudeGift: boolean;
  }>;
};

export type CarrierRegisterResult = {
  provider: ShipmentProvider;
  externalId: string | null;
  tracking: string | null;
  raw: unknown;
};

type ShippingSnap = {
  city?: string;
  address?: string;
  apartment?: string;
  region?: string;
  district?: string;
  postalCode?: string;
  comment?: string;
  pvzCode?: string;
  phone?: string;
  recipientName?: string;
  carrierQuote?: {
    tariffId?: number | null;
    tariffName?: string | null;
    daysMin?: number | null;
    daysMax?: number | null;
  };
};

function asSnap(raw: unknown): ShippingSnap {
  if (!raw || typeof raw !== 'object') return {};
  return raw as ShippingSnap;
}

@Injectable()
export class CarrierShipmentService {
  private readonly logger = new Logger(CarrierShipmentService.name);
  private cdekToken: string | null = null;
  private cdekTokenExpiry = 0;

  constructor(private readonly config: ConfigService) {}

  isCdekConfigured(): boolean {
    return Boolean(
      this.config.get<string>('CDEK_ACCOUNT')?.trim() &&
        this.config.get<string>('CDEK_SECURE')?.trim(),
    );
  }

  /**
   * Создаёт отправление у перевозчика по snapshot заказа.
   * СДЭК: POST /v2/orders (delivery_point = pvzCode или to_location для курьера).
   * Яндекс: пока не подключён.
   */
  async register(
    order: OrderForCarrierRegister,
    providerOverride?: ShipmentProvider | null,
  ): Promise<CarrierRegisterResult> {
    const method = providerOverride ?? order.shippingMethod;
    if (method === ShipmentProvider.CDEK) {
      return this.registerCdek(order);
    }
    if (method === ShipmentProvider.YANDEX) {
      throw new BadRequestException(
        'Автосоздание заявки Яндекс Доставки пока не подключено. Укажите трек вручную или зарегистрируйте отправление в кабинете Яндекса.',
      );
    }
    throw new BadRequestException(
      'Автосоздание отправления доступно только для СДЭК / Яндекс',
    );
  }

  private async getCdekToken(): Promise<string> {
    const account = this.config.get<string>('CDEK_ACCOUNT')?.trim();
    const secure = this.config.get<string>('CDEK_SECURE')?.trim();
    if (!account || !secure) {
      throw new BadRequestException(
        'Не заданы CDEK_ACCOUNT / CDEK_SECURE — нельзя создать отправление СДЭК',
      );
    }
    if (this.cdekToken && Date.now() < this.cdekTokenExpiry - 60_000) {
      return this.cdekToken;
    }
    const res = await fetch('https://api.cdek.ru/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: account,
        client_secret: secure,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new BadRequestException(
        json.error_description ||
          json.error ||
          `СДЭК OAuth ${res.status}`,
      );
    }
    this.cdekToken = json.access_token;
    this.cdekTokenExpiry =
      Date.now() + Math.max(60, Number(json.expires_in || 3600)) * 1000;
    return this.cdekToken;
  }

  private async registerCdek(
    order: OrderForCarrierRegister,
  ): Promise<CarrierRegisterResult> {
    const snap = asSnap(order.shippingAddress);
    const pvzCode = resolvePvzCode(snap.comment, snap.pvzCode);
    const toPvz = isPvzShippingComment(snap.comment) || Boolean(pvzCode);
    if (toPvz && !pvzCode) {
      throw new BadRequestException(
        'В адресе заказа нет pvzCode — пересохраните ПВЗ СДЭК',
      );
    }

    const recipientName =
      (snap.recipientName || '').trim() ||
      (order.customerName || '').trim() ||
      'Получатель';
    const recipientPhone =
      (snap.phone || '').trim() || (order.phone || '').trim();
    if (!recipientPhone) {
      throw new BadRequestException('Нет телефона получателя для СДЭК');
    }

    const shipmentPoint = this.config
      .get<string>('CDEK_SHIPMENT_POINT')
      ?.trim();
    const fromCity = Number(
      this.config.get<string>('CDEK_FROM_CITY_CODE') || '44',
    );

    const tariffPvz = Number(
      this.config.get<string>('CDEK_TARIFF_PVZ') || '136',
    );
    const tariffDoor = Number(
      this.config.get<string>('CDEK_TARIFF_DOOR') || '137',
    );
    const snapTariff = Number(snap.carrierQuote?.tariffId);
    const tariffCode =
      Number.isFinite(snapTariff) && snapTariff > 0
        ? snapTariff
        : toPvz
          ? tariffPvz
          : tariffDoor;

    const packages = this.buildCdekPackages(order);
    const payload: Record<string, unknown> = {
      type: 1,
      number: order.number,
      tariff_code: tariffCode,
      recipient: {
        name: recipientName,
        phones: [{ number: recipientPhone }],
        email: order.email,
      },
      packages,
    };

    if (shipmentPoint) {
      payload.shipment_point = shipmentPoint;
    } else {
      payload.from_location = { code: fromCity };
    }

    if (toPvz) {
      payload.delivery_point = pvzCode;
    } else {
      const city = (snap.city || '').trim();
      const addressLine = [snap.address, snap.apartment]
        .map((x) => (x || '').trim())
        .filter(Boolean)
        .join(', ');
      if (!city || !addressLine) {
        throw new BadRequestException(
          'Для курьера СДЭК нужны city и address в shippingAddress',
        );
      }
      payload.to_location = {
        city,
        address: addressLine,
        ...(snap.postalCode ? { postal_code: snap.postalCode } : {}),
        ...(snap.region ? { region: snap.region } : {}),
      };
    }

    const token = await this.getCdekToken();
    const res = await fetch('https://api.cdek.ru/v2/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = this.formatCdekError(raw, `СДЭК orders ${res.status}`);
      this.logger.warn(`CDEK register failed for ${order.number}: ${msg}`);
      throw new BadRequestException(msg);
    }

    const entity = (raw as { entity?: { uuid?: string; cdek_number?: string } })
      ?.entity;
    const requests = (
      raw as {
        requests?: Array<{
          state?: string;
          errors?: Array<{ code?: string; message?: string }>;
        }>;
      }
    )?.requests;
    const failed = requests?.find((r) => r.state === 'INVALID');
    if (failed) {
      const detail =
        failed.errors
          ?.map((e) => e.message || e.code)
          .filter(Boolean)
          .join('; ') || JSON.stringify(failed);
      this.logger.warn(
        `CDEK register INVALID for ${order.number}: ${detail}`,
      );
      throw new BadRequestException(
        `СДЭК отклонил заказ: ${detail}`.slice(0, 500),
      );
    }

    let tracking = entity?.cdek_number ? String(entity.cdek_number) : null;
    const uuid = entity?.uuid || null;
    if (uuid && !tracking) {
      tracking = await this.pollCdekTracking(token, uuid);
    }

    return {
      provider: ShipmentProvider.CDEK,
      externalId: uuid,
      tracking,
      raw,
    };
  }

  private formatCdekError(raw: unknown, fallback: string): string {
    if (!raw || typeof raw !== 'object') return fallback;
    const o = raw as {
      message?: string;
      error?: string;
      errors?: Array<{ message?: string; code?: string }>;
      requests?: Array<{ errors?: Array<{ message?: string; code?: string }> }>;
    };
    const fromRequests = o.requests
      ?.flatMap((r) => r.errors || [])
      .map((e) => e.message || e.code)
      .filter(Boolean);
    const fromErrors = o.errors
      ?.map((e) => e.message || e.code)
      .filter(Boolean);
    const msg =
      o.message ||
      o.error ||
      fromRequests?.[0] ||
      fromErrors?.[0] ||
      fallback;
    return typeof msg === 'string' ? msg.slice(0, 500) : fallback;
  }

  /** cdek_number часто появляется с задержкой после create. */
  private async pollCdekTracking(
    token: string,
    uuid: string,
  ): Promise<string | null> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 700));
      try {
        const res = await fetch(`https://api.cdek.ru/v2/orders/${uuid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as {
          entity?: { cdek_number?: string };
        };
        const n = json.entity?.cdek_number;
        if (n) return String(n);
      } catch {
        /* ignore transient */
      }
    }
    return null;
  }

  private buildCdekPackages(order: OrderForCarrierRegister) {
    const lines = order.items.filter((i) => !i.isGratitudeGift);
    const items = (lines.length ? lines : order.items).map((l, idx) => ({
      name: (l.title || 'Товар').slice(0, 255),
      ware_key: (l.sku || `sku-${idx + 1}`).slice(0, 50),
      payment: { value: 0 },
      cost: Math.max(0, l.unitPrice),
      amount: Math.max(1, l.qty),
      weight: 300,
    }));
    const weight = items.reduce((s, i) => s + i.weight * i.amount, 0);
    return [
      {
        number: '1',
        weight: Math.max(1, weight),
        length: 20,
        width: 15,
        height: 10,
        items,
      },
    ];
  }
}
