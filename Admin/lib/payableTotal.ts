/**
 * Единый итог к оплате.
 * promo/нет: goodsAfterPromo + shipping.
 * gift: max(0, goodsSubtotal + shipping − giftAmount) — сертификат гасит и доставку.
 * null — доставка ещё не готова (кроме gift-only digital, shippingCost=0).
 */
export function calcPayableTotal(opts: {
  goodsSubtotal: number;
  goodsAfterPromo?: number;
  shippingCost: number | null | undefined;
  voucherKind?: 'promo' | 'gift' | null;
  giftAmount?: number;
}): number | null {
  const goods = Math.max(0, Math.floor(opts.goodsSubtotal || 0));
  if (opts.shippingCost == null || !Number.isFinite(opts.shippingCost)) {
    return null;
  }
  const shipping = Math.max(0, Math.floor(opts.shippingCost));
  if (opts.voucherKind === 'gift') {
    const gift = Math.max(0, Math.floor(opts.giftAmount || 0));
    return Math.max(0, goods + shipping - gift);
  }
  const afterPromo = Math.max(
    0,
    Math.floor(opts.goodsAfterPromo ?? goods),
  );
  return afterPromo + shipping;
}
