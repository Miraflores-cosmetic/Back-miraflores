'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdminCompactBtn,
  AdminCompactBtnLink,
} from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminSelect, AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime, formatAdminMoney } from '@/lib/adminFormat';
import type { AdminOrderDetail } from '@/lib/adminOrderTypes';
import {
  orderStatusLabel,
  orderStatusBadgeClass,
  orderEventTypeLabel,
  paymentStatusLabel,
  paymentStatusBadgeClass,
} from '@/lib/orderStatusLabels';
import { parseJcosAddressMeta } from '@/lib/shipping/addressShippingMeta';
import { GIFT_PARTIAL_REFUND_POLICY } from '@/lib/giftHoldCopy';
import { OrderAccordion, OrderIconBtn } from './OrderAccordion';
import { OrderAddressEditModal } from './OrderAddressEditModal';
import { OrderItemsEditModal } from './OrderItemsEditModal';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from './orders.module.css';

const styles = { ...catalogStyles, ...orderStyles };

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
} | null;

function formatShippingAddress(
  a: NonNullable<AdminOrderDetail['shippingAddress']>,
): string {
  return [
    a.region,
    a.city,
    a.district,
    a.address,
    a.apartment ? `кв./оф. ${a.apartment}` : null,
    a.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}

function carrierLabel(carrier?: string | null): string {
  if (carrier === 'cdek') return 'СДЭК';
  if (carrier === 'yandex') return 'Яндекс Доставка';
  return carrier || '';
}

function dropoffLabel(dropoff?: string | null): string {
  if (dropoff === 'pvz') return 'ПВЗ';
  if (dropoff === 'courier') return 'Курьер';
  return '';
}

function shipProviderFromMeta(carrier?: string | null): string {
  if (carrier === 'yandex') return 'YANDEX';
  if (carrier === 'cdek') return 'CDEK';
  return 'CDEK';
}

function trackingUrl(provider: string, tracking: string): string | null {
  const t = tracking.trim();
  if (!t) return null;
  const p = provider.toUpperCase();
  if (p === 'CDEK') {
    return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(t)}`;
  }
  if (p === 'YANDEX') {
    return `https://dostavka.yandex.ru/tracking?code=${encodeURIComponent(t)}`;
  }
  return null;
}

const HISTORY_PREVIEW = 5;
const SOFT_POLL_FAIL_BANNER_AFTER = 3;

