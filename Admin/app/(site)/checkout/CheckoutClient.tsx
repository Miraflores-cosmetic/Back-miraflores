'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCart } from '@/lib/cart/CartContext';
import {
  computeCatalogDiscount,
  computeListSubtotal,
} from '@/lib/cart/cartTotals';
import { getOrCreateGuestId } from '@/lib/cart/guestId';
import { formatPhoneE164, isValidPhone } from '@/lib/phone';
import {
  CheckoutContactSection,
  type CheckoutContactErrors,
  type CheckoutContactValues,
} from './CheckoutContactSection';
import {
  CheckoutDeliverySection,
  type CheckoutDeliveryErrors,
  type CheckoutDeliveryValues,
  type CheckoutSavedAddress,
} from './CheckoutDeliverySection';
import { CheckoutPaySection } from './CheckoutPaySection';
import { CheckoutSummary } from './CheckoutSummary';
import {
  ShippingCarrierModal,
  type ShippingSelection,
} from '@/components/shipping/ShippingCarrierModal';
import {
  buildJcosAddress2WithMeta,
  formatJcosDeliveryAddressSummary,
  getJcosDeliveryDisplayMode,
  parseJcosAddressMeta,
  type JcosAddressMeta,
} from '@/lib/shipping/addressShippingMeta';
import {
  addressToShippingSeed,
  buyerDeliveryTitle,
  shippingSelectionToAddressPayload,
} from '@/lib/shipping/buyerAddressHelpers';
import { estimateShippingCostRub } from '@/lib/shipping/estimateShippingCost';
import { calcPayableTotal } from '@/lib/payableTotal';
import { readApiError } from '@/lib/readApiError';
import { useBuyerAuth } from '@/lib/BuyerAuthProvider';
import { useYooKassaOrderPayment } from '@/lib/payments/useYooKassaOrderPayment';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  GIFT_HOLD_APPLIED_TOAST,
  GIFT_HOLD_CAPTURED_TOAST,
} from '@/lib/giftHoldCopy';
import type { BuyerAddress } from '../account/accountTypes';
import styles from './CheckoutPage.module.css';

type AccountAddressDto = {
  id: string;
  recipientName: string | null;
  phone: string | null;
  city: string;
  address: string;
  apartment: string | null;
  postalCode: string | null;
  comment: string | null;
  isDefault: boolean;
};

function toSavedAddress(a: AccountAddressDto): CheckoutSavedAddress {
  const asBuyer: BuyerAddress = {
    ...a,
    createdAt: '',
    updatedAt: '',
  };
  return {
    id: a.id,
    label: buyerDeliveryTitle(asBuyer),
    city: a.city,
    address: a.address,
    apartment: a.apartment ?? '',
    postalCode: a.postalCode ?? '',
    comment: a.comment ?? '',
    isDefault: a.isDefault,
  };
}

type CreatedOrder = {
  id: string;
  number: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  promoCode: string | null;
  status: string;
  payToken?: string | null;
};

type PayResponse = {
  alreadyPaid?: boolean;
  orderId: string;
  number: string;
  total: number;
  paymentId?: string;
  confirmationToken?: string;
  message?: string | string[];
};

type FieldErrors = CheckoutContactErrors & CheckoutDeliveryErrors;

/** Маппинг сообщений Nest ValidationPipe → поля. */
function mapApiFieldErrors(message: string | string[] | undefined): FieldErrors {
  const msgs = Array.isArray(message) ? message : message ? [message] : [];
  const out: FieldErrors = {};
  for (const m of msgs) {
    const lower = m.toLowerCase();
    if (lower.includes('email')) out.email = m;
    else if (lower.includes('phone') || lower.includes('телефон')) out.phone = m;
    else if (lower.includes('customername') || lower.includes('имя'))
      out.customerName = m;
    else if (lower.includes('city') || lower.includes('город')) out.city = m;
    else if (lower.includes('address') || lower.includes('адрес')) out.address = m;
    else if (lower.includes('postal')) out.postalCode = m;
  }
  return out;
}

