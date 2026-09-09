'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PrimaryBtn } from '@/components/PrimaryBtn/PrimaryBtn';
import { YooKassaWidget } from '@/components/YooKassaWidget/YooKassaWidget';
import { useYooKassaOrderPayment } from '@/lib/payments/useYooKassaOrderPayment';
import { formatRub } from '@/lib/publicCatalog';
import { readApiError } from '@/lib/readApiError';
import {
  orderStatusLabel,
  orderStatusBadgeClass,
} from '@/lib/orderStatusLabels';
import { formatAddressLine } from '@/lib/shipping/buyerAddressHelpers';
import {
  displayJcosAddressComment,
  getJcosDeliveryDisplayMode,
  parseJcosAddressMeta,
} from '@/lib/shipping/addressShippingMeta';
import type { BuyerOrderDetail } from './accountTypes';
import {
  GIFT_HOLD_ACCOUNT_UNPAID,
  GIFT_HOLD_RESERVED,
} from '@/lib/giftHoldCopy';
import styles from './AccountPage.module.css';

type Props = { orderId: string };

function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatShipping(
  a: NonNullable<BuyerOrderDetail['shippingAddress']>,
): string {
  return formatAddressLine(a);
}

function deliveryMethodLabel(comment: string | undefined | null): string | null {
  const { meta } = parseJcosAddressMeta(comment ?? '');
  if (!meta) return null;
  const { mode } = getJcosDeliveryDisplayMode(comment);
  const carrier = meta.carrier === 'yandex' ? 'Яндекс Доставка' : 'СДЭК';
  return `${carrier} · ${mode === 'pvz' ? 'ПВЗ' : 'Курьер'}`;
}

function trackingUrl(provider: string | null | undefined, tracking: string): string | null {
  const t = tracking.trim();
  if (!t) return null;
  const p = (provider || '').toUpperCase();
  if (p === 'CDEK') {
    return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(t)}`;
  }
  if (p === 'YANDEX') {
    return `https://dostavka.yandex.ru/tracking?code=${encodeURIComponent(t)}`;
  }
  return null;
}

