/**
 * База для партнёрского %: товары после скидки, без доставки,
 * минус сертификат / реф. кошелёк и возвраты. Общая для YouRich leadSum и MF referral earn.
 *
 * Wallet/gift вычитаются целиком из goods (не пропорционально shipping).
 * Edge: wallet|gift > goods → earn base = 0 — ок.
 * Shipping-covered: часть credit могла уйти на доставку в order.total, но
 * commission base доставку не включает; «лишний» credit сверх goods просто
 * обнуляет базу (доставка не входит в leadSum/earn).
 */
export type CommissionBaseOrderInput = {
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount: number;
  /** Списание реф. кошелька (₽); XOR с gift — обычно 0 одновременно. */
  referralWalletAmount?: number;
  refundedAmount: number;
};

export function computeCommissionBase(order: CommissionBaseOrderInput): number {
  const goods = Math.max(
    0,
    Math.floor(order.subtotal) - Math.max(0, Math.floor(order.discountTotal)),
  );
  // Полный store credit из goods (не split на shipping): wallet>goods → 0.
  const storeCredit =
    Math.max(0, Math.floor(order.giftCertificateAmount)) +
    Math.max(0, Math.floor(order.referralWalletAmount ?? 0));
  const afterCredit = Math.max(0, goods - storeCredit);
  return Math.max(0, afterCredit - Math.max(0, Math.floor(order.refundedAmount)));
}
