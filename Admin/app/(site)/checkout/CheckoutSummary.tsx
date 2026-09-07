'use client';

import { FloatingTextField } from '@/components/FloatingTextField/FloatingTextField';
import { CartOrderTotals } from '@/components/CartOrderTotals/CartOrderTotals';
import { formatRub } from '@/lib/publicCatalog';
import type { CartLine } from '@/lib/cart/CartContext';
import {
  GIFT_HOLD_RESERVED,
  GIFT_HOLD_WILL_RESERVE,
} from '@/lib/giftHoldCopy';
import styles from './CheckoutPage.module.css';

type Props = {
  items: CartLine[];
  catalogDiscount: number;
  discountAmount: number;
  listSubtotal: number;
  subtotal: number;
  total: number;
  promoCode?: string | null;
  promoKind?: 'promo' | 'gift' | null;
  promoInput: string;
  promoError?: string;
  promoBusy: boolean;
  hasPromo: boolean;
  disabled?: boolean;
  shippingCost?: number | null;
  /** goods + shipping — тот же, что CTA / create. */
  payableTotal?: number | null;
  onPromoInput: (value: string) => void;
  onApplyPromo: () => void;
  onClearPromo: () => void;
};

export function CheckoutSummary({
  items,
  catalogDiscount,
  discountAmount,
  listSubtotal,
  subtotal,
  total,
  promoCode,
  promoKind,
  promoInput,
  promoError,
  promoBusy,
  hasPromo,
  disabled,
  shippingCost = null,
  payableTotal = null,
  onPromoInput,
  onApplyPromo,
  onClearPromo,
}: Props) {
  return (
    <aside className={styles.summaryCol} aria-label="Ваш заказ">
      <div className={styles.summarySticky}>
        <ul className={styles.lines}>
          {items.map((l) => {
            const hasDisc = l.listPrice != null && l.listPrice > l.price;
            return (
              <li key={l.key} className={styles.line}>
                <div className={styles.thumb}>
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className={styles.thumbImg} />
                  ) : (
                    <span className={styles.thumbPh} aria-hidden />
                  )}
                  <span className={styles.qtyBadge}>{l.qty}</span>
                </div>
                <div className={styles.lineMeta}>
                  <p className={styles.lineName}>{l.name}</p>
                  <p className={styles.lineVariant}>
                    {[l.variantName, l.shadeName].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className={styles.linePriceCol}>
                  {hasDisc ? (
                    <span className={styles.lineListPrice}>
                      {formatRub(l.listPrice! * l.qty)}
                    </span>
                  ) : null}
                  <span className={styles.linePrice}>
                    {formatRub(l.price * l.qty)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <div className={styles.promoBlock}>
          <div className={styles.promoRow}>
            <FloatingTextField
              label="Промокод или сертификат"
              value={promoInput}
              onChange={(e) => onPromoInput(e.target.value)}
              error={promoError}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
            />
            {hasPromo ? (
              <button
                type="button"
                className={styles.promoBtn}
                onClick={onClearPromo}
                disabled={promoBusy || disabled}
              >
                Сбросить
              </button>
            ) : (
              <button
                type="button"
                className={styles.promoBtn}
                disabled={promoBusy || disabled}
                onClick={onApplyPromo}
              >
                {promoBusy ? '…' : 'Применить'}
              </button>
            )}
          </div>
          {promoKind === 'gift' && !disabled ? (
            <p className={styles.giftHoldNote} role="note">
              {GIFT_HOLD_WILL_RESERVE}
            </p>
          ) : null}
          {promoKind === 'gift' && disabled ? (
            <p className={styles.giftHoldNote} role="status">
              {GIFT_HOLD_RESERVED}
            </p>
          ) : null}
        </div>

        <div className={styles.totals}>
          <CartOrderTotals
            variant="checkout"
            catalogDiscount={catalogDiscount}
            promoDiscount={discountAmount}
            promoCode={promoCode}
            promoKind={promoKind ?? 'promo'}
            sumLabelAmount={listSubtotal > 0 ? listSubtotal : subtotal}
            total={total}
            shippingCost={shippingCost}
            payableTotal={payableTotal}
          />
        </div>
      </div>
    </aside>
  );
}
