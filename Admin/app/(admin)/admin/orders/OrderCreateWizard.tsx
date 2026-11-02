'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import {
  ShippingCarrierModal,
  type ShippingSelection,
} from '@/components/shipping/ShippingCarrierModal';
import { VariantPickerModal } from '@/app/(admin)/admin/settings/gratitude/VariantPickerModal';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminMoney } from '@/lib/adminFormat';
import type { AdminRetailUser, AdminRetailUserDetail } from '@/lib/adminUserTypes';
import { buildJcosAddress2WithMeta } from '@/lib/shipping/addressShippingMeta';
import { estimateShippingCostRub } from '@/lib/shipping/estimateShippingCost';
import { formatPhoneE164 } from '@/lib/phone';
import {
  clearOrderCreateDraft,
  loadOrderCreateDraft,
  saveOrderCreateDraft,
  type OrderCreateDraftV1,
} from './orderCreate/draftStorage';
import { GiftDenomPickerModal } from './orderCreate/GiftDenomPickerModal';
import {
  canGoNextFromReason,
  catalogGiftMixBlockedReason,
  draftLineFromGiftDenom,
  draftLineMergeKey,
  giftOnlyShippingStub,
  isGiftOnlyDraftLines,
  newIdempotencyKey,
  newLineKey,
  nextWizardStep,
  prevWizardStep,
  resolveCreateOrderUiFollowUp,
  step1FieldErrors,
  stepNextBlockedReason,
  userLabel,
} from './orderCreate/helpers';
import type { VariantPickerApplyDetails } from '@/app/(admin)/admin/settings/gratitude/VariantPickerModal';
import { OrderCreateStepClient } from './orderCreate/OrderCreateStepClient';
import { OrderCreateStepConfirm } from './orderCreate/OrderCreateStepConfirm';
import { OrderCreateStepDiscounts } from './orderCreate/OrderCreateStepDiscounts';
import {
  OrderCreateStepItems,
  unitPriceAfterPercent,
} from './orderCreate/OrderCreateStepItems';
import { OrderCreateStepShipping } from './orderCreate/OrderCreateStepShipping';
import { orderCreateStyles as styles } from './orderCreate/styles';
import type {
  AdminOrderPreview,
  ClientMode,
  DraftLine,
  OrderCreateStepId,
  PayMode,
  ShippingDraft,
} from './orderCreate/types';
import { ORDER_CREATE_STEPS } from './orderCreate/types';
import { UserPickerModal } from './orderCreate/UserPickerModal';

