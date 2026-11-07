/** Чистая логика «Изменить состав» — unit-тесты без модалки. */

export const PCT_PRESETS = [5, 10, 15, 20] as const;

export type DraftOrderLineLike = {
  key: string;
  variantId: string | null;
  shadeId: string | null;
  title: string;
  sku: string;
  qty: number;
  unitPrice: number;
  originalUnitPrice: number;
  isGratitudeGift?: boolean;
};

export type OrderItemsSavePayload = {
  items: Array<{
    variantId: string | null;
    shadeId?: string | null;
    qty: number;
    unitPrice: number;
    title: string;
    sku: string;
    isGratitudeGift?: boolean;
  }>;
  notifyCustomer: boolean;
};

export function priceAfterPercentOff(base: number, pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  return Math.max(0, Math.round(base * (1 - p / 100)));
}

export function matchingPresetPct(
  original: number,
  current: number,
): number | null {
  for (const p of PCT_PRESETS) {
    if (priceAfterPercentOff(original, p) === current) return p;
  }
  return null;
}

/** Зеркало бэкенд-clamp промо/gift/wallet при правке состава. */
export function estimateAfterItemsEdit(opts: {
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount: number;
  referralWalletAmount?: number;
  shippingCost: number;
  netPaid: number;
}) {
  const discount = Math.min(
    Math.max(0, Math.round(opts.discountTotal)),
    Math.max(0, Math.round(opts.subtotal)),
  );
  const shipping = Math.max(0, Math.round(opts.shippingCost));
  const payableAfterDiscount = Math.max(0, opts.subtotal - discount + shipping);
  const gift = Math.min(
    Math.max(0, Math.round(opts.giftCertificateAmount)),
    payableAfterDiscount,
  );
  const wallet = Math.min(
    Math.max(0, Math.round(opts.referralWalletAmount ?? 0)),
    Math.max(0, payableAfterDiscount - gift),
  );
  const total = Math.max(
    0,
    opts.subtotal - discount - gift - wallet + shipping,
  );
  const netPaid = Math.max(0, Math.round(opts.netPaid));
  return {
    discount,
    gift,
    wallet,
    shipping,
    total,
    balanceDue: Math.max(0, total - netPaid),
    refundSuggested: Math.max(0, netPaid - total),
    discountClamped: discount < Math.max(0, opts.discountTotal),
    giftClamped: gift < Math.max(0, opts.giftCertificateAmount),
    walletClamped: wallet < Math.max(0, opts.referralWalletAmount ?? 0),
  };
}

export function applyPercentOffLines<T extends DraftOrderLineLike>(
  lines: T[],
  pct: number,
  onlyKey?: string,
): T[] {
  if (!(pct > 0)) return lines;
  return lines.map((l) => {
    if (l.isGratitudeGift) return l;
    if (onlyKey != null && l.key !== onlyKey) return l;
    return {
      ...l,
      unitPrice: priceAfterPercentOff(l.originalUnitPrice, pct),
    };
  });
}

export function buildItemsSavePayload(
  lines: DraftOrderLineLike[],
  notifyCustomer: boolean,
): OrderItemsSavePayload {
  return {
    items: lines.map((l) => ({
      variantId: l.variantId,
      shadeId: l.shadeId,
      qty: Math.max(1, Math.round(l.qty) || 1),
      unitPrice: l.isGratitudeGift
        ? 0
        : Math.max(0, Math.round(l.unitPrice) || 0),
      title: l.title,
      sku: l.sku,
      isGratitudeGift: l.isGratitudeGift,
    })),
    notifyCustomer,
  };
}
