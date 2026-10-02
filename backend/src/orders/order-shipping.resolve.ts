import { BadRequestException } from '@nestjs/common';
import { ShipmentProvider } from '@prisma/client';
import {
  DELIVERY_SURCHARGE_DEFAULTS,
  type DeliverySurchargeRub,
  surchargeRubForCheckoutCarrier,
} from './delivery-surcharge';
import type { ShippingQuotePayload } from './shipping-quote.service';
import {
  hashCartLines,
  hashShippingAddress,
} from './shipping-quote.service';

export type CheckoutCarrier = 'CDEK' | 'YANDEX' | 'OZON';

const MAX_SHIPPING_COST = 500_000;

/** Яндекс Доставка в checkout скрыта; включить — YANDEX_DELIVERY_ENABLED=true. */
export function isYandexDeliveryEnabled(): boolean {
  return process.env.YANDEX_DELIVERY_ENABLED?.trim().toLowerCase() === 'true';
}

/** Только СДЭК / Ozon (и Яндекс, если включён) для публичного checkout (PICKUP не принимаем с клиента). */
export function requireCheckoutShipmentProvider(
  raw?: string | null,
): CheckoutCarrier {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === 'YANDEX' && !isYandexDeliveryEnabled()) {
    throw new BadRequestException(
      'Яндекс Доставка сейчас недоступна. Выберите другую службу доставки.',
    );
  }
  if (v === 'CDEK' || v === 'YANDEX' || v === 'OZON') return v;
  throw new BadRequestException(
    isYandexDeliveryEnabled()
      ? 'Укажите службу доставки (СДЭК, Яндекс Доставка или Ozon)'
      : 'Укажите службу доставки (СДЭК или Ozon)',
  );
}

function vspMetaValue(s: string, key: string): string {
  const m = s.match(new RegExp(`(?:^|\\|)${key}=([^|&]*)`, 'i'));
  let v = m?.[1] || '';
  if (v.endsWith('__')) v = v.slice(0, -2);
  try {
    v = decodeURIComponent(v);
  } catch {
    /* noop */
  }
  return v.trim();
}

function isOzonCourierComment(s: string): boolean {
  return /(?:^|\|)dropoff=courier(?:\||$|__)/i.test(s);
}

/**
 * ПВЗ по comment: только __VSP__/__JCOS__ с dropoff=pvz и кодом пункта.
 * Текст «СДЭК ПВЗ» / «Яндекс …ПВЗ» без мета — не free.
 */
export function isPvzShippingComment(comment?: string | null): boolean {
  const s = (comment ?? '').trim();
  if (!s) return false;

  const jcos = s.match(/__JCOS:carrier=(cdek|yandex)([^_]*)__/i);
  if (jcos) {
    const carrier = jcos[1].toLowerCase();
    const tail = jcos[2] || '';
    if (/(?:^|\|)dropoff=courier(?:\||$)/i.test(tail)) return false;
    if (/(?:^|\|)dropoff=pvz(?:\||$)/i.test(tail) || /(?:^|\|)pvz=/i.test(tail)) {
      const m = tail.match(/(?:^|\|)(?:cid|pvz)=([^|&]*)/i);
      let v = m?.[1] || '';
      if (v.endsWith('__')) v = v.slice(0, -2);
      try {
        v = decodeURIComponent(v);
      } catch {
        /* noop */
      }
      if (carrier === 'cdek') {
        const pvz = tail.match(/(?:^|\|)pvz=([^|&]*)/i);
        let p = pvz?.[1] || '';
        if (p.endsWith('__')) p = p.slice(0, -2);
        try {
          p = decodeURIComponent(p);
        } catch {
          /* noop */
        }
        return Boolean(p.trim());
      }
      return Boolean(v.trim());
    }
    return false;
  }

  if (/__VSP:carrier=yandex/i.test(s)) {
    if (/(?:^|\|)dropoff=courier(?:\||$|__)/i.test(s)) return false;
    const m = s.match(/(?:^|\|)(?:cid|pvz)=([^|&]*)/i);
    if (!m) return false;
    let v = m[1] || '';
    if (v.endsWith('__')) v = v.slice(0, -2);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* noop */
    }
    return Boolean(v.trim());
  }

  if (/__VSP:carrier=cdek/i.test(s)) {
    if (/(?:^|\|)dropoff=courier(?:\||$|__)/i.test(s)) return false;
    const m = s.match(/(?:^|\|)pvz=([^|&]*)/i);
    if (!m) return false;
    let v = m[1] || '';
    if (v.endsWith('__')) v = v.slice(0, -2);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* noop */
    }
    return Boolean(v.trim());
  }

  if (/__VSP:carrier=ozon/i.test(s)) {
    if (isOzonCourierComment(s)) return false;
    return Boolean(vspMetaValue(s, 'pvz'));
  }

  return false;
}