export function OrderCreateWizard({
  canOrdersFinance = false,
}: {
  canOrdersFinance?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<OrderCreateStepId>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef(newIdempotencyKey());
  const [draftPrompt, setDraftPrompt] = useState<OrderCreateDraftV1 | null>(
    null,
  );
  const draftHydratedRef = useRef(false);
  const [showStep1Errors, setShowStep1Errors] = useState(false);

  const [clientMode, setClientMode] = useState<ClientMode>('guest');
  const [userId, setUserId] = useState<string | null>(null);
  const [userLabelText, setUserLabelText] = useState('');
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerNote, setCustomerNote] = useState('');

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [giftDenomPickerOpen, setGiftDenomPickerOpen] = useState(false);
  const [attachGratitude, setAttachGratitude] = useState(true);
  const [linePctDraft, setLinePctDraft] = useState<Record<string, string>>({});

  const [promoCode, setPromoCode] = useState('');
  const [giftCertificateCode, setGiftCertificateCode] = useState('');
  const [discountPreview, setDiscountPreview] = useState<string | null>(null);

  const [shipping, setShipping] = useState<ShippingDraft | null>(null);
  const [carrierOpen, setCarrierOpen] = useState(false);
  const [costDraft, setCostDraft] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimateHint, setEstimateHint] = useState<string | null>(null);

  const [payMode, setPayMode] = useState<PayMode>('awaiting_link');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [affiliateOpen, setAffiliateOpen] = useState(false);
  const [refHash, setRefHash] = useState('');
  const [extUserId, setExtUserId] = useState('');

  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [paymentLinkDialog, setPaymentLinkDialog] = useState<{
    orderId: string;
    number: string;
    url: string;
  } | null>(null);
  const [followUpDialog, setFollowUpDialog] = useState<{
    orderId: string;
    number: string;
    message: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [preview, setPreview] = useState<AdminOrderPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!canOrdersFinance && payMode === 'mark_paid') {
      setPayMode('awaiting_link');
    }
  }, [canOrdersFinance, payMode]);

  const goodsSubtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [lines],
  );

  const giftOnly = useMemo(() => isGiftOnlyDraftLines(lines), [lines]);

  const step1Errors = useMemo(
    () =>
      step1FieldErrors({
        clientMode,
        userId,
        customerName,
        email,
        phone,
      }),
    [clientMode, userId, customerName, email, phone],
  );

  const currentStepMeta = useMemo(
    () => ORDER_CREATE_STEPS.find((s) => s.id === step) ?? ORDER_CREATE_STEPS[0],
    [step],
  );

  const dirty = useMemo(() => {
    return Boolean(
      email.trim() ||
        phone.trim() ||
        customerName.trim() ||
        customerNote.trim() ||
        userId ||
        lines.length ||
        promoCode.trim() ||
        giftCertificateCode.trim() ||
        shipping ||
        refHash.trim() ||
        extUserId.trim(),
    );
  }, [
    email,
    phone,
    customerName,
    customerNote,
    userId,
    lines,
    promoCode,
    giftCertificateCode,
    shipping,
    refHash,
    extUserId,
  ]);

  useEffect(() => {
    if (draftHydratedRef.current) return;
    draftHydratedRef.current = true;
    const existing = loadOrderCreateDraft();
    if (existing) setDraftPrompt(existing);
  }, []);

  useEffect(() => {
    if (!dirty || submitted || draftPrompt) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, submitted, draftPrompt]);

  useEffect(() => {
    if (!dirty || submitted || draftPrompt) return;
    const t = window.setTimeout(() => {
      saveOrderCreateDraft({
        v: 1,
        savedAt: Date.now(),
        step,
        clientMode,
        userId,
        userLabelText,
        email,
        phone,
        customerName,
        customerNote,
        lines,
        attachGratitude,
        promoCode,
        giftCertificateCode,
        shipping,
        payMode,
        notifyCustomer,
        refHash,
        extUserId,
        idempotencyKey: idempotencyKeyRef.current,
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    dirty,
    submitted,
    draftPrompt,
    step,
    clientMode,
    userId,
    userLabelText,
    email,
    phone,
    customerName,
    customerNote,
    lines,
    attachGratitude,
    promoCode,
    giftCertificateCode,
    shipping,
    payMode,
    notifyCustomer,
    refHash,
    extUserId,
  ]);

  const nextBlockedReason = useMemo(
    () =>
      stepNextBlockedReason({
        step,
        clientMode,
        userId,
        customerName,
        email,
        phone,
        lines,
        promoCode,
        giftCertificateCode,
        shipping,
        giftOnly,
        previewBusy,
        previewError,
        hasPreview: Boolean(preview),
      }),
    [
      step,
      clientMode,
      userId,
      customerName,
      email,
      phone,
      lines,
      promoCode,
      giftCertificateCode,
      shipping,
      giftOnly,
      previewBusy,
      previewError,
      preview,
    ],
  );

  function applyDraft(d: OrderCreateDraftV1) {
    setStep(d.step);
    setClientMode(d.clientMode);
    setUserId(d.userId);
    setUserLabelText(d.userLabelText);
    setEmail(d.email);
    setPhone(d.phone);
    setCustomerName(d.customerName);
    setCustomerNote(d.customerNote);
    setLines(
      d.lines.map((l) => ({
        ...l,
        shadeId: l.shadeId ?? null,
        shadeName: l.shadeName ?? null,
      })),
    );
    setAttachGratitude(d.attachGratitude);
    setPromoCode(d.promoCode);
    setGiftCertificateCode(d.giftCertificateCode);
    setShipping(d.shipping);
    if (d.shipping) setCostDraft(String(d.shipping.shippingCost));
    setPayMode(
      !canOrdersFinance && d.payMode === 'mark_paid' ? 'awaiting_link' : d.payMode,
    );
    setNotifyCustomer(d.notifyCustomer);
    setRefHash(d.refHash);
    setExtUserId(d.extUserId);
    if (d.idempotencyKey?.length >= 8) {
      idempotencyKeyRef.current = d.idempotencyKey;
    }
    setDraftPrompt(null);
  }

  function discardDraftPrompt() {
    clearOrderCreateDraft();
    setDraftPrompt(null);
  }

  function clearUser() {
    setUserId(null);
    setUserLabelText('');
    setClientMode('guest');
  }

  async function pickUser(u: AdminRetailUser) {
    setUserId(u.id);
    setUserLabelText(userLabel(u));
    setClientMode('user');
    setEmail(u.email);
    setCustomerName(u.displayName?.trim() || '');
    setUserPickerOpen(false);
    try {
      const detail = await adminBackendJson<AdminRetailUserDetail>(
        `users/admin/${u.id}?ordersPage=1&ordersLimit=1`,
      );
      if (detail.phone) setPhone(detail.phone);
      if (detail.displayName?.trim()) setCustomerName(detail.displayName.trim());
    } catch {
      /* email/name already set */
    }
  }

  function openCatalogPicker() {
    const blocked = catalogGiftMixBlockedReason(lines, 'catalog');
    if (blocked) {
      setError(blocked);
      return;
    }
    setError(null);
    setVariantPickerOpen(true);
  }

  function openGiftDenomPicker() {
    const blocked = catalogGiftMixBlockedReason(lines, 'gift');
    if (blocked) {
      setError(blocked);
      return;
    }
    setError(null);
    setGiftDenomPickerOpen(true);
  }

  function addVariant(
    variantId: string,
    label: string,
    details?: VariantPickerApplyDetails,
  ) {
    const mix = catalogGiftMixBlockedReason(lines, 'catalog');
    if (mix) {
      setError(mix);
      setVariantPickerOpen(false);
      return;
    }
    const catalogPrice = Math.max(0, Math.round(details?.price ?? 0));
    const shadeId = details?.shadeId ?? null;
    const shadeName = details?.shadeName ?? null;
    const mergeKey = draftLineMergeKey(variantId, shadeId);
    setLines((prev) => {
      const existing = prev.find(
        (l) => draftLineMergeKey(l.variantId, l.shadeId) === mergeKey,
      );
      if (existing) {
        return prev.map((l) =>
          draftLineMergeKey(l.variantId, l.shadeId) === mergeKey
            ? { ...l, qty: l.qty + 1 }
            : l,
        );
      }
      return [
        ...prev,
        {
          key: newLineKey(),
          variantId,
          shadeId,
          shadeName,
          title: details?.title || label,
          sku: details?.sku || '',
          catalogPrice,
          unitPrice: catalogPrice,
          qty: 1,
        },
      ];
    });
    setError(null);
    setVariantPickerOpen(false);
  }

  function addGiftDenom(denom: {
    id: string;
    name: string;
    faceValue: number;
  }) {
    const mix = catalogGiftMixBlockedReason(lines, 'gift');
    if (mix) {
      setError(mix);
      setGiftDenomPickerOpen(false);
      return;
    }
    const row = draftLineFromGiftDenom(denom);
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === row.variantId);
      if (existing) {
        return prev.map((l) =>
          l.variantId === row.variantId ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [...prev, row];
    });
    setError(null);
    setGiftDenomPickerOpen(false);
  }

  async function onCarrierConfirm(selection: ShippingSelection) {
    if (selection.dropoff === 'pvz' && !selection.pvzId?.trim()) {
      setError('Выберите пункт выдачи (ПВЗ)');
      return;
    }
    setError(null);
    setEstimating(true);
    setEstimateHint(null);
    let cost = 0;
    try {
      const estimated = await estimateShippingCostRub(selection);
      if (estimated != null && estimated >= 0) {
        cost = estimated;
        setEstimateHint(
          'Ориентир по тарифу перевозчика — можно задать любую сумму.',
        );
      } else {
        setEstimateHint(
          'Автооценку получить не удалось — укажите стоимость вручную.',
        );
      }
    } catch {
      setEstimateHint(
        'Автооценку получить не удалось — укажите стоимость вручную.',
      );
    } finally {
      setEstimating(false);
    }

    const comment = buildJcosAddress2WithMeta(
      {
        carrier: selection.carrier,
        dropoff: selection.dropoff,
        ...(selection.lat != null ? { lat: selection.lat } : {}),
        ...(selection.lon != null ? { lon: selection.lon } : {}),
        ...(selection.pvzId ? { pvzId: selection.pvzId } : {}),
        ...(selection.cityCode?.trim()
          ? { cid: selection.cityCode.trim() }
          : {}),
        ...(selection.countryCode ? { cc: selection.countryCode } : {}),
      },
      selection.comment,
    );

    const draft: ShippingDraft = {
      selection,
      shippingCost: cost,
      shippingMethod:
        selection.carrier === 'yandex'
          ? 'YANDEX'
          : selection.carrier === 'ozon'
            ? 'OZON'
            : 'CDEK',
      address: {
        city: selection.city.trim(),
        address: selection.address.trim(),
        apartment: selection.apartment.trim(),
        region: selection.region?.trim() || '',
        district: selection.district?.trim() || '',
        postalCode: selection.postalCode.trim(),
        phone: selection.phone.trim(),
        recipientName: selection.recipientName.trim(),
        pvzCode:
          selection.dropoff === 'pvz' ? selection.pvzId?.trim() || '' : '',
        comment,
      },
    };
    setShipping(draft);
    setCostDraft(String(cost));
    setCarrierOpen(false);
  }

  function setShippingCostDraft(raw: string) {
    setCostDraft(raw);
    const n = Math.max(0, Math.min(500_000, Math.round(Number(raw) || 0)));
    setShipping((s) => (s ? { ...s, shippingCost: n } : s));
  }

  function buildPayload(opts?: { allowMissingShipping?: boolean }) {
    const allowMissingShipping = Boolean(opts?.allowMissingShipping);
    if (!shipping && !allowMissingShipping && !giftOnly) return null;
    return {
      lines: lines.map((l) => ({
        variantId: l.variantId,
        ...(l.shadeId ? { shadeId: l.shadeId } : {}),
        qty: l.qty,
        ...(l.unitPrice !== l.catalogPrice ? { unitPrice: l.unitPrice } : {}),
      })),
      email: email.trim().toLowerCase(),
      phone: formatPhoneE164(phone),
      customerName: customerName.trim(),
      customerNote: customerNote.trim() || null,
      userId: clientMode === 'user' && userId ? userId : null,
      promoCode: promoCode.trim() || null,
      giftCertificateCode: giftCertificateCode.trim() || null,
      ...(shipping
        ? {
            shippingAddress: shipping.address,
            shippingMethod: shipping.shippingMethod,
            shippingCost: shipping.shippingCost,
          }
        : giftOnly
          ? {
              shippingAddress: giftOnlyShippingStub(),
              shippingCost: 0,
            }
          : {}),
      ...(allowMissingShipping && !shipping && !giftOnly
        ? { previewAllowMissingShipping: true }
        : {}),
      attachGratitude: giftOnly ? false : attachGratitude,
      payMode,
      notifyCustomer,
      idempotencyKey: idempotencyKeyRef.current,
      affiliate:
        refHash.trim() || extUserId.trim()
          ? {
              refHash: refHash.trim() || null,
              extUserId: extUserId.trim() || null,
            }
          : null,
    };
  }

  async function runServerPreview(opts?: {
    allowMissingShipping?: boolean;
  }): Promise<{
    preview: AdminOrderPreview | null;
    error: string | null;
  }> {
    const body = buildPayload(opts);
    if (!body) return { preview: null, error: 'Нет данных доставки' };
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const res = await adminBackendJson<AdminOrderPreview>(
        'orders/admin/preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      setPreview(res);
      return { preview: res, error: null };
    } catch (e) {
      const msg =
        e instanceof AdminBackendRequestError
          ? e.message
          : 'Не удалось пересчитать итог';
      setPreview(null);
      setPreviewError(msg);
      return { preview: null, error: msg };
    } finally {
      setPreviewBusy(false);
    }
  }

  async function previewDiscount() {
    setDiscountPreview(null);
    const promo = promoCode.trim();
    const gift = giftCertificateCode.trim();
    if (promo && gift) {
      setDiscountPreview('Промокод и сертификат взаимоисключающи');
      return;
    }
    if (!promo && !gift) {
      setDiscountPreview('Скидка не задана');
      return;
    }
    const { preview: res, error } = await runServerPreview({
      allowMissingShipping: true,
    });
    if (!res) {
      setDiscountPreview(error || 'Не удалось проверить скидку');
      return;
    }
    const shipNote = shipping
      ? ''
      : ' (без доставки — итог уточнится на шаге 4)';
    if (res.promoCode) {
      setDiscountPreview(
        `Промо ${res.promoCode}: −${formatAdminMoney(res.discountTotal)} → итог ${formatAdminMoney(res.total)}${shipNote}`,
      );
      return;
    }
    if (res.giftCertificateCode) {
      setDiscountPreview(
        `Сертификат ${res.giftCertificateCode}: −${formatAdminMoney(res.giftCertificateAmount)} → итог ${formatAdminMoney(res.total)}${shipNote}`,
      );
      return;
    }
    setDiscountPreview(
      `Итог без скидки: ${formatAdminMoney(res.total)}${shipNote}`,
    );
  }

  useEffect(() => {
    if (step !== 5 || (!shipping && !giftOnly)) return;
    if (
      stepNextBlockedReason({
        step: 2,
        clientMode,
        userId,
        customerName,
        email,
        phone,
        lines,
        promoCode,
        giftCertificateCode,
        shipping,
        giftOnly,
      })
    ) {
      return;
    }
    void runServerPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh confirm totals
  }, [
    step,
    shipping,
    giftOnly,
    lines,
    promoCode,
    giftCertificateCode,
    attachGratitude,
    email,
    phone,
    customerName,
    userId,
    payMode,
  ]);

  async function submit() {
    if ((!shipping && !giftOnly) || nextBlockedReason) return;
    if (submitLockRef.current || busy) return;
    submitLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = buildPayload();
      if (!body) return;

      const res = await adminBackendJson<{
        order: { id: string; number: string };
        paymentLink: string | null;
        paymentError?: string | null;
      }>('orders/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setSubmitted(true);
      clearOrderCreateDraft();
      const follow = resolveCreateOrderUiFollowUp({
        payMode,
        orderId: res.order.id,
        orderNumber: res.order.number,
        paymentLink: res.paymentLink,
        paymentError: res.paymentError,
      });
      if (follow.kind === 'payment_link') {
        setCopied(false);
        setPaymentLinkDialog({
          orderId: follow.orderId,
          number: follow.number,
          url: follow.url,
        });
      } else if (follow.kind === 'follow_up') {
        setFollowUpDialog({
          orderId: follow.orderId,
          number: follow.number,
          message: follow.message,
        });
      } else {
        router.push(`/admin/orders/${follow.orderId}`);
      }
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError
          ? e.message
          : 'Не удалось создать заказ',
      );
      submitLockRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  function goToCreatedOrder(orderId: string) {
    router.push(`/admin/orders/${orderId}`);
  }

  return (
    <>
      <div className={styles.wizardHeader}>
        <div>
          <h1 className={styles.title}>Новый заказ</h1>
          <p className={styles.wizardLead}>
            Пошаговое оформление почти как на витрине
          </p>
        </div>
        <AdminCompactBtnLink href="/admin/orders" variant="outline">
          К списку
        </AdminCompactBtnLink>
      </div>

      <nav className={styles.wizardSteps} aria-label="Шаги создания заказа">
        {ORDER_CREATE_STEPS.map((s) => {
          const skippedShipping = giftOnly && s.id === 4;
          return (
            <button
              key={s.id}
              type="button"
              className={`${styles.wizardStep} ${
                step === s.id ? styles.wizardStepActive : ''
              } ${step > s.id || skippedShipping ? styles.wizardStepDone : ''}`}
              disabled={s.id > step || skippedShipping}
              aria-current={step === s.id ? 'step' : undefined}
              title={
                skippedShipping
                  ? 'Доставка не нужна для электронных сертификатов'
                  : undefined
              }
              onClick={() => {
                if (skippedShipping) return;
                if (s.id < step) setStep(s.id);
              }}
            >
              <span className={styles.wizardStepNum}>{s.id}</span>
              {skippedShipping ? 'Доставка (пропуск)' : s.label}
            </button>
          );
        })}
      </nav>

      {error ? (
        <p className={styles.wizardError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.wizardPanel} aria-labelledby="order-create-step-title">
        <h2 id="order-create-step-title" className={styles.wizardPanelTitle}>
          Шаг {currentStepMeta.id} · {currentStepMeta.label}
        </h2>
        {step === 1 ? (
          <OrderCreateStepClient
            clientMode={clientMode}
            userId={userId}
            userLabelText={userLabelText}
            email={email}
            phone={phone}
            customerName={customerName}
            customerNote={customerNote}
            fieldErrors={showStep1Errors ? step1Errors : null}
            onGuest={clearUser}
            onPickUser={() => {
              setClientMode('user');
              setUserPickerOpen(true);
            }}
            onClearUser={clearUser}
            onEmail={setEmail}
            onPhone={setPhone}
            onCustomerName={setCustomerName}
            onCustomerNote={setCustomerNote}
          />
        ) : null}

        {step === 2 ? (
          <OrderCreateStepItems
            lines={lines}
            linePctDraft={linePctDraft}
            attachGratitude={attachGratitude}
            giftOnly={giftOnly}
            goodsSubtotal={goodsSubtotal}
            onAddFromCatalog={openCatalogPicker}
            onAddGiftDenom={openGiftDenomPicker}
            onChangeQty={(key, qty) =>
              setLines((prev) =>
                prev.map((x) => (x.key === key ? { ...x, qty } : x)),
              )
            }
            onChangeUnitPrice={(key, unitPrice) =>
              setLines((prev) =>
                prev.map((x) => (x.key === key ? { ...x, unitPrice } : x)),
              )
            }
            onApplyPercent={(key, pct) => {
              setLines((prev) =>
                prev.map((x) =>
                  x.key === key
                    ? {
                        ...x,
                        unitPrice: unitPriceAfterPercent(x.catalogPrice, pct),
                      }
                    : x,
                ),
              );
              setLinePctDraft((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }}
            onRemove={(key) =>
              setLines((prev) => prev.filter((x) => x.key !== key))
            }
            onResetPrice={(key) =>
              setLines((prev) =>
                prev.map((x) =>
                  x.key === key ? { ...x, unitPrice: x.catalogPrice } : x,
                ),
              )
            }
            onLinePctDraft={(key, raw) =>
              setLinePctDraft((prev) => ({ ...prev, [key]: raw }))
            }
            onAttachGratitude={setAttachGratitude}
          />
        ) : null}

        {step === 3 ? (
          <OrderCreateStepDiscounts
            promoCode={promoCode}
            giftCertificateCode={giftCertificateCode}
            discountPreview={discountPreview}
            previewBusy={previewBusy}
            onPromoCode={(v) => {
              setPromoCode(v);
              if (v.trim()) setGiftCertificateCode('');
            }}
            onGiftCertificateCode={(v) => {
              setGiftCertificateCode(v);
              if (v.trim()) setPromoCode('');
            }}
            onPreview={() => void previewDiscount()}
          />
        ) : null}

        {step === 4 ? (
          giftOnly ? (
            <div className={styles.wizardStack}>
              <p className={styles.wizardHint}>
                В корзине только электронные сертификаты — доставка не нужна.
              </p>
            </div>
          ) : (
            <OrderCreateStepShipping
              shipping={shipping}
              costDraft={costDraft}
              estimating={estimating}
              estimateHint={estimateHint}
              onOpenCarrier={() => setCarrierOpen(true)}
              onCostDraft={setShippingCostDraft}
            />
          )
        ) : null}

        {step === 5 ? (
          <OrderCreateStepConfirm
            customerName={customerName}
            email={email}
            phone={phone}
            userId={userId}
            lines={lines}
            attachGratitude={giftOnly ? false : attachGratitude}
            promoCode={promoCode}
            giftCertificateCode={giftCertificateCode}
            shipping={shipping}
            giftOnly={giftOnly}
            preview={preview}
            previewBusy={previewBusy}
            previewError={previewError}
            canOrdersFinance={canOrdersFinance}
            payMode={payMode}
            notifyCustomer={notifyCustomer}
            affiliateOpen={affiliateOpen}
            refHash={refHash}
            extUserId={extUserId}
            onPayMode={setPayMode}
            onNotifyCustomer={setNotifyCustomer}
            onToggleAffiliate={() => setAffiliateOpen((v) => !v)}
            onRefHash={setRefHash}
            onExtUserId={setExtUserId}
          />
        ) : null}
      </div>

      <div className={styles.wizardFooterSticky}>
        {nextBlockedReason ? (
          <p className={styles.wizardNextHint} role="status">
            {nextBlockedReason}
          </p>
        ) : null}
        <div className={styles.wizardFooter}>
          <AdminCompactBtn
            type="button"
            variant="outline"
            onClick={() => {
              if (dirty) setCancelConfirm(true);
              else router.push('/admin/orders');
            }}
            disabled={busy}
          >
            Отмена
          </AdminCompactBtn>
          <div className={styles.wizardFooterRight}>
            {step > 1 ? (
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => setStep((s) => prevWizardStep(s, giftOnly))}
                disabled={busy}
              >
                Назад
              </AdminCompactBtn>
            ) : null}
            {step < 5 ? (
              <AdminCompactBtn
                type="button"
                variant="accent"
                disabled={
                  busy ||
                  (step !== 1 && !canGoNextFromReason(nextBlockedReason))
                }
                title={nextBlockedReason ?? undefined}
                onClick={() => {
                  if (nextBlockedReason) {
                    if (step === 1) setShowStep1Errors(true);
                    return;
                  }
                  setShowStep1Errors(false);
                  setStep((s) => nextWizardStep(s, giftOnly));
                }}
              >
                Далее
              </AdminCompactBtn>
            ) : (
              <AdminCompactBtn
                type="button"
                variant="accent"
                disabled={busy || Boolean(nextBlockedReason)}
                title={nextBlockedReason ?? undefined}
                onClick={() => void submit()}
              >
                {busy ? 'Создание…' : 'Создать заказ'}
              </AdminCompactBtn>
            )}
          </div>
        </div>
      </div>

      <UserPickerModal
        open={userPickerOpen}
        onClose={() => setUserPickerOpen(false)}
        onPick={(u) => void pickUser(u)}
      />

      <VariantPickerModal
        open={variantPickerOpen}
        selectedVariantId=""
        selectedLabel=""
        onClose={() => setVariantPickerOpen(false)}
        onApply={addVariant}
      />

      <GiftDenomPickerModal
        open={giftDenomPickerOpen}
        onClose={() => setGiftDenomPickerOpen(false)}
        onPick={addGiftDenom}
      />

      <ShippingCarrierModal
        open={carrierOpen}
        closeAfterConfirm={false}
        profileDefaults={{
          recipientName: customerName || undefined,
          phone: phone || undefined,
        }}
        seed={
          shipping
            ? { ...shipping.selection }
            : { recipientName: customerName, phone }
        }
        onClose={() => setCarrierOpen(false)}
        onConfirm={(sel) => void onCarrierConfirm(sel)}
      />

      <AdminModal
        open={cancelConfirm}
        title="Отменить создание?"
        onClose={() => setCancelConfirm(false)}
        footer={
          <AdminModalActions
            onCancel={() => setCancelConfirm(false)}
            onConfirm={() => {
              clearOrderCreateDraft();
              router.push('/admin/orders');
            }}
            confirmLabel="Да, к списку"
            cancelLabel="Продолжить"
          />
        }
      >
        <p>
          Несохранённые данные и черновик будут удалены — при следующем входе
          resume не предложится.
        </p>
      </AdminModal>

      <AdminModal
        open={Boolean(paymentLinkDialog)}
        title="Ссылка на оплату"
        onClose={() => {
          if (paymentLinkDialog) goToCreatedOrder(paymentLinkDialog.orderId);
        }}
        footer={
          paymentLinkDialog ? (
            <>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(paymentLinkDialog.url);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? 'Скопировано' : 'Скопировать'}
              </AdminCompactBtn>
              <AdminCompactBtn
                type="button"
                variant="outline"
                onClick={() => {
                  window.open(
                    paymentLinkDialog.url,
                    '_blank',
                    'noopener,noreferrer',
                  );
                }}
              >
                Открыть
              </AdminCompactBtn>
              <AdminCompactBtn
                type="button"
                variant="accent"
                onClick={() => goToCreatedOrder(paymentLinkDialog.orderId)}
              >
                К заказу
              </AdminCompactBtn>
            </>
          ) : null
        }
      >
        {paymentLinkDialog ? (
          <div className={styles.wizardStack}>
            <p>
              Заказ {paymentLinkDialog.number} создан. Скопируйте или откройте
              ссылку для клиента:
            </p>
            <code className={styles.wizardPayLink}>{paymentLinkDialog.url}</code>
          </div>
        ) : null}
      </AdminModal>

      <AdminModal
        open={Boolean(followUpDialog)}
        title="Заказ создан"
        onClose={() => {
          if (followUpDialog) goToCreatedOrder(followUpDialog.orderId);
        }}
        footer={
          <AdminModalActions
            onCancel={() => {
              if (followUpDialog) goToCreatedOrder(followUpDialog.orderId);
            }}
            onConfirm={() => {
              if (followUpDialog) goToCreatedOrder(followUpDialog.orderId);
            }}
            confirmLabel="К заказу"
            cancelLabel="Закрыть"
          />
        }
      >
        {followUpDialog ? (
          <div className={styles.wizardStack}>
            <p>
              Заказ {followUpDialog.number} уже создан. Оплату / ссылку завершите
              в карточке — повторное создание даст дубль.
            </p>
            <p className={styles.wizardError} role="status">
              {followUpDialog.message}
            </p>
          </div>
        ) : null}
      </AdminModal>

      <AdminModal
        open={Boolean(draftPrompt)}
        title="Черновик заказа"
        onClose={discardDraftPrompt}
        footer={
          <AdminModalActions
            onCancel={discardDraftPrompt}
            onConfirm={() => {
              if (draftPrompt) applyDraft(draftPrompt);
            }}
            confirmLabel="Продолжить"
            cancelLabel="Начать заново"
          />
        }
      >
        {draftPrompt ? (
          <p>
            Найден несохранённый черновик
            {draftPrompt.customerName.trim()
              ? ` («${draftPrompt.customerName.trim()}»)`
              : ''}
            {draftPrompt.lines.length
              ? `, позиций: ${draftPrompt.lines.length}`
              : ''}
            . Продолжить с того же места?
          </p>
        ) : null}
      </AdminModal>
    </>
  );
}