export function AccountOrderDetailClient({ orderId }: Props) {
  const [order, setOrder] = useState<BuyerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/account/orders/${encodeURIComponent(orderId)}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) {
        setError(res.status === 404 ? 'Заказ не найден' : 'Не удалось загрузить');
        setOrder(null);
        return;
      }
      const data = (await res.json()) as BuyerOrderDetail;
      setOrder(data);
    } catch {
      setError('Сеть недоступна');
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  const payment = useYooKassaOrderPayment({
    persistSession: false,
    onPaid: () => {
      void load();
    },
    onError: (msg) => setError(msg),
  });

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelUnpaid() {
    if (!order?.canCancel) return;
    if (!window.confirm(`Отменить заказ ${order.number}?`)) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/account/orders/${encodeURIComponent(orderId)}/cancel`,
        { method: 'POST', credentials: 'same-origin' },
      );
      const data = (await res.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      if (!res.ok) {
        setError(readApiError(data, 'Не удалось отменить заказ'));
        return;
      }
      payment.resetPayment();
      await load();
    } catch {
      setError('Сеть недоступна');
    } finally {
      setCancelling(false);
    }
  }

  async function startPayment() {
    if (!order?.payToken) {
      setError('Оплата недоступна для этого заказа');
      return;
    }
    setError(null);
    await payment.startPay(order.id, order.payToken);
  }

  if (loading) {
    return <p className={styles.loading}>Загрузка заказа…</p>;
  }

  if (error && !order) {
    return (
      <>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <Link href="/account/orders" className={styles.backLink}>
          К заказам
        </Link>
      </>
    );
  }

  if (!order) return null;

  const busy = payment.busy;
  const paid = payment.paid;
  const confirmationToken = payment.confirmationToken;
  const paymentId = payment.paymentId;
  const payToken = payment.payToken || order.payToken;
  const checkPaid = payment.checkPaid;

  const canPay =
    !paid &&
    (order.status === 'AWAITING_PAYMENT' || order.status === 'NEW') &&
    Boolean(order.payToken);
  const showWidget = payment.showWidget;
  const payExpiresLabel = order.payExpiresAt
    ? formatOrderDate(order.payExpiresAt)
    : null;

  const shipment = order.shipments?.[0];
  const tracking = shipment?.tracking?.trim() || '';
  const trackHref = tracking
    ? trackingUrl(shipment?.provider, tracking)
    : null;
  const shippingUserComment = order.shippingAddress
    ? displayJcosAddressComment(order.shippingAddress.comment)
    : '';
  const shippingMethod = order.shippingAddress
    ? deliveryMethodLabel(order.shippingAddress.comment)
    : null;

  return (
    <div className={styles.orderDetail}>
      <Link href="/account/orders" className={styles.backLink}>
        ← К заказам
      </Link>

      <div className={styles.orderHead}>
        <div>
          <p className={styles.orderDate}>{formatOrderDate(order.createdAt)}</p>
          <p className={styles.orderNumber}>{order.number}</p>
          {tracking ? (
            <p className={styles.orderTracking}>Трек {tracking}</p>
          ) : null}
        </div>
        <div className={styles.orderHeadRight}>
          <span
            className={`${styles.badge} ${orderStatusBadgeClass(order.status, styles)}`}
          >
            {orderStatusLabel(order.status)}
          </span>
        </div>
      </div>

      {tracking ? (
        <div className={styles.orderTrackingBlock}>
          <p className={styles.orderTrackingLabel}>Трек-номер</p>
          <p className={styles.orderTrackingValue}>
            {trackHref ? (
              <a
                className={styles.orderTrackingLink}
                href={trackHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tracking}
              </a>
            ) : (
              tracking
            )}
          </p>
          {shipment?.provider ? (
            <p className={styles.orderTrackingProvider}>
              {shipment.provider}
            </p>
          ) : null}
        </div>
      ) : null}

      {canPay && payExpiresLabel ? (
        <p className={styles.orderMetaComment}>
          Оплатите до {payExpiresLabel}, иначе заказ будет отменён автоматически.
        </p>
      ) : null}

      {canPay && (order.giftCertificateAmount ?? 0) > 0 ? (
        <p className={styles.orderMetaComment} role="status">
          {GIFT_HOLD_ACCOUNT_UNPAID}
          {order.giftCertificateCode
            ? ` Код: ${order.giftCertificateCode}.`
            : ''}
        </p>
      ) : null}

      {(order.refundedAmount ?? 0) > 0 ? (
        <p className={styles.orderMetaComment}>
          Возвращено: {formatRub(order.refundedAmount ?? 0)}
        </p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <ul className={styles.itemList}>
        {order.items.map((item) => (
          <li key={item.id} className={styles.itemCard}>
            <div className={styles.itemThumb}>
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.itemThumbImg}
                  src={item.imageUrl}
                  alt=""
                />
              ) : null}
            </div>
            <div className={styles.itemInfo}>
              <p className={styles.itemTitle}>{item.title}</p>
              <p className={styles.itemSub}>
                {[item.subtitle, item.qty > 1 ? `× ${item.qty}` : null]
                  .filter(Boolean)
                  .join(' · ') || item.sku}
              </p>
            </div>
            <p className={styles.itemPrice}>{formatRub(item.lineTotal)}</p>
          </li>
        ))}
      </ul>

      <dl className={styles.orderMeta}>
        {order.shippingAddress ? (
          <div className={styles.orderMetaRow}>
            <dt>Доставка</dt>
            <dd>
              {shippingMethod ? (
                <>
                  {shippingMethod}
                  <br />
                </>
              ) : null}
              {formatShipping(order.shippingAddress)}
              {shippingUserComment ? (
                <span className={styles.orderMetaComment}>
                  {shippingUserComment}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {order.customerName ? (
          <div className={styles.orderMetaRow}>
            <dt>Получатель</dt>
            <dd>
              {order.customerName}
              {order.phone ? ` · ${order.phone}` : ''}
            </dd>
          </div>
        ) : null}
        {order.pricingGroup?.name ? (
          <div className={styles.orderMetaRow}>
            <dt>Группа цен</dt>
            <dd>{order.pricingGroup.name}</dd>
          </div>
        ) : null}
        <div className={styles.orderMetaRow}>
          <dt>Сумма товаров</dt>
          <dd>{formatRub(order.subtotal)}</dd>
        </div>
        {order.discountTotal > 0 ? (
          <div className={styles.orderMetaRow}>
            <dt>Скидка{order.promoCode ? ` (${order.promoCode})` : ''}</dt>
            <dd>−{formatRub(order.discountTotal)}</dd>
          </div>
        ) : null}
        {(order.giftCertificateAmount ?? 0) > 0 ? (
          <div className={styles.orderMetaRow}>
            <dt>
              Сертификат
              {order.giftCertificateCode ? ` (${order.giftCertificateCode})` : ''}
            </dt>
            <dd>−{formatRub(order.giftCertificateAmount ?? 0)}</dd>
          </div>
        ) : null}
        {order.shippingCost > 0 ? (
          <div className={styles.orderMetaRow}>
            <dt>Доставка</dt>
            <dd>{formatRub(order.shippingCost)}</dd>
          </div>
        ) : null}
        <div className={[styles.orderMetaRow, styles.orderMetaTotal].join(' ')}>
          <dt>Итого</dt>
          <dd>{formatRub(order.total)}</dd>
        </div>
      </dl>

      {canPay || showWidget ? (
        <section className={styles.orderPay} aria-labelledby="order-pay-heading">
          <h2 id="order-pay-heading" className={styles.sectionTitle}>
            Оплата
          </h2>
          {showWidget ? (
            <>
              <p className={styles.sectionHint}>
                Оплатите заказ {order.number} через ЮKassa.
              </p>
              {(order.giftCertificateAmount ?? 0) > 0 ? (
                <p className={styles.sectionHint} role="status">
                  {GIFT_HOLD_RESERVED}
                </p>
              ) : null}
              <YooKassaWidget
                confirmationToken={confirmationToken!}
                paymentId={paymentId}
                payToken={payToken}
                onSuccess={() => void checkPaid()}
                onError={() =>
                  setError('Ошибка оплаты. Попробуйте ещё раз.')
                }
              />
              <button
                type="button"
                className={styles.textBtn}
                onClick={() => void checkPaid()}
              >
                Оплата прошла? Проверить статус
              </button>
            </>
          ) : (
            <div className={styles.orderPaySticky}>
              <PrimaryBtn
                type="button"
                className={styles.orderPayCta}
                disabled={busy}
                onClick={() => void startPayment()}
              >
                {busy ? 'Создаём платёж…' : `Оплатить ${formatRub(order.total)}`}
              </PrimaryBtn>
              {order.canCancel ? (
                <button
                  type="button"
                  className={styles.textBtn}
                  disabled={cancelling || busy}
                  onClick={() => void cancelUnpaid()}
                >
                  {cancelling ? 'Отменяем…' : 'Отменить заказ'}
                </button>
              ) : null}
            </div>
          )}
        </section>
      ) : order.canCancel ? (
        <button
          type="button"
          className={styles.textBtn}
          disabled={cancelling}
          onClick={() => void cancelUnpaid()}
        >
          {cancelling ? 'Отменяем…' : 'Отменить заказ'}
        </button>
      ) : null}
    </div>
  );
}
