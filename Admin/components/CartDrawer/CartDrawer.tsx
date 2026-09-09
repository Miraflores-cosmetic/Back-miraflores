'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PrimaryBtn } from '@/components/PrimaryBtn/PrimaryBtn';
import { formatRub } from '@/lib/publicCatalog';
import { productCartHref, useCart } from '@/lib/cart/CartContext';
import { CartOrderTotals } from '@/components/CartOrderTotals/CartOrderTotals';
import { FloatingTextField } from '@/components/FloatingTextField/FloatingTextField';
import { trapFocusKeydown } from '@/lib/focusTrap';
import { sanitizeProductHtml } from '@/lib/sanitizeProductHtml';
import { CART_SETTINGS_DEFAULTS, normalizeCartSettings } from '@/lib/cartSettings';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  GIFT_HOLD_APPLIED_TOAST,
  GIFT_HOLD_WILL_RESERVE,
} from '@/lib/giftHoldCopy';
import styles from './CartDrawer.module.css';

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M15 5L5 15M5 5l10 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function motionMs(full: number) {
  if (typeof window === 'undefined') return full;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : full;
}

export function CartDrawer() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    open,
    closeCart,
    items,
    subtotal,
    listSubtotal,
    catalogDiscount,
    discountAmount,
    total,
    promo,
    promoBusy,
    allowPromoCodes,
    applyPromo,
    clearPromo,
    setQty,
    removeItem,
    itemCount,
    returnFocusRef,
    syncCart,
    syncing,
  } = useCart();

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promoError, setPromoError] = useState<string | undefined>();
  const [progress, setProgress] = useState({
    threshold: CART_SETTINGS_DEFAULTS.freeShippingThresholdRub,
    contentText: CART_SETTINGS_DEFAULTS.progressContentText,
    successText: CART_SETTINGS_DEFAULTS.progressSuccessText,
    legalHtml: '',
  });
  const [legalOpen, setLegalOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const liveRef = useRef<HTMLParagraphElement | null>(null);
  const prevCountRef = useRef(itemCount);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/public/cart', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = normalizeCartSettings(await res.json());
        if (cancelled) return;
        setProgress({
          threshold: data.freeShippingThresholdRub,
          contentText: data.progressContentText,
          successText: data.progressSuccessText,
          legalHtml: data.legalHtml,
        });
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const progressBase = subtotal;
  const remainder = Math.max(0, progress.threshold - progressBase);
  const progressPercent =
    progress.threshold > 0
      ? Math.min(100, (progressBase / progress.threshold) * 100)
      : 0;
  const progressReached = remainder <= 0;

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setVisible(true);
      setClosing(false);
      return;
    }
    if (!visible) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setVisible(false);
      setClosing(false);
    }, motionMs(280));
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open, visible]);

  useEffect(() => {
    if (!open) {
      setPromoError(undefined);
      setPromoInput(promo?.code ?? '');
    } else {
      setPromoInput(promo?.code ?? '');
    }
  }, [open, promo?.code]);

  // Focus trap + restore to bag
  useEffect(() => {
    if (!open || closing) return;
    const panel = panelRef.current;
    if (!panel) return;

    const closeBtn = panel.querySelector<HTMLElement>(`.${styles.closeBtn}`);
    (closeBtn ?? panel).focus();

    const onKey = (e: KeyboardEvent) => {
      trapFocusKeydown(e, panel);
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, closing, returnFocusRef]);

  // aria-live: qty / empty
  useEffect(() => {
    if (!open || !liveRef.current) return;
    if (prevCountRef.current === itemCount) return;
    prevCountRef.current = itemCount;
    liveRef.current.textContent =
      itemCount === 0
        ? 'Корзина пуста'
        : `В корзине ${itemCount} ${itemCount === 1 ? 'товар' : itemCount < 5 ? 'товара' : 'товаров'}`;
  }, [itemCount, open]);

  if (!mounted || !visible) return null;

  const onApplyPromo = () => {
    void (async () => {
      const code = promoInput.trim();
      if (!code) {
        setPromoError('Введите промокод или сертификат');
        return;
      }
      const result = await applyPromo(code);
      if (!result.ok) {
        setPromoError(result.message);
        return;
      }
      setPromoError(undefined);
      if (result.kind === 'gift') {
        showToast(GIFT_HOLD_APPLIED_TOAST, 4000);
      }
    })();
  };

  return createPortal(
    <>
      <button
        type="button"
        className={[styles.backdrop, closing ? styles.backdropClosing : '']
          .filter(Boolean)
          .join(' ')}
        aria-label="Закрыть корзину"
        onClick={closeCart}
        tabIndex={-1}
      />
      <aside
        ref={panelRef}
        className={[styles.panel, closing ? styles.panelClosing : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <p ref={liveRef} className={styles.srOnly} aria-live="polite" aria-atomic="true" />
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Корзина{itemCount > 0 ? ` (${itemCount})` : ''}
          </h2>
          <button type="button" className={styles.closeBtn} onClick={closeCart} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </header>

        {items.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>Корзина пуста</p>
            <button type="button" className={styles.continueBtn} onClick={closeCart}>
              Продолжить покупки
            </button>
          </div>
        ) : (
          <>
            <div className={styles.progressBlock} aria-live="polite">
              <p className={styles.progressText}>
                {progressReached
                  ? progress.successText
                  : `${formatRub(remainder)} ${progress.contentText}`}
              </p>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            <ul className={styles.list} role="list">
              {items.map((line) => {
                const meta = [line.variantName, line.shadeName].filter(Boolean).join(' · ');
                const href = productCartHref(line.slug, line.variantId, line.shadeId);
                return (
                  <li key={line.key} className={styles.line}>
                    <Link href={href} className={styles.thumbLink} onClick={closeCart}>
                      {line.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={styles.thumb} src={line.imageUrl} alt="" />
                      ) : (
                        <span className={styles.thumbPlaceholder} aria-hidden />
                      )}
                    </Link>
                    <div className={styles.lineBody}>
                      <div className={styles.lineTop}>
                        <Link href={href} className={styles.lineName} onClick={closeCart}>
                          {line.name}
                        </Link>
                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() => removeItem(line.key)}
                          aria-label="Удалить"
                        >
                          ×
                        </button>
                      </div>
                      {meta ? <p className={styles.lineMeta}>{meta}</p> : null}
                      <div className={styles.lineBottom}>
                        <div className={styles.qtyStepper} aria-label="Количество">
                          <button
                            type="button"
                            className={styles.qtyBtn}
                            aria-label="Меньше"
                            onClick={() => setQty(line.key, line.qty - 1)}
                          >
                            −
                          </button>
                          <span className={styles.qtyValue}>{line.qty}</span>
                          <button
                            type="button"
                            className={styles.qtyBtn}
                            aria-label="Больше"
                            disabled={
                              line.maxQty != null && line.maxQty > 0
                                ? line.qty >= line.maxQty
                                : false
                            }
                            onClick={() => setQty(line.key, line.qty + 1)}
                          >
                            +
                          </button>
                        </div>
                        <div className={styles.linePrices}>
                          {line.listPrice != null && line.listPrice > line.price ? (
                            <span className={styles.listPrice}>
                              {formatRub(line.listPrice)}
                            </span>
                          ) : null}
                          <span className={styles.unitPrice}>{formatRub(line.price)}</span>
                          <span className={styles.linePrice}>
                            {formatRub(line.price * line.qty)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <footer className={styles.footer}>
              {!allowPromoCodes ? (
                <p className={styles.promoOk} role="note">
                  Промокоды недоступны для вашей группы. Сертификат — можно.
                </p>
              ) : null}
              <div className={styles.promoRow}>
                <FloatingTextField
                  label="Промокод или сертификат"
                  value={promoInput}
                  onChange={(e) => {
                    setPromoInput(e.target.value);
                    setPromoError(undefined);
                  }}
                  error={promoError}
                  autoComplete="off"
                  spellCheck={false}
                />
                {promo ? (
                  <button
                    type="button"
                    className={styles.promoApply}
                    onClick={() => {
                      clearPromo();
                      setPromoInput('');
                      setPromoError(undefined);
                    }}
                    disabled={promoBusy}
                  >
                    Сбросить
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.promoApply}
                    onClick={onApplyPromo}
                    disabled={promoBusy}
                  >
                    {promoBusy ? '…' : 'Применить'}
                  </button>
                )}
              </div>

              {promo?.kind === 'gift' ? (
                <p className={styles.giftHoldNote} role="note">
                  {GIFT_HOLD_WILL_RESERVE}
                </p>
              ) : null}

              {discountAmount > 0 || catalogDiscount > 0 ? (
                <CartOrderTotals
                  variant="drawer"
                  catalogDiscount={catalogDiscount}
                  promoDiscount={discountAmount}
                  promoCode={promo?.code}
                  promoKind={promo?.kind ?? 'promo'}
                  sumLabelAmount={
                    listSubtotal > 0 && catalogDiscount > 0 ? listSubtotal : subtotal
                  }
                  total={total}
                />
              ) : (
                <div className={styles.subtotalRow}>
                  <span>Итого</span>
                  <span>{formatRub(total)}</span>
                </div>
              )}
              {progress.legalHtml &&
              progress.legalHtml.replace(/<[^>]+>/g, '').trim() ? (
                <div className={styles.legalAccordion}>
                  <button
                    type="button"
                    className={styles.legalToggle}
                    aria-expanded={legalOpen}
                    onClick={() => setLegalOpen((v) => !v)}
                  >
                    <span>Информация о заказе</span>
                    <span className={legalOpen ? styles.legalChevronOpen : styles.legalChevron}>
                      ▾
                    </span>
                  </button>
                  {legalOpen ? (
                    <div
                      className={styles.legalBody}
                      dangerouslySetInnerHTML={{
                        __html: sanitizeProductHtml(progress.legalHtml),
                      }}
                    />
                  ) : null}
                </div>
              ) : (
                <p className={styles.note}>Доставка рассчитывается при оформлении</p>
              )}
              <PrimaryBtn
                type="button"
                disabled={syncing || itemCount === 0}
                onClick={() => {
                  void (async () => {
                    const result = await syncCart();
                    if (!result.ok || result.removed.length) return;
                    returnFocusRef.current = null;
                    closeCart();
                    router.push('/checkout');
                  })();
                }}
              >
                {syncing ? 'Обновляем…' : 'Оформить заказ'}
              </PrimaryBtn>
            </footer>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
}
