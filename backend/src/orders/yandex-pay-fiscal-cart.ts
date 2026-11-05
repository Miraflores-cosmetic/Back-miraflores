import type { YandexPayCartItem } from './yandex-pay.service';

export type FiscalCartOrderLine = {
  id: string;
  variantId?: string | null;
  sku?: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  isGratitudeGift?: boolean | null;
};

export type FiscalCartOrder = {
  number: string;
  total: number;
  shippingCost?: number | null;
  giftPurchaseDenominationId?: string | null;
  items: FiscalCartOrderLine[];
};

/**
 * Позиции корзины Яндекс Пэй под 54-ФЗ: sum(totalRub) === order.total.
 *
 * - Подарки благодарности (0 ₽) не в чек.
 * - Промо/сертификат: пропорционально сжимаем товары.
 * - Доставка отдельной строкой, если shippingCost > 0 и после gift остаётся
 *   place (shippingCost < total); иначе shipping «впитан» в товары (как ЮKassa).
 */
export function buildYandexPayFiscalCart(
  order: FiscalCartOrder,
): YandexPayCartItem[] {
  const target = Math.max(0, Math.round(Number(order.total) || 0));
  if (target <= 0) return [];

  const lines = order.items
    .filter((i) => !i.isGratitudeGift && i.unitPrice > 0 && i.qty > 0)
    .map((i) => ({
      productId: String(i.variantId || i.sku || i.id).slice(0, 128),
      title: (i.title || 'Товар').slice(0, 128),
      quantity: i.qty,
      totalRub: Math.round(i.unitPrice) * i.qty,
    }));

  if (!lines.length) {
    return [
      {
        productId: order.giftPurchaseDenominationId ? 'gift-cert' : 'order',
        title: order.giftPurchaseDenominationId
          ? `Сертификат ${order.number}`.slice(0, 128)
          : `Заказ ${order.number}`.slice(0, 128),
        quantity: 1,
        totalRub: target,
      },
    ];
  }

  const shippingCost = Math.max(0, Math.round(Number(order.shippingCost) || 0));

  // Отдельная доставка только если на товары остаётся ≥ 1 ₽.
  if (shippingCost > 0 && shippingCost < target) {
    const goodsTarget = target - shippingCost;
    const goods = scaleLineTotalsTo(lines, goodsTarget);
    return [
      ...goods,
      {
        productId: 'shipping',
        title: 'Доставка',
        quantity: 1,
        totalRub: shippingCost,
      },
    ];
  }

  // shippingCost === 0 или gift «съел» доставку — сжимаем только товары к total.
  return scaleLineTotalsTo(lines, target);
}

/** Пропорционально к target; последняя позиция забирает остаток (копейки). */
export function scaleLineTotalsTo(
  lines: YandexPayCartItem[],
  target: number,
): YandexPayCartItem[] {
  const goal = Math.max(0, Math.round(target));
  if (!lines.length) return [];
  if (goal <= 0) return [];

  const sum = lines.reduce((s, i) => s + i.totalRub, 0);
  if (sum <= 0) {
    return [
      {
        ...lines[0],
        quantity: 1,
        totalRub: goal,
      },
    ];
  }
  if (sum === goal) return lines.map((l) => ({ ...l }));

  const ratio = goal / sum;
  let running = 0;
  const out: YandexPayCartItem[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const isLast = idx === lines.length - 1;
    let totalRub: number;
    if (isLast) {
      totalRub = Math.max(0, goal - running);
    } else {
      totalRub = Math.max(0, Math.round(line.totalRub * ratio));
      running += totalRub;
    }
    if (totalRub > 0) {
      out.push({ ...line, totalRub });
    }
  }

  if (!out.length) {
    return [
      {
        ...lines[0],
        quantity: 1,
        totalRub: goal,
      },
    ];
  }

  // Если промежуточные округления съели всё до last=0 и last отфильтрован —
  // добить последнюю позицию до goal.
  const got = out.reduce((s, i) => s + i.totalRub, 0);
  if (got !== goal) {
    const last = out[out.length - 1];
    last.totalRub = Math.max(0, last.totalRub + (goal - got));
  }
  return out.filter((i) => i.totalRub > 0);
}