export function OrderDetailClient({
  orderId,
  canOrdersFinance = false,
}: {
  orderId: string;
  canOrdersFinance?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [tracking, setTracking] = useState('');
  const [shipProvider, setShipProvider] = useState('CDEK');
  const [shipPrefillDone, setShipPrefillDone] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [providerRefund, setProviderRefund] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [itemsModalOpen, setItemsModalOpen] = useState(false);
  const [surchargeUrl, setSurchargeUrl] = useState<string | null>(null);
  const [openClient, setOpenClient] = useState(true);
  const [openDelivery, setOpenDelivery] = useState(true);
  const [openItems, setOpenItems] = useState(true);
  const [openRefund, setOpenRefund] = useState(false);
  const [openNote, setOpenNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [softPollStale, setSoftPollStale] = useState(false);
  const softPollFailsRef = useRef(0);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2800);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const row = await adminBackendJson<AdminOrderDetail>(
        `orders/admin/${orderId}`,
      );
      setOrder(row);
      if (row.refundRemaining > 0) {
        setRefundAmount(String(row.refundRemaining));
      } else if (
        (row.giftCertificateAmount ?? 0) > 0 ||
        row.giftPurchaseDenominationId
      ) {
        setRefundAmount('0');
      }
      softPollFailsRef.current = 0;
      setSoftPollStale(false);
    } catch (e) {
      setOrder(null);
      setError(
        e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки',
      );
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  const softLoad = useCallback(async () => {
    try {
      const row = await adminBackendJson<AdminOrderDetail>(
        `orders/admin/${orderId}`,
      );
      setOrder(row);
      if (row.refundRemaining > 0) {
        setRefundAmount(String(row.refundRemaining));
      } else if (
        (row.giftCertificateAmount ?? 0) > 0 ||
        row.giftPurchaseDenominationId
      ) {
        setRefundAmount('0');
      }
      softPollFailsRef.current = 0;
      setSoftPollStale(false);
    } catch {
      softPollFailsRef.current += 1;
      if (softPollFailsRef.current >= SOFT_POLL_FAIL_BANNER_AFTER) {
        setSoftPollStale(true);
      }
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Soft-poll + refetch on focus, пока ждём оплату. */
  useEffect(() => {
    const awaiting =
      order?.status === 'AWAITING_PAYMENT' || order?.status === 'NEW';
    if (!awaiting) return;

    const onFocus = () => void softLoad();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void softLoad();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => void softLoad(), 8000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [order?.status, softLoad]);

  const shippingMeta = useMemo(() => {
    const comment = order?.shippingAddress?.comment ?? '';
    return parseJcosAddressMeta(comment);
  }, [order?.shippingAddress?.comment]);

  useEffect(() => {
    if (!order || shipPrefillDone) return;
    const fromOrder = (order.shippingMethod || '').toUpperCase();
    if (fromOrder === 'CDEK' || fromOrder === 'YANDEX' || fromOrder === 'PICKUP') {
      setShipProvider(fromOrder);
    } else {
      setShipProvider(shipProviderFromMeta(shippingMeta.meta?.carrier));
    }
    const shipTrack = order.shipments?.[0]?.tracking?.trim();
    if (shipTrack) setTracking(shipTrack);
    setShipPrefillDone(true);
  }, [order, shippingMeta.meta?.carrier, shipPrefillDone]);

  useEffect(() => {
    const t = order?.shipments?.[0]?.tracking?.trim();
    if (t) setTracking(t);
  }, [order?.shipments?.[0]?.tracking]);

  async function runAction(
    path: string,
    body: Record<string, unknown> | undefined,
    successMsg: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      const row = await adminBackendJson<AdminOrderDetail>(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      if (row.items && row.actions) {
        setOrder(row);
        if (row.refundRemaining > 0) {
          setRefundAmount(String(row.refundRemaining));
        } else if (
          (row.giftCertificateAmount ?? 0) > 0 ||
          row.giftPurchaseDenominationId
        ) {
          setRefundAmount('0');
        }
      } else {
        await load();
      }
      showFlash(successMsg);
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось выполнить',
      );
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  function askConfirm(next: ConfirmState) {
    setConfirm(next);
  }

  type EditResult = AdminOrderDetail & {
    previousTotal?: number;
    newTotal?: number;
    balanceDue?: number;
    refundSuggested?: number;
    surcharge?: { amount: number; confirmationUrl: string; paymentId: string };
  };

  function offerSettleDelta(row: EditResult) {
    const due = row.balanceDue ?? 0;
    const refundSug = row.refundSuggested ?? 0;
    if (due > 0 && row.actions?.canCreateSurcharge) {
      askConfirm({
        title: 'Доплата',
        message: `Сумма заказа выросла. Выставить клиенту ссылку на доплату ${formatAdminMoney(due)}? Письмо уйдёт автоматически.`,
        confirmLabel: 'Выставить доплату',
        run: async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await adminBackendJson<EditResult>(
              `orders/admin/${orderId}/surcharge-payment`,
              {
                method: 'POST',
                body: JSON.stringify({ amount: due }),
              },
            );
            if (res.items && res.actions) setOrder(res);
            else await load();
            if (res.surcharge?.confirmationUrl) {
              setSurchargeUrl(res.surcharge.confirmationUrl);
            }
            showFlash('Ссылка на доплату создана, письмо отправлено');
          } catch (e) {
            setError(
              e instanceof AdminBackendRequestError
                ? e.message
                : 'Не удалось создать доплату',
            );
          } finally {
            setBusy(false);
            setConfirm(null);
          }
        },
      });
      return;
    }
    if (refundSug > 0 && canOrdersFinance && row.actions?.canRefund) {
      const giftBlocksPartial =
        (row.giftCertificateAmount ?? 0) > 0 ||
        Boolean(row.giftPurchaseDenominationId);
      if (giftBlocksPartial && refundSug < (row.refundRemaining ?? 0)) {
        setError(
          `${GIFT_PARTIAL_REFUND_POLICY} Переплата ${formatAdminMoney(refundSug)} — оформите полный возврат вручную в блоке «Возврат».`,
        );
        return;
      }
      askConfirm({
        title: 'Возврат',
        message: `Сумма заказа уменьшилась. Оформить возврат ${formatAdminMoney(refundSug)} через ЮKassa?`,
        confirmLabel: 'Вернуть',
        danger: true,
        run: async () => {
          await runAction(
            `orders/admin/${orderId}/refund`,
            {
              amount: refundSug,
              reason: 'Корректировка состава/адреса заказа',
              providerRefund: true,
            },
            'Возврат оформлен',
          );
        },
      });
    }
  }

  async function saveAddress(payload: {
    address: NonNullable<AdminOrderDetail['shippingAddress']>;
    shippingCost: number;
    shippingMethod?: string;
    notifyCustomer: boolean;
  }) {
    setBusy(true);
    setError(null);
    try {
      const row = await adminBackendJson<EditResult>(
        `orders/admin/${orderId}/shipping-address`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            ...payload.address,
            shippingCost: payload.shippingCost,
            shippingMethod: payload.shippingMethod,
            notifyCustomer: payload.notifyCustomer,
          }),
        },
      );
      setOrder(row);
      setAddressModalOpen(false);
      showFlash('Адрес обновлён');
      offerSettleDelta(row);
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError
          ? e.message
          : 'Ошибка сохранения адреса',
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveItems(payload: {
    items: Array<{
      variantId: string | null;
      qty: number;
      unitPrice: number;
      title: string;
      sku: string;
      isGratitudeGift?: boolean;
    }>;
    notifyCustomer: boolean;
  }) {
    setBusy(true);
    setError(null);
    try {
      const row = await adminBackendJson<EditResult>(
        `orders/admin/${orderId}/items`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      );
      setOrder(row);
      setItemsModalOpen(false);
      showFlash('Состав обновлён');
      offerSettleDelta(row);
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError
          ? e.message
          : 'Ошибка сохранения состава',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyOrderNumber(number: string) {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  if (loading && !order) {
    return <p className={styles.muted}>Загрузка заказа…</p>;
  }

  if (error && !order) {
    return (
      <>
        <p className={styles.backRow}>
          <AdminCompactBtnLink href="/admin/orders" variant="outline">
            ← К списку
          </AdminCompactBtnLink>
        </p>
        <p className={styles.error} role="alert">
          {error}
        </p>
      </>
    );
  }

  if (!order) return null;

  const a = order.actions ?? {
    canCancel: order.canCancel,
    canMarkPaid: false,
    canStartPacking: false,
    canShip: false,
    canSendTracking: false,
    canDeliver: false,
    canRefund: false,
  };

  const canMarkPaid = a.canMarkPaid && canOrdersFinance;
  const canRefund = a.canRefund && canOrdersFinance;
  const canSendTracking = Boolean(a.canSendTracking);
  const carrierAlreadyCreated = Boolean(
    order.shipments?.some(
      (s) =>
        Boolean(s.externalId) ||
        s.status === 'registered' ||
        s.status === 'registering' ||
        s.status === 'shipped',
    ),
  );

  const primaryActions =
    canMarkPaid || a.canStartPacking || a.canDeliver || a.canCancel;
  const hasAsideActions =
    primaryActions || a.canShip || canSendTracking || canRefund;
  const stockNotRestoredOnRefund =
    canRefund &&
    (order.status === 'SHIPPED' || order.status === 'DELIVERED');

  const methodHint = [
    order.shippingMethod,
    shippingMeta.meta
      ? [
          carrierLabel(shippingMeta.meta.carrier),
          dropoffLabel(shippingMeta.meta.dropoff),
        ]
          .filter(Boolean)
          .join(' · ')
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const events = order.events ?? [];
  const supportNotes = events.filter((e) => e.type === 'NOTE');
  const visibleEvents = historyOpen ? events : events.slice(0, HISTORY_PREVIEW);

  return (
    <>
      <div className={styles.orderNoPrint}>
      <p className={styles.backRow}>
        <AdminCompactBtnLink href="/admin/orders" variant="outline">
          ← К списку
        </AdminCompactBtnLink>
      </p>

      <div className={styles.detailTitleRow}>
        <div>
          <h1 className={styles.title}>
            Заказ {order.number}
            {order.giftPurchaseDenominationId ? (
              <span className={styles.badgeCert} title="Покупка подарочного сертификата">
                Сертификат
              </span>
            ) : null}
            <button
              type="button"
              className={styles.orderCopyBtn}
              onClick={() => void copyOrderNumber(order.number)}
            >
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </h1>
          <div className={styles.orderTitleMeta}>
            <span className={styles.orderTitleMetaText}>
              {formatAdminDateTime(order.createdAt)}
            </span>
          </div>
        </div>
        {!order.giftPurchaseDenominationId ? (
          <AdminCompactBtn
            type="button"
            variant="outline"
            className={styles.orderPrintBtn}
            onClick={() => window.print()}
          >
            Лист сборки
          </AdminCompactBtn>
        ) : null}
      </div>

      {flash ? (
        <p className={styles.orderFlash} role="status">
          {flash}
        </p>
      ) : null}
      {softPollStale ? (
        <div className={styles.orderSoftPollBanner} role="status">
          <span>Статус мог устареть — не удалось обновить заказ.</span>
          <button
            type="button"
            className={styles.orderSoftPollRetry}
            disabled={busy}
            onClick={() => void softLoad()}
          >
            Обновить
          </button>
        </div>
      ) : null}
      {order?.latePaymentFailed ||
      order?.events?.some((e) => {
        const m = e.meta as { lateFailed?: boolean } | null;
        return Boolean(m && m.lateFailed);
      }) ? (
        <div className={styles.orderAlertDanger} role="alert">
          <strong>Деньги списаны, заказ отменён</strong>
          Автовозврат через ЮKassa не удался. Проверьте платёж в ЛК ЮKassa и
          оформите возврат вручную.
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.orderDetailLayout}>
        <div className={styles.orderDetailMain}>
          <OrderAccordion
            id="order-client"
            title="Клиент"
            open={openClient}
            onToggle={() => setOpenClient((v) => !v)}
          >
            <dl className={`${styles.detailDl} ${styles.orderAccordionBodyFlush}`}>
              <div className={styles.detailDlRow}>
                <dt>Имя</dt>
                <dd>{order.customerName?.trim() || '—'}</dd>
              </div>
              <div className={styles.detailDlRow}>
                <dt>Email</dt>
                <dd>
                  {order.email ? (
                    <a
                      className={styles.orderInlineLink}
                      href={`mailto:${encodeURIComponent(order.email)}`}
                    >
                      {order.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              {order.pricingGroupName ? (
                <div className={styles.detailDlRow}>
                  <dt>Группа цен</dt>
                  <dd>
                    {order.pricingGroupName}
                    {order.pricingContext ? (
                      <span className={styles.muted}> ({order.pricingContext})</span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div className={styles.detailDlRow}>
                <dt>Телефон</dt>
                <dd>
                  {order.phone ? (
                    <a
                      className={styles.orderInlineLink}
                      href={`tel:${order.phone.replace(/[^\d+]/g, '')}`}
                    >
                      {order.phone}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className={styles.detailDlRow}>
                <dt>Аккаунт</dt>
                <dd>
                  {order.user ? (
                    <Link href={`/admin/users/${order.user.id}`}>
                      {order.user.displayName?.trim() || order.user.email}
                      {!order.user.isActive ? ' (удалён)' : ''}
                    </Link>
                  ) : (
                    'Гость'
                  )}
                </dd>
              </div>
              {order.customerNote?.trim() ? (
                <div className={styles.detailDlRow}>
                  <dt>Комментарий</dt>
                  <dd className={styles.orderNoteText}>
                    {order.customerNote.trim()}
                  </dd>
                </div>
              ) : null}
            </dl>
          </OrderAccordion>

          <OrderAccordion
            id="order-delivery"
            title="Доставка"
            open={openDelivery}
            onToggle={() => setOpenDelivery((v) => !v)}
            actions={
              order.actions.canEditAddress ? (
                <OrderIconBtn
                  label="Изменить адрес"
                  disabled={busy}
                  onClick={() => setAddressModalOpen(true)}
                />
              ) : null
            }
          >
            <dl className={`${styles.detailDl} ${styles.orderAccordionBodyFlush}`}>
              {methodHint ? (
                <div className={styles.detailDlRow}>
                  <dt>Способ</dt>
                  <dd>{methodHint}</dd>
                </div>
              ) : null}
              {(order.shippingAddress?.pvzCode || shippingMeta.meta?.pvzId) ? (
                <div className={styles.detailDlRow}>
                  <dt>ПВЗ</dt>
                  <dd>
                    <code>
                      {order.shippingAddress?.pvzCode ||
                        shippingMeta.meta?.pvzId}
                    </code>
                  </dd>
                </div>
              ) : null}
              {order.shippingAddress?.recipientName ? (
                <div className={styles.detailDlRow}>
                  <dt>Получатель</dt>
                  <dd>{order.shippingAddress.recipientName}</dd>
                </div>
              ) : null}
              {order.shippingAddress?.phone ? (
                <div className={styles.detailDlRow}>
                  <dt>Тел. получателя</dt>
                  <dd>{order.shippingAddress.phone}</dd>
                </div>
              ) : null}
              <div className={styles.detailDlRow}>
                <dt>Адрес</dt>
                <dd>
                  {order.shippingAddress
                    ? formatShippingAddress(order.shippingAddress)
                    : '—'}
                  {shippingMeta.comment ? (
                    <>
                      <br />
                      <span className={styles.mutedInline}>
                        {shippingMeta.comment}
                      </span>
                    </>
                  ) : null}
                </dd>
              </div>
              <div className={styles.detailDlRow}>
                <dt>Стоимость</dt>
                <dd>{formatAdminMoney(order.shippingCost)}</dd>
              </div>
              {order.shippingAddress?.carrierQuote ? (
                <div className={styles.detailDlRow}>
                  <dt>Тариф</dt>
                  <dd>
                    {[
                      order.shippingAddress.carrierQuote.tariffName,
                      order.shippingAddress.carrierQuote.tariffId != null
                        ? `#${order.shippingAddress.carrierQuote.tariffId}`
                        : null,
                      order.shippingAddress.carrierQuote.daysMin != null ||
                      order.shippingAddress.carrierQuote.daysMax != null
                        ? `${order.shippingAddress.carrierQuote.daysMin ?? '—'}–${order.shippingAddress.carrierQuote.daysMax ?? '—'} дн.`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </dd>
                </div>
              ) : null}
            </dl>
          </OrderAccordion>

          {order.promoCode ||
          order.giftCertificateCode ||
          order.giftPurchaseDenominationId ? (
            <div className={styles.orderAccordion}>
              <div className={styles.orderAccordionHead}>
                <span className={styles.orderAccordionTitle}>Скидки</span>
              </div>
              <div className={styles.orderAccordionBody}>
                <dl className={styles.detailDl}>
                  {order.promoCode ? (
                    <div className={styles.detailDlRow}>
                      <dt>Промокод</dt>
                      <dd>{order.promoCode}</dd>
                    </div>
                  ) : null}
                  {order.giftCertificateCode ? (
                    <div className={styles.detailDlRow}>
                      <dt>Сертификат</dt>
                      <dd>
                        {order.giftCertificateCode}
                        {order.giftCertificateAmount
                          ? ` (−${formatAdminMoney(order.giftCertificateAmount)})`
                          : ''}
                        {order.status === 'AWAITING_PAYMENT' ||
                        order.status === 'NEW' ? (
                          <p className={styles.lead} style={{ marginTop: 8 }}>
                            CAPTURE при создании заказа: баланс уже уменьшен, код
                            заморожен до оплаты или TTL (~60 мин).
                          </p>
                        ) : (
                          <p className={styles.lead} style={{ marginTop: 8 }}>
                            {GIFT_PARTIAL_REFUND_POLICY}
                          </p>
                        )}
                      </dd>
                    </div>
                  ) : null}
                  {order.giftPurchaseDenominationId ? (
                    <div className={styles.detailDlRow}>
                      <dt>Покупка сертификата</dt>
                      <dd>
                        да
                        {order.giftPurchaseRecipientEmail
                          ? ` → ${order.giftPurchaseRecipientEmail}`
                          : ''}
                      </dd>
                    </div>
                  ) : null}
                  {(order.issuedGiftCertificates?.length ?? 0) > 0 ? (
                    <div className={styles.detailDlRow}>
                      <dt>Выданные коды</dt>
                      <dd>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {order.issuedGiftCertificates!.map((c) => (
                            <li key={c.id}>
                              <AdminCompactBtnLink href={`/admin/certificates/${c.id}`}>
                                {c.code}
                              </AdminCompactBtnLink>
                              {` · ${formatAdminMoney(c.faceValue)} · остаток ${formatAdminMoney(c.balance)} · ${c.status}`}
                            </li>
                          ))}
                        </ul>
                        <p className={styles.lead} style={{ marginTop: 8 }}>
                          Полный refund заказа автоматически отзывает эти коды,
                          только если они ещё не потрачены (баланс = номинал).
                        </p>
                        {order.giftPurchaseRefundBlocked ? (
                          <p className={styles.error} role="alert" style={{ marginTop: 8 }}>
                            Refund покупки заблокирован: коды уже использованы на{' '}
                            {formatAdminMoney(order.giftPurchaseSpentTotal ?? 0)}.
                            Сначала полный возврат товарного заказа с сертификатом
                            (баланс вернётся) или ручная корректировка в «Сертификаты».
                            Clawback на redeem-заказ не делается.
                          </p>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          ) : null}

          <OrderAccordion
            id="order-items"
            title={`Позиции · ${order.items.length}`}
            open={openItems}
            onToggle={() => setOpenItems((v) => !v)}
            actions={
              order.actions.canEditItems ? (
                <OrderIconBtn
                  label="Изменить состав"
                  disabled={busy}
                  onClick={() => setItemsModalOpen(true)}
                />
              ) : null
            }
          >
            {order.items.length === 0 ? (
              <p className={styles.muted}>Нет позиций</p>
            ) : (
              <table
                className={`${styles.table} ${styles.orderAccordionBodyFlush} ${styles.orderItemsTable}`}
              >
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>SKU</th>
                    <th>Кол-во</th>
                    <th>Цена</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr
                      key={i.id}
                      className={
                        i.isGratitudeGift ? styles.orderItemGiftRow : undefined
                      }
                    >
                      <td data-label="Товар">
                        <div className={styles.orderItemTitleCell}>
                          {i.productId ? (
                            <Link href={`/admin/catalog/products/${i.productId}`}>
                              {i.title}
                            </Link>
                          ) : (
                            <span>{i.title}</span>
                          )}
                          {i.isGratitudeGift ? (
                            <span className={styles.badgeGift}>Подарок</span>
                          ) : null}
                        </div>
                      </td>
                      <td data-label="SKU" className={styles.mutedInline}>
                        {i.sku}
                      </td>
                      <td data-label="Кол-во">{i.qty}</td>
                      <td data-label="Цена">
                        {formatAdminMoney(i.isGratitudeGift ? 0 : i.unitPrice)}
                      </td>
                      <td data-label="Сумма">
                        {formatAdminMoney(i.isGratitudeGift ? 0 : i.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </OrderAccordion>
          {order.payments?.length ? (
            <div className={styles.orderAccordion}>
              <div
                className={`${styles.orderAccordionHead} ${styles.orderAccordionHeadStatic}`}
              >
                <span className={styles.orderAccordionTitle}>Платежи</span>
              </div>
              <div className={styles.orderAccordionBody}>
                <ul className={styles.orderPaymentList}>
                  {order.payments.map((p) => (
                    <li key={p.id} className={styles.orderPaymentRow}>
                      <div className={styles.orderPaymentRowTop}>
                        <div className={styles.orderPaymentRowMain}>
                          <span
                            className={`${styles.badge} ${paymentStatusBadgeClass(p.status, styles)}`}
                          >
                            {paymentStatusLabel(p.status)}
                          </span>
                          <span className={styles.orderPaymentKind}>
                            {p.kind === 'surcharge' ? 'Доплата' : 'Оплата заказа'}
                          </span>
                        </div>
                        <span className={styles.orderPaymentAmount}>
                          {formatAdminMoney(p.amount)}
                        </span>
                      </div>
                      <div className={styles.orderPaymentRowMeta}>
                        <span>{p.provider}</span>
                        <span aria-hidden>·</span>
                        <span>{formatAdminDateTime(p.createdAt)}</span>
                      </div>
                      {p.externalId ? (
                        <div className={styles.orderPaymentId}>
                          <span className={styles.orderMetaMuted}>ID</span>{' '}
                          <code className={styles.orderPaymentIdCode}>
                            {p.externalId}
                          </code>
                        </div>
                      ) : null}
                      {p.confirmationUrl && p.status === 'PENDING' ? (
                        <a
                          className={styles.orderPaymentLink}
                          href={p.confirmationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ссылка на оплату
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {order.shipments?.length ? (
            <>
              <h2 className={styles.sectionTitle}>Отправления</h2>
              <ul className={styles.orderPaymentList}>
                {order.shipments.map((s) => {
                  const url = s.tracking
                    ? trackingUrl(s.provider, s.tracking)
                    : null;
                  return (
                    <li key={s.id} className={styles.orderPaymentItem}>
                      {s.provider}
                      {s.tracking ? (
                        <>
                          {' · '}
                          {url ? (
                            <a
                              className={styles.orderInlineLink}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {s.tracking}
                            </a>
                          ) : (
                            s.tracking
                          )}
                        </>
                      ) : null}
                      {s.status ? ` · ${s.status}` : ''}
                      <br />
                      <span className={styles.orderMetaMuted}>
                        {formatAdminDateTime(s.createdAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {events.length ? (
            <>
              <h2 className={styles.sectionTitle}>История</h2>
              {events.length > HISTORY_PREVIEW ? (
                <button
                  type="button"
                  className={styles.orderHistoryToggle}
                  onClick={() => setHistoryOpen((v) => !v)}
                >
                  {historyOpen
                    ? 'Свернуть'
                    : `Показать все (${events.length})`}
                </button>
              ) : null}
              <ul className={styles.orderEventList}>
                {visibleEvents.map((ev) => (
                  <li key={ev.id} className={styles.orderEventItem}>
                    <span className={styles.orderEventTime}>
                      {formatAdminDateTime(ev.createdAt)}
                    </span>
                    <strong>{orderEventTypeLabel(ev.type)}</strong>
                    {ev.message ? `: ${ev.message}` : ''}
                    {ev.actor ? (
                      <span className={styles.orderActor}>
                        {ev.actor.displayName?.trim() || ev.actor.email}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <h2 className={styles.sectionTitle}>История</h2>
          )}
        </div>

        <aside className={styles.orderDetailAside}>
          <div>
            <p className={styles.orderAsideTitle}>Статус</p>
            <div className={styles.orderStatusRow}>
              <span
                className={`${styles.badge} ${orderStatusBadgeClass(order.status, styles)}`}
              >
                {orderStatusLabel(order.status)}
              </span>
            </div>
          </div>

          <div className={styles.orderTotalBlock}>
            <p className={styles.orderAsideTitle}>Сумма</p>
            <dl className={styles.detailDl} style={{ margin: 0 }}>
              <div className={styles.detailDlRow}>
                <dt>Товары</dt>
                <dd>{formatAdminMoney(order.subtotal)}</dd>
              </div>
              {order.discountTotal > 0 ? (
                <div className={styles.detailDlRow}>
                  <dt>Скидка</dt>
                  <dd>−{formatAdminMoney(order.discountTotal)}</dd>
                </div>
              ) : null}
              {(order.giftCertificateAmount ?? 0) > 0 ? (
                <div className={styles.detailDlRow}>
                  <dt>Сертификат</dt>
                  <dd>−{formatAdminMoney(order.giftCertificateAmount ?? 0)}</dd>
                </div>
              ) : null}
              {order.shippingCost > 0 ? (
                <div className={styles.detailDlRow}>
                  <dt>Доставка</dt>
                  <dd>{formatAdminMoney(order.shippingCost)}</dd>
                </div>
              ) : null}
              {order.refundedAmount > 0 ? (
                <div className={styles.detailDlRow}>
                  <dt>Возвращено</dt>
                  <dd>
                    {formatAdminMoney(order.refundedAmount)}
                    {order.refundRemaining > 0
                      ? ` (остаток ${formatAdminMoney(order.refundRemaining)})`
                      : ''}
                  </dd>
                </div>
              ) : null}
              {(order.balanceDue ?? 0) > 0 ? (
                <div className={styles.detailDlRow}>
                  <dt>К доплате</dt>
                  <dd>{formatAdminMoney(order.balanceDue ?? 0)}</dd>
                </div>
              ) : null}
            </dl>
            <p className={styles.orderTotalValue}>
              {formatAdminMoney(order.total)}
            </p>
            {order.actions.canCreateSurcharge ? (
              <AdminCompactBtn
                type="button"
                disabled={busy}
                onClick={() =>
                  askConfirm({
                    title: 'Доплата',
                    message: `Выставить ссылку на доплату ${formatAdminMoney(order.balanceDue ?? 0)}? Клиенту уйдёт письмо.`,
                    confirmLabel: 'Выставить',
                    run: async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const res = await adminBackendJson<
                          AdminOrderDetail & {
                            surcharge?: { confirmationUrl: string };
                          }
                        >(`orders/admin/${orderId}/surcharge-payment`, {
                          method: 'POST',
                          body: JSON.stringify({}),
                        });
                        if (res.items && res.actions) setOrder(res);
                        else await load();
                        if (res.surcharge?.confirmationUrl) {
                          setSurchargeUrl(res.surcharge.confirmationUrl);
                        }
                        showFlash('Ссылка на доплату создана');
                      } catch (e) {
                        setError(
                          e instanceof AdminBackendRequestError
                            ? e.message
                            : 'Ошибка доплаты',
                        );
                      } finally {
                        setBusy(false);
                        setConfirm(null);
                      }
                    },
                  })
                }
              >
                Выставить доплату
              </AdminCompactBtn>
            ) : null}
          </div>

          {hasAsideActions ? (
            <div className={styles.orderAsideActions}>
              <p className={styles.orderAsideTitle}>Действия</p>

              {canMarkPaid ? (
                <AdminCompactBtn
                  type="button"
                  variant="accent"
                  disabled={busy}
                  onClick={() =>
                    askConfirm({
                      title: 'Отметить оплаченным',
                      message: `Отметить заказ ${order.number} оплаченным вручную?`,
                      confirmLabel: 'Отметить',
                      run: () =>
                        runAction(
                          `orders/admin/${orderId}/mark-paid`,
                          undefined,
                          'Заказ отмечен оплаченным',
                        ),
                    })
                  }
                >
                  Отметить оплаченным
                </AdminCompactBtn>
              ) : null}

              {a.canStartPacking ? (
                <AdminCompactBtn
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    askConfirm({
                      title: 'В сборку',
                      message: `Перевести заказ ${order.number} в статус «Сборка»?`,
                      confirmLabel: 'В сборку',
                      run: () =>
                        runAction(
                          `orders/admin/${orderId}/packing`,
                          undefined,
                          'Заказ в сборке',
                        ),
                    })
                  }
                >
                  В сборку
                </AdminCompactBtn>
              ) : null}

              {a.canDeliver ? (
                <AdminCompactBtn
                  type="button"
                  variant="accent"
                  disabled={busy}
                  onClick={() =>
                    askConfirm({
                      title: 'Доставлен',
                      message: `Отметить заказ ${order.number} доставленным?`,
                      confirmLabel: 'Доставлен',
                      run: () =>
                        runAction(
                          `orders/admin/${orderId}/deliver`,
                          undefined,
                          'Заказ доставлен',
                        ),
                    })
                  }
                >
                  Доставлен
                </AdminCompactBtn>
              ) : null}

              {a.canShip || canSendTracking ? (
                <div className={styles.orderAsideFieldStack}>
                  <p className={styles.orderAsideTitle}>Отправка</p>
                  {a.canShip ? (
                    <>
                      <AdminSelect
                        label="Служба"
                        value={shipProvider}
                        onChange={(e) => setShipProvider(e.target.value)}
                        disabled={busy}
                      >
                        <option value="CDEK">СДЭК</option>
                        <option value="YANDEX">Яндекс</option>
                        <option value="PICKUP">Самовывоз</option>
                      </AdminSelect>
                      <AdminTextField
                        label="Трек"
                        value={tracking}
                        onChange={(e) => setTracking(e.target.value)}
                        disabled={busy}
                        placeholder={
                          shipProvider === 'CDEK'
                            ? 'пусто = создать в СДЭК'
                            : shipProvider === 'YANDEX'
                              ? 'обязательно'
                              : 'опционально'
                        }
                      />
                      {shipProvider === 'CDEK' && !tracking.trim() ? (
                        <p className={styles.orderHint}>
                          Без трека Nest создаст отправление в СДЭК по pvzCode /
                          адресу (нужны CDEK_ACCOUNT / CDEK_SECURE на API).
                        </p>
                      ) : null}
                      {shipProvider === 'YANDEX' && !tracking.trim() ? (
                        <p className={styles.orderHint}>
                          Яндекс: автосоздание не подключено — укажите трек,
                          иначе отметка недоступна.
                        </p>
                      ) : null}
                      <p className={styles.orderHint}>
                        Только статус «Отправлен». Письмо клиенту — отдельной
                        кнопкой после отправки.
                      </p>
                      <AdminCompactBtn
                        type="button"
                        variant="accent"
                        disabled={
                          busy ||
                          (shipProvider === 'YANDEX' && !tracking.trim())
                        }
                        onClick={() =>
                          askConfirm({
                            title: 'Заказ отправлен',
                            message: [
                              `Заказ ${order.number} → статус «Отправлен» (${shipProvider}).`,
                              tracking.trim()
                                ? `Трек: ${tracking.trim()}.`
                                : shipProvider === 'CDEK'
                                  ? 'Трек пуст — Nest создаст отправление в СДЭК.'
                                  : null,
                              'Письмо клиенту не отправляется.',
                            ]
                              .filter(Boolean)
                              .join(' '),
                            confirmLabel: 'Заказ отправлен',
                            run: () =>
                              runAction(
                                `orders/admin/${orderId}/ship`,
                                {
                                  provider: shipProvider,
                                  tracking: tracking.trim() || undefined,
                                },
                                'Заказ отмечен отправленным',
                              ),
                          })
                        }
                      >
                        Заказ отправлен
                      </AdminCompactBtn>
                      {shipProvider === 'CDEK' ? (
                        <>
                          {carrierAlreadyCreated ? (
                            <p className={styles.orderHint}>
                              Отправление у перевозчика уже создано — повторно
                              «Создать в СДЭК» не нужно.
                            </p>
                          ) : null}
                          <AdminCompactBtn
                            type="button"
                            disabled={busy || carrierAlreadyCreated}
                            onClick={() =>
                              askConfirm({
                                title: 'Создать в СДЭК',
                                message: `Создать отправление СДЭК для заказа ${order.number} без смены статуса?`,
                                confirmLabel: 'Создать',
                                run: () =>
                                  runAction(
                                    `orders/admin/${orderId}/register-carrier`,
                                    { provider: shipProvider },
                                    'Отправление создано у перевозчика',
                                  ),
                              })
                            }
                          >
                            Создать в СДЭК
                          </AdminCompactBtn>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {canSendTracking ? (
                    <>
                      <AdminTextField
                        label="Трек-номер"
                        value={tracking}
                        onChange={(e) => setTracking(e.target.value)}
                        disabled={busy}
                        placeholder="из отправления или вручную"
                      />
                      <p className={styles.orderHint}>
                        Отправит письмо клиенту ({order.email}) с трек-номером.
                        Статус заказа не меняется.
                      </p>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={
                          busy ||
                          !(
                            tracking.trim() ||
                            order.shipments?.[0]?.tracking?.trim()
                          )
                        }
                        onClick={() => {
                          const track =
                            tracking.trim() ||
                            order.shipments?.[0]?.tracking?.trim() ||
                            '';
                          askConfirm({
                            title: 'Отправить трек-номер',
                            message: `Отправить письмо на ${order.email} с треком ${track}?`,
                            confirmLabel: 'Отправить трек',
                            run: () =>
                              runAction(
                                `orders/admin/${orderId}/send-tracking`,
                                {
                                  tracking: tracking.trim() || undefined,
                                },
                                'Письмо с треком отправлено',
                              ),
                          });
                        }}
                      >
                        Отправить трек-номер
                      </AdminCompactBtn>
                    </>
                  ) : null}
                </div>
              ) : null}

              {canRefund ? (
                <OrderAccordion
                  id="order-refund"
                  title="Возврат"
                  open={openRefund}
                  onToggle={() => setOpenRefund((v) => !v)}
                >
                  <div className={styles.orderAsideFieldStack}>
                    {stockNotRestoredOnRefund ? (
                      <p className={styles.orderHint}>
                        После отправки полный возврат не возвращает товар на склад
                        (по политике). Сток восстанавливается только из PAID /
                        PACKING.
                      </p>
                    ) : null}
                    {(order.giftCertificateAmount ?? 0) > 0 ||
                    order.giftPurchaseDenominationId ? (
                      <p className={styles.orderHint} role="note">
                        {GIFT_PARTIAL_REFUND_POLICY}
                      </p>
                    ) : null}
                    <AdminTextField
                      label="Сумма ₽"
                      value={refundAmount}
                      onChange={(e) =>
                        setRefundAmount(e.target.value.replace(/\D/g, ''))
                      }
                      disabled={
                        busy ||
                        (order.giftCertificateAmount ?? 0) > 0 ||
                        Boolean(order.giftPurchaseDenominationId)
                      }
                      inputMode="numeric"
                    />
                    {(order.giftCertificateAmount ?? 0) > 0 ||
                    order.giftPurchaseDenominationId ? (
                      <p className={styles.orderHint}>
                        Сумма зафиксирована на полный остаток по карте (
                        {formatAdminMoney(order.refundRemaining)}).
                      </p>
                    ) : null}
                    <AdminTextField
                      label="Причина"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      disabled={busy}
                      placeholder="опционально"
                    />
                    <div className={styles.labelCheckboxRow}>
                      <AdminCheckbox
                        id="order-provider-refund"
                        className={styles.adminCheckboxForm}
                        checked={providerRefund}
                        onChange={(e) => setProviderRefund(e.target.checked)}
                        disabled={busy}
                      />
                      <label htmlFor="order-provider-refund">Через ЮKassa</label>
                    </div>
                    {!providerRefund ? (
                      <p className={styles.error} role="status">
                        Без ЮKassa возврат только в учёте — деньги на карте не
                        вернутся.
                      </p>
                    ) : null}
                    <AdminCompactBtn
                      type="button"
                      variant="danger"
                      disabled={
                        busy ||
                        (order.refundRemaining > 0
                          ? !refundAmount
                          : !(
                              (order.giftCertificateAmount ?? 0) > 0 ||
                              order.giftPurchaseDenominationId
                            ))
                      }
                      onClick={() =>
                        askConfirm({
                          title: 'Возврат средств',
                          message: (() => {
                            const giftFullOnly =
                              (order.giftCertificateAmount ?? 0) > 0 ||
                              Boolean(order.giftPurchaseDenominationId);
                            const amt =
                              giftFullOnly && order.refundRemaining > 0
                                ? order.refundRemaining
                                : Number(refundAmount);
                            if (providerRefund) {
                              return `Вернуть ${amt} ₽ через ЮKassa по заказу ${order.number}?${
                                giftFullOnly
                                  ? ' Сертификат вернётся на баланс только при полном возврате.'
                                  : ''
                              }`;
                            }
                            return amt > 0
                              ? `Учесть возврат ${amt} ₽ без ЮKassa (деньги на карте не вернутся)?`
                              : `Полный возврат без карты (открутка сертификата / отзыв кодов) по заказу ${order.number}?`;
                          })(),
                          confirmLabel: 'Вернуть',
                          danger: true,
                          run: () => {
                            const giftFullOnly =
                              (order.giftCertificateAmount ?? 0) > 0 ||
                              Boolean(order.giftPurchaseDenominationId);
                            const amount =
                              giftFullOnly && order.refundRemaining > 0
                                ? order.refundRemaining
                                : Number(refundAmount);
                            return runAction(
                              `orders/admin/${orderId}/refund`,
                              {
                                amount,
                                reason: refundReason.trim() || undefined,
                                providerRefund,
                              },
                              'Возврат выполнен',
                            );
                          },
                        })
                      }
                    >
                      Вернуть
                    </AdminCompactBtn>
                  </div>
                </OrderAccordion>
              ) : null}

              {a.canCancel ? (
                <div className={styles.orderAsideFieldStack}>
                  <AdminCompactBtn
                    type="button"
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      askConfirm({
                        title: 'Отменить заказ',
                        message: `Отменить заказ ${order.number}? Отмена до оплаты / без возврата через ЮKassa.`,
                        confirmLabel: 'Отменить заказ',
                        danger: true,
                        run: () =>
                          runAction(
                            `orders/admin/${orderId}/cancel`,
                            undefined,
                            'Заказ отменён',
                          ),
                      })
                    }
                  >
                    Отменить
                  </AdminCompactBtn>
                  {canRefund ? (
                    <p className={styles.orderHint}>
                      Отмена — снять заказ с обработки. Если деньги уже списаны,
                      используйте «Вернуть».
                    </p>
                  ) : (
                    <p className={styles.orderHint}>
                      Отмена до оплаты или без возврата денег через ЮKassa.
                    </p>
                  )}
                </div>
              ) : null}

              {!primaryActions && canRefund && !a.canShip ? (
                <p className={styles.orderHint}>
                  Доступен возврат. Отмена недоступна — заказ уже в оплаченном
                  статусе.
                </p>
              ) : null}
            </div>
          ) : null}

          <OrderAccordion
            id="order-note"
            title="Заметка"
            open={openNote}
            onToggle={() => setOpenNote((v) => !v)}
          >
            <div className={styles.orderNoteForm}>
              {supportNotes.length === 0 ? (
                <p className={styles.orderHint} style={{ marginTop: 0 }}>
                  Внутренние заметки саппорта. Каждая запись также попадает в
                  историю заказа.
                </p>
              ) : (
                <ul className={styles.orderNoteList}>
                  {supportNotes.map((ev) => (
                    <li key={ev.id} className={styles.orderNoteItem}>
                      <div className={styles.orderNoteMeta}>
                        <span>{formatAdminDateTime(ev.createdAt)}</span>
                        {ev.actor ? (
                          <span>
                            {ev.actor.displayName?.trim() || ev.actor.email}
                          </span>
                        ) : null}
                      </div>
                      <p className={styles.orderNoteText}>{ev.message}</p>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                className={styles.orderNoteTextarea}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value.slice(0, 2000))}
                placeholder="Внутренняя заметка для саппорта…"
                rows={3}
                disabled={busy}
                maxLength={2000}
              />
              <AdminCompactBtn
                type="button"
                disabled={busy || !noteDraft.trim()}
                onClick={() => {
                  const message = noteDraft.trim();
                  if (!message) return;
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const row = await adminBackendJson<AdminOrderDetail>(
                        `orders/admin/${orderId}/note`,
                        {
                          method: 'POST',
                          body: JSON.stringify({ message }),
                        },
                      );
                      setOrder(row);
                      setNoteDraft('');
                      showFlash('Заметка добавлена');
                    } catch (e) {
                      setError(
                        e instanceof AdminBackendRequestError
                          ? e.message
                          : 'Не удалось сохранить заметку',
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Добавить заметку
              </AdminCompactBtn>
            </div>
          </OrderAccordion>
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm || busy) return;
          void confirm.run();
        }}
      />

      {surchargeUrl ? (
        <ConfirmDialog
          open
          title="Ссылка на доплату"
          message={surchargeUrl}
          confirmLabel="Скопировать"
          onCancel={() => setSurchargeUrl(null)}
          onConfirm={() => {
            void navigator.clipboard.writeText(surchargeUrl);
            showFlash('Ссылка скопирована');
            setSurchargeUrl(null);
          }}
        />
      ) : null}

      <OrderAddressEditModal
        open={addressModalOpen}
        initial={order.shippingAddress}
        shippingCost={order.shippingCost}
        shippingMethod={order.shippingMethod}
        busy={busy}
        customerName={order.customerName || order.shippingAddress?.recipientName}
        customerPhone={order.phone || order.shippingAddress?.phone}
        onClose={() => setAddressModalOpen(false)}
        onSave={saveAddress}
      />

      <OrderItemsEditModal
        open={itemsModalOpen}
        initialItems={order.items}
        busy={busy}
        onClose={() => setItemsModalOpen(false)}
        onSave={saveItems}
      />
      </div>

      <section className={styles.orderPickList} aria-hidden>
        <h1 className={styles.orderPickListTitle}>Лист сборки · {order.number}</h1>
        <p className={styles.orderPickListMeta}>
          {[
            formatAdminDateTime(order.createdAt),
            orderStatusLabel(order.status),
            order.customerName?.trim() || null,
            order.phone || null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <dl className={styles.orderPickListAddress}>
          <dt>Адрес / доставка</dt>
          <dd>
            {[
              methodHint || null,
              order.shippingAddress
                ? formatShippingAddress(order.shippingAddress)
                : null,
              order.shippingAddress?.pvzCode
                ? `ПВЗ ${order.shippingAddress.pvzCode}`
                : null,
              order.shippingAddress?.recipientName
                ? `Получатель: ${order.shippingAddress.recipientName}`
                : null,
              order.shippingAddress?.phone
                ? `Тел.: ${order.shippingAddress.phone}`
                : null,
            ]
              .filter(Boolean)
              .join('\n') || '—'}
          </dd>
          {order.customerNote?.trim() ? (
            <>
              <dt>Комментарий клиента</dt>
              <dd>{order.customerNote.trim()}</dd>
            </>
          ) : null}
          {order.shippingAddress?.comment?.trim() ? (
            <>
              <dt>Комментарий к адресу</dt>
              <dd>{order.shippingAddress.comment.trim()}</dd>
            </>
          ) : null}
        </dl>
        {order.items.length === 0 ? (
          <p>Нет позиций</p>
        ) : (
          <table className={styles.orderPickListTable}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Товар</th>
                <th>Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className={styles.orderPickListSku}>{i.sku || '—'}</td>
                  <td>
                    {i.title}
                    {i.isGratitudeGift ? (
                      <>
                        {' '}
                        <span className={styles.orderPickListGift}>подарок</span>
                      </>
                    ) : null}
                  </td>
                  <td>{i.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