/** Comment должен соответствовать заявленному перевозчику. */
export function assertShippingCommentMatchesCarrier(
  comment: string | null | undefined,
  method: CheckoutCarrier,
): void {
  const s = (comment ?? '').trim();
  const hasYandex =
    /__VSP:carrier=yandex/i.test(s) ||
    /__JCOS:carrier=yandex/i.test(s) ||
    /Яндекс/i.test(s);
  const hasCdek =
    /__VSP:carrier=cdek/i.test(s) ||
    /__JCOS:carrier=cdek/i.test(s) ||
    /СДЭК/i.test(s);
  const metaCarrier = s.match(/__(?:VSP|JCOS):carrier=(\w+)/i)?.[1]?.toLowerCase();

  if (method === 'OZON') {
    if (metaCarrier !== 'ozon') {
      throw new BadRequestException(
        'Адрес доставки не соответствует Ozon. Выберите пункт выдачи или курьера Ozon.',
      );
    }
    return;
  }
  if (metaCarrier === 'ozon') {
    throw new BadRequestException(
      'Адрес доставки оформлен для Ozon. Выберите службу Ozon или другой адрес.',
    );
  }

  if (method === 'YANDEX' && !hasYandex) {
    throw new BadRequestException(
      'Адрес доставки не соответствует Яндекс Доставке. Выберите пункт или курьера.',
    );
  }
  if (method === 'CDEK' && !hasCdek) {
    throw new BadRequestException(
      'Адрес доставки не соответствует СДЭК. Выберите пункт или курьера.',
    );
  }
}

/** Для СДЭК ПВЗ обязателен код пункта (pvzCode или мета в comment). */
export function assertCdekPvzCodePresent(opts: {
  shippingMethod?: string | null;
  comment?: string | null;
  pvzCode?: string | null;
}): void {
  const method = (opts.shippingMethod ?? '').trim().toUpperCase();
  if (method !== 'CDEK') return;

  const s = (opts.comment ?? '').trim();
  const vspCdekPvz =
    /__VSP:carrier=cdek/i.test(s) &&
    !/(?:^|\|)dropoff=courier(?:\||$|__)/i.test(s);
  const jcosCdekPvz =
    /__JCOS:carrier=cdek/i.test(s) &&
    !/(?:^|\|)dropoff=courier(?:\||$)/i.test(s);
  const textCdekPvz = /СДЭК\s*ПВЗ/i.test(s);
  if (!vspCdekPvz && !jcosCdekPvz && !textCdekPvz) return;

  if ((opts.pvzCode ?? '').trim()) return;

  const m = s.match(/(?:^|\|)pvz=([^|&]*)/i);
  if (m) {
    let v = m[1] || '';
    if (v.endsWith('__')) v = v.slice(0, -2);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* noop */
    }
    if (v.trim()) return;
  }

  throw new BadRequestException(
    'Выберите пункт выдачи СДЭК — код ПВЗ обязателен для заказа',
  );
}

/** Ozon: ПВЗ без кода пункта не принимаем (курьер — без кода). */
export function assertOzonPvzCodePresent(opts: {
  shippingMethod?: string | null;
  comment?: string | null;
  pvzCode?: string | null;
}): void {
  const method = (opts.shippingMethod ?? '').trim().toUpperCase();
  if (method !== 'OZON') return;
  const s = (opts.comment ?? '').trim();
  if (isOzonCourierComment(s)) return;
  if ((opts.pvzCode ?? '').trim() || vspMetaValue(s, 'pvz')) return;
  throw new BadRequestException('Выберите пункт выдачи Ozon — код пункта обязателен для заказа');
}

/** Достаёт код ПВЗ из comment (__VSP__/__JCOS__) или явного поля. */
export function resolvePvzCode(
  comment?: string | null,
  pvzCode?: string | null,
): string {
  const fromField = (pvzCode ?? '').trim();
  if (fromField) return fromField;
  const s = (comment ?? '').trim();
  const m = s.match(/(?:^|\|)pvz=([^|&]*)/i);
  if (!m) return '';
  let v = m[1] || '';
  if (v.endsWith('__')) v = v.slice(0, -2);
  try {
    v = decodeURIComponent(v);
  } catch {
    /* noop */
  }
  return v.trim();
}

/**
 * Free PVZ: порог по **goodsSubtotal до промо/сертификата** (симметрия с Front
 * `qualifiesForFreePvzShipping`). Промокод не открывает бесплатную доставку —
 * quote подписывается по составу корзины до apply скидки.
 */
export function computeFreePvzShipping(opts: {
  shippingComment?: string | null;
  goodsSubtotal: number;
  freeShippingThresholdRub: number;
}): boolean {
  const threshold = Math.max(0, Math.floor(opts.freeShippingThresholdRub || 0));
  const subtotal = Math.max(0, Math.floor(opts.goodsSubtotal || 0));
  return (
    threshold > 0 &&
    subtotal >= threshold &&
    isPvzShippingComment(opts.shippingComment)
  );
}