function validateCheckoutFields(
  contact: CheckoutContactValues,
  delivery: CheckoutDeliveryValues,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!contact.email.trim()) errors.email = 'Укажите email';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) {
    errors.email = 'Некорректный email';
  }
  if (!contact.phone.trim()) errors.phone = 'Укажите телефон';
  else if (!isValidPhone(contact.phone)) {
    errors.phone = 'Введите номер: +7 (9XX) XXX-XX-XX';
  }
  if (!contact.customerName.trim()) errors.customerName = 'Укажите имя';
  if (!delivery.city.trim()) errors.city = 'Укажите город';
  if (!delivery.address.trim()) errors.address = 'Укажите адрес';
  return errors;
}

export function CheckoutClient() {
  const router = useRouter();
  const {
    items,
    subtotal,
    discountAmount,
    total,
    promo,
    promoBusy,
    applyPromo,
    revalidatePromoForShipping,
    clearPromo,
    hydrated,
    syncCart,
    clearCart,
  } = useCart();
  const { showToast } = useToast();

  const [contact, setContact] = useState<CheckoutContactValues>({
    email: '',
    phone: '',
    customerName: '',
  });
  const [delivery, setDelivery] = useState<CheckoutDeliveryValues>({
    city: '',
    address: '',
    apartment: '',
    postalCode: '',
    comment: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [promoInput, setPromoInput] = useState('');
  const [promoError, setPromoError] = useState<string | undefined>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [payToken, setPayToken] = useState<string | null>(null);
  const [resettingPayment, setResettingPayment] = useState(false);
  const {
    ready: authReady,
    authenticated: buyerAuthed,
    user: buyerUser,
  } = useBuyerAuth();
  const [profileDefaults, setProfileDefaults] = useState<{
    recipientName: string;
    phone: string;
  }>({ recipientName: '', phone: '' });
  const [savedAddresses, setSavedAddresses] = useState<CheckoutSavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [shippingModalOpen, setShippingModalOpen] = useState(false);
  /** «Изменить» сохранённой доставки — PATCH после confirm. */
  const [shippingEditId, setShippingEditId] = useState<string | null>(null);
  const [shippingMeta, setShippingMeta] = useState<JcosAddressMeta | null>(null);
  const [shippingCost, setShippingCost] = useState<number | null>(null);
  const addressByIdRef = useRef<Map<string, AccountAddressDto>>(new Map());
  const profilePrefillDone = useRef(false);

  useEffect(() => {
    setPromoInput(promo?.code ?? '');
  }, [promo?.code]);

  const ingestAddressList = useCallback((list: AccountAddressDto[]) => {
    const mapped = list.map(toSavedAddress);
    addressByIdRef.current = new Map(list.map((a) => [a.id, a]));
    setSavedAddresses(mapped);
    return mapped;
  }, []);

  const applySavedAddress = useCallback(
    (id: string, list?: CheckoutSavedAddress[]): boolean => {
      const pool = list ?? savedAddresses;
      const mapped = pool.find((a) => a.id === id);
      const raw = addressByIdRef.current.get(id);
      if (!mapped) return false;

      const { meta, comment } = parseJcosAddressMeta(mapped.comment);
      // Без carrier не подставляем город/улицу — иначе shippingCost=0 / create падает.
      if (!meta?.carrier) {
        return false;
      }

      setSelectedAddressId(id);
      setDelivery({
        city: mapped.city,
        address: mapped.address,
        apartment: mapped.apartment,
        postalCode: mapped.postalCode,
        comment,
      });
      setShippingMeta(meta);
      void estimateShippingCostRub({
        carrier: meta.carrier,
        dropoff:
          meta.dropoff ?? getJcosDeliveryDisplayMode(mapped.comment).mode,
        recipientName: raw?.recipientName ?? '',
        phone: raw?.phone ?? '',
        city: mapped.city,
        address: mapped.address,
        apartment: mapped.apartment,
        postalCode: mapped.postalCode,
        comment,
        lat: meta.lat,
        lon: meta.lon,
        pvzId: meta.pvzId,
      }).then((cost) => setShippingCost(cost));

      if (raw) {
        setContact((c) => ({
          ...c,
          customerName: raw.recipientName?.trim() || c.customerName,
          phone: raw.phone?.trim() || c.phone,
        }));
      }
      setFieldErrors((fe) => {
        const next = { ...fe };
        delete next.city;
        delete next.address;
        delete next.apartment;
        delete next.postalCode;
        return next;
      });
      return true;
    },
    [savedAddresses],
  );

  const selectSavedAddressOrEdit = useCallback(
    (id: string) => {
      if (applySavedAddress(id)) return;
      // Адрес без carrier — открыть модалку доставки, не префиллить поля.
      setShippingEditId(id);
      setShippingModalOpen(true);
    },
    [applySavedAddress],
  );

  const refreshAddresses = useCallback(
    async (selectId?: string) => {
      const addrRes = await fetch('/api/account/addresses', {
        credentials: 'same-origin',
      });
      if (!addrRes.ok) return;
      const list = (await addrRes.json()) as AccountAddressDto[];
      if (!Array.isArray(list)) return;
      const mapped = ingestAddressList(list);
      if (selectId) applySavedAddress(selectId, mapped);
    },
    [ingestAddressList, applySavedAddress],
  );

  function openShippingModal(editId: string | null = null) {
    setShippingEditId(editId);
    setShippingModalOpen(true);
  }

  function openEditAddressModal() {
    if (selectedAddressId && addressByIdRef.current.has(selectedAddressId)) {
      openShippingModal(selectedAddressId);
      return;
    }
    openShippingModal(null);
  }

  const applyShippingSelection = useCallback(
    async (selection: ShippingSelection, keepAddressId?: string | null) => {
      if (!selection.carrier) {
        setShippingCost(null);
        setShippingMeta(null);
        return;
      }
      setSelectedAddressId(keepAddressId ?? null);
      setDelivery({
        city: selection.city,
        address: selection.address,
        apartment: selection.apartment,
        postalCode: selection.postalCode,
        comment: selection.comment,
      });
      setShippingMeta({
        carrier: selection.carrier,
        dropoff: selection.dropoff,
        ...(selection.lat != null ? { lat: selection.lat } : {}),
        ...(selection.lon != null ? { lon: selection.lon } : {}),
        ...(selection.pvzId ? { pvzId: selection.pvzId } : {}),
      });
      setContact((c) => ({
        ...c,
        customerName: selection.recipientName.trim() || c.customerName,
        phone: selection.phone.trim() || c.phone,
      }));
      setFieldErrors((fe) => {
        const next = { ...fe };
        delete next.city;
        delete next.address;
        delete next.apartment;
        delete next.postalCode;
        return next;
      });

      if (
        selection.shippingCostHint != null &&
        selection.shippingCostHint > 0
      ) {
        setShippingCost(selection.shippingCostHint);
        return;
      }
      const cost = await estimateShippingCostRub(selection);
      setShippingCost(cost);
    },
    [],
  );

  const persistAndApplyShipping = useCallback(
    async (selection: ShippingSelection) => {
      const editId = shippingEditId;
      if (buyerAuthed && editId) {
        const res = await fetch(
          `/api/account/addresses/${encodeURIComponent(editId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(shippingSelectionToAddressPayload(selection)),
          },
        );
        if (res.ok) {
          const updated = (await res.json()) as AccountAddressDto;
          addressByIdRef.current.set(updated.id, updated);
          await refreshAddresses(updated.id);
          return;
        }
        await applyShippingSelection(selection, editId);
        return;
      }

      if (buyerAuthed && !editId) {
        const res = await fetch('/api/account/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(
            shippingSelectionToAddressPayload(selection, { isDefault: true }),
          ),
        });
        if (res.ok) {
          const created = (await res.json()) as AccountAddressDto;
          addressByIdRef.current.set(created.id, created);
          await refreshAddresses(created.id);
          return;
        }
      }

      await applyShippingSelection(selection);
    },
    [
      applyShippingSelection,
      buyerAuthed,
      refreshAddresses,
      shippingEditId,
    ],
  );

  const shippingLabel = shippingMeta
    ? formatJcosDeliveryAddressSummary({
        streetAddress2: buildJcosAddress2WithMeta(shippingMeta, ''),
        city: delivery.city,
        streetAddress1: delivery.address,
      }).split(':')[0] || null
    : null;

  const applySavedAddressRef = useRef(applySavedAddress);
  applySavedAddressRef.current = applySavedAddress;
  const ingestAddressListRef = useRef(ingestAddressList);
  ingestAddressListRef.current = ingestAddressList;

  useEffect(() => {
    if (!authReady) return;

    if (!buyerAuthed || !buyerUser) {
      return;
    }

    const user = buyerUser;
    const fromLk = {
      recipientName: user.displayName?.trim() || '',
      phone: user.phone?.trim() || '',
    };
    setProfileDefaults(fromLk);

    if (profilePrefillDone.current) return;
    profilePrefillDone.current = true;

    setContact((c) => ({
      email: c.email || user.email || '',
      phone: c.phone || fromLk.phone,
      customerName: c.customerName || fromLk.recipientName,
    }));

    let cancelled = false;
    void (async () => {
      try {
        const addrRes = await fetch('/api/account/addresses', {
          credentials: 'same-origin',
        });
        if (cancelled || !addrRes.ok) return;
        const list = (await addrRes.json()) as AccountAddressDto[];
        if (!Array.isArray(list) || list.length === 0) return;

        const mapped = ingestAddressListRef.current(list);

        // Prefill доставки — только через applySavedAddress (carrier обязателен).
        const preferred =
          mapped.find((a) => {
            if (!a.isDefault) return false;
            return Boolean(parseJcosAddressMeta(a.comment).meta?.carrier);
          }) ??
          mapped.find((a) =>
            Boolean(parseJcosAddressMeta(a.comment).meta?.carrier),
          ) ??
          null;

        if (preferred) {
          applySavedAddressRef.current(preferred.id, mapped);
        }

        const rawPreferred = preferred
          ? list.find((x) => x.id === preferred.id)
          : list.find((x) => x.isDefault) ?? list[0];
        if (rawPreferred) {
          setProfileDefaults((p) => ({
            recipientName:
              p.recipientName ||
              rawPreferred.recipientName?.trim() ||
              user.displayName?.trim() ||
              '',
            phone:
              p.phone ||
              rawPreferred.phone?.trim() ||
              user.phone?.trim() ||
              '',
          }));
        }
      } catch {
        /* ignore address prefill */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, buyerAuthed, buyerUser]);

  useEffect(() => {
    if (hydrated && items.length && !order) void syncCart();
  }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const catalogDiscount = useMemo(() => computeCatalogDiscount(items), [items]);
  const listSubtotal = useMemo(() => computeListSubtotal(items), [items]);
  /** Один итог для CTA / summary / create (gift гасит товары+доставку). */
  const payableTotal = useMemo(
    () =>
      calcPayableTotal({
        goodsSubtotal: subtotal,
        goodsAfterPromo: total,
        shippingCost,
        voucherKind: promo?.kind ?? null,
        giftAmount: promo?.kind === 'gift' ? discountAmount : 0,
      }),
    [subtotal, total, shippingCost, promo?.kind, discountAmount],
  );

  // Gift validate зависит от shipping — как на Nest create.
  const shippingForGiftKey =
    promo?.kind === 'gift' && shippingCost != null ? String(shippingCost) : '';
  useEffect(() => {
    if (!shippingForGiftKey) return;
    void revalidatePromoForShipping(Number(shippingForGiftKey));
  }, [shippingForGiftKey, revalidatePromoForShipping]);

  const linesPayload = useMemo(
    () =>
      items.map((l) => ({
        variantId: l.variantId,
        shadeId: l.shadeId ?? null,
        qty: l.qty,
      })),
    [items],
  );

  const checkoutFingerprint = useMemo(
    () =>
      JSON.stringify({
        lines: linesPayload,
        promo: promo?.code ?? null,
        email: contact.email.trim().toLowerCase(),
        phone: contact.phone.trim(),
        customerName: contact.customerName.trim(),
        city: delivery.city.trim(),
        address: delivery.address.trim(),
        apartment: delivery.apartment.trim(),
        postalCode: delivery.postalCode.trim(),
        comment: delivery.comment.trim(),
        shippingCost,
        shippingCarrier: shippingMeta?.carrier ?? null,
        shippingDropoff: shippingMeta?.dropoff ?? null,
        shippingPvzId: shippingMeta?.pvzId ?? null,
      }),
    [linesPayload, promo?.code, contact, delivery, shippingCost, shippingMeta],
  );

  const [orderFingerprint, setOrderFingerprint] = useState<string | null>(null);
  const idempotencyKeyRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `ik-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    idempotencyKeyRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ik-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, [checkoutFingerprint]);

  const abandonOrder = useCallback(async (orderId: string, token: string | null) => {
    if (!token) return;
    try {
      await fetch(`/api/public/orders/${encodeURIComponent(orderId)}/abandon`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ payToken: token }),
        cache: 'no-store',
      });
    } catch {
      /* ignore */
    }
  }, []);

  const goSuccess = useCallback(
    (number: string, orderId?: string, opts?: { confirmed?: boolean }) => {
      clearCart();
      try {
        if (opts?.confirmed) {
          sessionStorage.setItem('miraflores.pendingPaidConfirmed', orderId || '1');
          if (number) sessionStorage.setItem('miraflores.pendingOrderNumber', number);
        }
      } catch {
        /* ignore */
      }
      const qs = new URLSearchParams({ number });
      if (orderId) qs.set('orderId', orderId);
      router.replace(`/checkout/success?${qs.toString()}`);
    },
    [clearCart, router],
  );

  const payment = useYooKassaOrderPayment({
    onPaid: (info) => {
      goSuccess(info.number, info.orderId);
    },
    onError: (msg) => setError(msg),
  });

  /** Сброс виджета: abandon + разблокировка формы (адрес / корзина). */
  const cancelPaymentAndEdit = useCallback(async () => {
    if (resettingPayment) return;
    setResettingPayment(true);
    setError(null);
    try {
      if (order?.id && payToken) {
        await abandonOrder(order.id, payToken);
      }
      setPayToken(null);
      setOrder(null);
      setOrderFingerprint(null);
      payment.resetPayment();
      idempotencyKeyRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ik-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } finally {
      setResettingPayment(false);
    }
  }, [abandonOrder, order?.id, payToken, payment, resettingPayment]);

  async function startPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!items.length) {
      setError('Корзина пуста');
      return;
    }

    const localErrors = validateCheckoutFields(contact, delivery);
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length) {
      setError('Проверьте поля формы');
      return;
    }

    if (!shippingMeta?.carrier) {
      setError('Выберите службу доставки (СДЭК или Яндекс)');
      return;
    }

    if (shippingCost == null) {
      setError('Не удалось рассчитать стоимость доставки. Выберите адрес снова.');
      return;
    }

    setBusy(true);
    try {
      const syncResult = await syncCart();
      if (!syncResult.ok) {
        setError(
          syncResult.error ||
            'Не удалось синхронизировать корзину. Попробуйте снова.',
        );
        return;
      }
      if (syncResult.removed.length) {
        setError(
          'Часть товаров недоступна и убрана из корзины. Проверьте состав и попробуйте снова.',
        );
        return;
      }

      const fp = checkoutFingerprint;
      let current = order;
      const stale = !current || orderFingerprint !== fp;

      if (stale) {
        if (current?.id) {
          await abandonOrder(current.id, payToken);
        }
        setPayToken(null);
        payment.resetPayment();

        const shippingMethod =
          shippingMeta?.carrier === 'yandex'
            ? 'YANDEX'
            : shippingMeta?.carrier === 'cdek'
              ? 'CDEK'
              : null;
        if (!shippingMethod || shippingCost == null) {
          setError('Не рассчитана стоимость доставки');
          return;
        }

        const shippingAddress = {
          city: delivery.city.trim(),
          address: delivery.address.trim(),
          apartment: delivery.apartment.trim() || undefined,
          postalCode: delivery.postalCode.trim() || undefined,
          comment: shippingMeta
            ? buildJcosAddress2WithMeta(
                shippingMeta,
                delivery.comment.trim(),
              )
            : delivery.comment.trim() || undefined,
        };

        const quoteRes = await fetch('/api/public/orders/shipping-quote', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lines: linesPayload,
            shippingMethod,
            shippingAddress,
            clientEstimate: shippingCost,
          }),
          cache: 'no-store',
        });
        const quoteData = (await quoteRes.json().catch(() => ({}))) as {
          quote?: string;
          method?: string;
          cost?: number;
          message?: string | string[];
        };
        if (!quoteRes.ok || !quoteData.quote) {
          setError(readApiError(quoteData, 'Не удалось получить расчёт доставки'));
          return;
        }

        const res = await fetch('/api/public/orders', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lines: linesPayload,
            email: contact.email.trim(),
            phone: formatPhoneE164(contact.phone),
            customerName: contact.customerName.trim(),
            guestId: getOrCreateGuestId(),
            idempotencyKey: idempotencyKeyRef.current,
            promoCode: promo?.kind === 'promo' ? promo.code : null,
            giftCertificateCode: promo?.kind === 'gift' ? promo.code : null,
            shippingQuote: quoteData.quote,
            shippingMethod: quoteData.method || shippingMethod,
            shippingAddress,
          }),
          cache: 'no-store',
        });
        const data = (await res.json().catch(() => ({}))) as CreatedOrder & {
          message?: string | string[];
        };
        if (!res.ok) {
          setOrder(null);
          setOrderFingerprint(null);
          setPayToken(null);
          const mapped = mapApiFieldErrors(data.message);
          if (Object.keys(mapped).length) setFieldErrors(mapped);
          setError(readApiError(data, 'Не удалось создать заказ'));
          return;
        }
        if (!data.payToken) {
          setError('Сервер не вернул payToken');
          return;
        }
        setFieldErrors({});
        current = data;
        setOrder(data);
        setPayToken(data.payToken);
        setOrderFingerprint(fp);
        if (promo?.kind === 'gift') {
          showToast(GIFT_HOLD_CAPTURED_TOAST, 4500);
        }
      }

      const tokenForPay = (current as CreatedOrder)?.payToken || payToken;
      if (!tokenForPay) {
        setError('Нет токена оплаты — обновите страницу');
        return;
      }

      setPayToken(tokenForPay);
      await payment.startPay(current!.id, tokenForPay);
    } catch {
      setError('Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) {
    return (
      <div className={`padding-global ${styles.loading}`}>
        <p className={styles.muted}>Загрузка…</p>
      </div>
    );
  }

  if (!items.length && !order && !payment.confirmationToken) {
    return (
      <div className={`padding-global ${styles.empty}`}>
        <h1 className={styles.pageTitle}>Оформление заказа</h1>
        <p className={styles.muted}>Корзина пуста</p>
        <Link href="/catalog" className={styles.backLink}>
          В каталог
        </Link>
      </div>
    );
  }

  const showWidget = payment.showWidget;

  return (
    <div className={styles.layout}>
      <div className={styles.formCol}>
        <div className={styles.formInner}>
          <h1 className={styles.pageTitle}>Оформление заказа</h1>

          {!buyerAuthed ? (
            <p className={styles.authHint}>
              Есть аккаунт?{' '}
              <Link href="/login?from=/checkout" className={styles.authHintLink}>
                Войти и оформить
              </Link>
              {' · '}
              гостевой заказ без регистрации
            </p>
          ) : null}

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <form onSubmit={(e) => void startPayment(e)} className={styles.form}>
            <CheckoutContactSection
              values={contact}
              errors={fieldErrors}
              disabled={showWidget}
              emailLocked={buyerAuthed}
              onChange={(patch) => {
                setContact((c) => ({ ...c, ...patch }));
                setFieldErrors((fe) => {
                  const next = { ...fe };
                  for (const k of Object.keys(patch) as (keyof CheckoutContactValues)[]) {
                    delete next[k];
                  }
                  return next;
                });
              }}
            />
            <CheckoutDeliverySection
              values={delivery}
              errors={fieldErrors}
              disabled={showWidget}
              buyerAuthed={buyerAuthed}
              savedAddresses={savedAddresses}
              selectedAddressId={selectedAddressId}
              onSelectSavedAddress={(id) => selectSavedAddressOrEdit(id)}
              onEditAddress={openEditAddressModal}
              onNewAddress={openShippingModal}
              onSelectShipping={openShippingModal}
              shippingLabel={shippingLabel}
            />
            <CheckoutPaySection
              showWidget={showWidget}
              busy={busy}
              resetting={resettingPayment}
              total={payableTotal}
              orderNumber={order?.number}
              confirmationToken={payment.confirmationToken}
              paymentId={payment.paymentId}
              payToken={payment.payToken || payToken}
              giftHoldActive={showWidget && promo?.kind === 'gift'}
              onPaymentSuccess={() => void payment.checkPaid()}
              onPaymentError={() =>
                setError('Ошибка оплаты. Попробуйте ещё раз или обновите страницу.')
              }
              onCancelPayment={() => void cancelPaymentAndEdit()}
            />
          </form>

          <ShippingCarrierModal
            open={shippingModalOpen}
            profileDefaults={profileDefaults}
            seed={
              shippingEditId && addressByIdRef.current.get(shippingEditId)
                ? addressToShippingSeed(
                    addressByIdRef.current.get(shippingEditId)!,
                  )
                : {
                    recipientName:
                      contact.customerName || profileDefaults.recipientName,
                    phone: contact.phone || profileDefaults.phone,
                    city: delivery.city,
                    address: delivery.address,
                    apartment: delivery.apartment,
                    postalCode: delivery.postalCode,
                    comment: delivery.comment,
                    ...(shippingMeta
                      ? {
                          carrier: shippingMeta.carrier,
                          dropoff: shippingMeta.dropoff,
                          lat: shippingMeta.lat,
                          lon: shippingMeta.lon,
                          pvzId: shippingMeta.pvzId,
                        }
                      : {}),
                  }
            }
            onClose={() => {
              setShippingModalOpen(false);
              setShippingEditId(null);
            }}
            onConfirm={(selection) => {
              void persistAndApplyShipping(selection);
            }}
          />
        </div>
      </div>

      <CheckoutSummary
        items={items}
        catalogDiscount={catalogDiscount}
        discountAmount={discountAmount}
        listSubtotal={listSubtotal}
        subtotal={subtotal}
        total={total}
        shippingCost={shippingCost}
        payableTotal={payableTotal}
        promoCode={promo?.code}
        promoKind={promo?.kind ?? null}
        promoInput={promoInput}
        promoError={promoError}
        promoBusy={promoBusy}
        hasPromo={Boolean(promo)}
        disabled={showWidget}
        onPromoInput={(v) => {
          setPromoInput(v);
          setPromoError(undefined);
        }}
        onClearPromo={() => {
          clearPromo();
          setPromoInput('');
          setPromoError(undefined);
        }}
        onApplyPromo={() => {
          void (async () => {
            const code = promoInput.trim();
            if (!code) {
              setPromoError('Введите промокод или сертификат');
              return;
            }
            const result = await applyPromo(code, { shippingRub: shippingCost });
            if (!result.ok) setPromoError(result.message);
            else {
              setPromoError(undefined);
              if (result.kind === 'gift') {
                showToast(GIFT_HOLD_APPLIED_TOAST, 4000);
              }
            }
          })();
        }}
      />
    </div>
  );
}
