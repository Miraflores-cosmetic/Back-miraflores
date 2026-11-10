/**
 * База для партнёрского %: товары после скидки, без доставки,
 * минус сертификат / реф. кошелёк и возвраты. Общая для YouRich leadSum и MF referral earn.
 *
 * Wallet/gift — store credit из goods (не пропорционально shipping).
 * Card-refund (`refundedAmount`) режет только card-covered остаток после credit —
 * иначе wallet+refund на одном заказе дают двойное уменьшение базы.
 * Edge: wallet|gift > goods → earn base = 0 — ок.
 * Shipping-covered: «лишний» credit сверх goods обнуляет базу (доставка не в leadSum/earn).
 *
 * При частичном refund `orders-admin` RELEASE-ит долю wallet и уменьшает
 * `referralWalletAmount`, но пишет `referralWalletReleasedAmount` — иначе
 * вернувшийся credit снова попадает в base.
 */
export type CommissionBaseOrderInput = {
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount: number;
  /** Оставшийся (ещё не RELEASE) wallet на заказе; XOR с gift — обычно 0 одновременно. */
  referralWalletAmount?: number;
  /** Уже возвращённый wallet (Σ RELEASE при refund). */
  referralWalletReleasedAmount?: number;
  /** Сумма card-refund (₽). Не включает уже возвращённый wallet. */
  refundedAmount: number;
};

export function computeCommissionBase(order: CommissionBaseOrderInput): number {
  const goods = Math.max(
    0,
    Math.floor(order.subtotal) - Math.max(0, Math.floor(order.discountTotal)),
  );
  const gift = Math.max(0, Math.floor(order.giftCertificateAmount));
  const walletRemaining = Math.max(0, Math.floor(order.referralWalletAmount ?? 0));
  const walletReleased = Math.max(
    0,
    Math.floor(order.referralWalletReleasedAmount ?? 0),
  );
  // Исходный store credit: remaining + released (не раздувать base после RELEASE).
  const wallet = walletRemaining + walletReleased;
  const refunded = Math.max(0, Math.floor(order.refundedAmount));

  const afterGift = Math.max(0, goods - gift);
  const walletEff = Math.min(wallet, afterGift);
  // Card-covered slice: refund не может «съесть» ещё и wallet-часть.
  const cardCovered = afterGift - walletEff;
  const refundEff = Math.min(refunded, cardCovered);
  return Math.max(0, cardCovered - refundEff);
}