/** Стоимость из signed quote + сверка с текущей корзиной/адресом. */
export function resolveShippingFromQuote(opts: {
  quote: ShippingQuotePayload;
  shippingMethod?: string | null;
  shippingAddress: {
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
  };
  lines: Array<{ variantId: string; shadeId?: string | null; qty: number }>;
  goodsSubtotal: number;
  freeShippingThresholdRub: number;
}): { cost: number; method: ShipmentProvider } {
  const method = requireCheckoutShipmentProvider(opts.shippingMethod);
  if (opts.quote.method !== method) {
    throw new BadRequestException(
      'Расчёт доставки не соответствует выбранной службе. Обновите расчёт.',
    );
  }
  assertShippingCommentMatchesCarrier(
    opts.shippingAddress.comment,
    method,
  );
  assertCdekPvzCodePresent({
    shippingMethod: method,
    comment: opts.shippingAddress.comment,
    pvzCode: opts.shippingAddress.pvzCode,
  });
  assertOzonPvzCodePresent({
    shippingMethod: method,
    comment: opts.shippingAddress.comment,
    pvzCode: opts.shippingAddress.pvzCode,
  });

  const addrHash = hashShippingAddress(opts.shippingAddress, method);
  if (addrHash !== opts.quote.addrHash) {
    throw new BadRequestException(
      'Адрес изменился после расчёта доставки. Обновите расчёт.',
    );
  }

  const linesHash = hashCartLines(opts.lines);
  if (linesHash !== opts.quote.linesHash) {
    throw new BadRequestException(
      'Состав корзины изменился после расчёта доставки. Обновите расчёт.',
    );
  }

  const freeNow = computeFreePvzShipping({
    shippingComment: opts.shippingAddress.comment,
    goodsSubtotal: opts.goodsSubtotal,
    freeShippingThresholdRub: opts.freeShippingThresholdRub,
  });

  // Если сейчас бесплатно по порогу — всегда 0 (даже если quote был платным до добора).
  if (freeNow) {
    return { cost: 0, method: method as ShipmentProvider };
  }

  // Quote обещал free, но порог больше не выполняется — нужен новый quote.
  if (opts.quote.freePvz || opts.quote.cost === 0) {
    throw new BadRequestException(
      'Бесплатная доставка больше не применяется. Обновите расчёт.',
    );
  }

  const cost = Math.floor(opts.quote.cost);
  if (cost < 1 || cost > MAX_SHIPPING_COST) {
    throw new BadRequestException('Некорректная стоимость доставки в расчёте');
  }

  return { cost, method: method as ShipmentProvider };
}

/**
 * Собрать cost для подписания quote (до HMAC).
 * Не-free: clientEstimate с BFF + serverEstimate с Nest (CDEK API).
 * Берём max(client, server) — HMAC не даёт занизить после quote, server закрывает занижение при выпуске.
 */
export function buildQuoteCost(opts: {
  shippingMethod?: string | null;
  shippingComment?: string | null;
  pvzCode?: string | null;
  goodsSubtotal: number;
  freeShippingThresholdRub: number;
  clientEstimate?: number | null;
  serverEstimate?: number | null;
  requireServerReprice?: boolean;
  /** Добавочная стоимость по перевозчикам (не входит в client/server estimate). */
  surcharges?: DeliverySurchargeRub;
}): { cost: number; method: CheckoutCarrier; freePvz: boolean } {
  const method = requireCheckoutShipmentProvider(opts.shippingMethod);
  assertShippingCommentMatchesCarrier(opts.shippingComment, method);
  assertCdekPvzCodePresent({
    shippingMethod: method,
    comment: opts.shippingComment,
    pvzCode: opts.pvzCode,
  });
  assertOzonPvzCodePresent({
    shippingMethod: method,
    comment: opts.shippingComment,
    pvzCode: opts.pvzCode,
  });

  const freePvz = computeFreePvzShipping({
    shippingComment: opts.shippingComment,
    goodsSubtotal: opts.goodsSubtotal,
    freeShippingThresholdRub: opts.freeShippingThresholdRub,
  });

  if (freePvz) {
    return { cost: 0, method, freePvz: true };
  }

  const client =
    opts.clientEstimate != null && Number.isFinite(opts.clientEstimate)
      ? Math.floor(opts.clientEstimate)
      : null;
  const server =
    opts.serverEstimate != null && Number.isFinite(opts.serverEstimate)
      ? Math.floor(opts.serverEstimate)
      : null;

  if (opts.requireServerReprice && server == null) {
    throw new BadRequestException(
      'Не удалось пересчитать доставку на сервере. Обновите расчёт и попробуйте снова.',
    );
  }

  let cost: number;
  if (server != null && client != null) {
    cost = Math.max(client, server);
  } else if (server != null) {
    cost = server;
  } else if (client != null) {
    cost = client;
  } else {
    throw new BadRequestException(
      'Не рассчитана стоимость доставки. Обновите расчёт и попробуйте снова.',
    );
  }

  const surcharge = surchargeRubForCheckoutCarrier(
    method,
    opts.surcharges ?? DELIVERY_SURCHARGE_DEFAULTS,
  );
  cost += surcharge;

  if (cost < 1) {
    throw new BadRequestException(
      'Стоимость доставки должна быть больше 0 ₽ (кроме бесплатной доставки до ПВЗ по порогу).',
    );
  }
  if (cost > MAX_SHIPPING_COST) {
    throw new BadRequestException('Слишком высокая стоимость доставки');
  }

  return { cost, method, freePvz: false };
}
