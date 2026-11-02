'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import {
  AdminModal,
  AdminModalActions,
} from '@/components/admin/AdminModal/AdminModal';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { VariantPickerModal } from '@/app/(admin)/admin/settings/gratitude/VariantPickerModal';
import type { AdminOrderItem } from '@/lib/adminOrderTypes';
import { formatAdminMoney } from '@/lib/adminFormat';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from './orders.module.css';
import {
  PCT_PRESETS,
  applyPercentOffLines,
  buildItemsSavePayload,
  estimateAfterItemsEdit,
  matchingPresetPct,
  type OrderItemsSavePayload,
} from './orderItemsEditHelpers';

const styles = { ...catalogStyles, ...orderStyles };

export type { OrderItemsSavePayload };

export type DraftOrderLine = {
  key: string;
  variantId: string | null;
  shadeId: string | null;
  shadeName: string | null;
  title: string;
  sku: string;
  qty: number;
  unitPrice: number;
  /** Цена на момент открытия модалки — % считается от неё, без накопления. */
  originalUnitPrice: number;
  isGratitudeGift?: boolean;
};

function toDraft(items: AdminOrderItem[]): DraftOrderLine[] {
  return items.map((i, idx) => {
    const gift = Boolean(i.isGratitudeGift);
    const price = gift ? 0 : i.unitPrice;
    return {
      key: i.id || `line-${idx}`,
      variantId: i.variantId ?? null,
      shadeId: i.shadeId ?? null,
      shadeName: i.shadeName ?? null,
      title: i.title,
      sku: i.sku,
      qty: i.qty,
      unitPrice: price,
      originalUnitPrice: price,
      isGratitudeGift: gift,
    };
  });
}

function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

export type OrderItemsPricingSnapshot = {
  discountTotal: number;
  giftCertificateAmount: number;
  shippingCost: number;
  netPaid: number;
  currentTotal: number;
  promoCode?: string | null;
};

export function OrderItemsEditModal({
  open,
  initialItems,
  busy,
  hasPromoOrGift,
  pricing,
  onClose,
  onSave,
}: {
  open: boolean;
  initialItems: AdminOrderItem[];
  busy: boolean;
  /** Промо/сертификат — бэкенд clamp'ит суммы при урезании состава. */
  hasPromoOrGift?: boolean;
  pricing: OrderItemsPricingSnapshot;
  onClose: () => void;
  onSave: (payload: OrderItemsSavePayload) => Promise<void>;
}) {
  const [lines, setLines] = useState<DraftOrderLine[]>([]);
  const [baselineSubtotal, setBaselineSubtotal] = useState(0);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkPct, setBulkPct] = useState('10');
  const [linePctDraft, setLinePctDraft] = useState<Record<string, string>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmMeta, setConfirmMeta] = useState<{
    lines: DraftOrderLine[];
    delta: number;
    nextSubtotal: number;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const persistLockRef = useRef(false);

  // Snapshot only when the modal opens — ignore soft-poll item refreshes while open.
  useEffect(() => {
    if (!open) return;
    const draft = toDraft(initialItems);
    setLines(draft);
    setBaselineSubtotal(
      draft.reduce((s, l) => s + l.originalUnitPrice * l.qty, 0),
    );
    setNotifyCustomer(true);
    setPickerOpen(false);
    setBulkPct('10');
    setLinePctDraft({});
    setQtyDraft({});
    setPriceDraft({});
    setSaveError(null);
    setConfirmMeta(null);
    setConfirmBusy(false);
    persistLockRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-only snapshot
  }, [open]);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [lines],
  );

  const subtotalDelta = subtotal - baselineSubtotal;
  const editablePriceLines = useMemo(
    () => lines.filter((l) => !l.isGratitudeGift),
    [lines],
  );

  const hasActivePromo =
    Boolean(pricing.promoCode) || pricing.discountTotal > 0;
  const anyLinePriceCut = useMemo(
    () =>
      lines.some(
        (l) =>
          !l.isGratitudeGift && l.unitPrice < l.originalUnitPrice,
      ),
    [lines],
  );
  const dualDiscountWarn = hasActivePromo && anyLinePriceCut;

  const estimate = useMemo(
    () =>
      estimateAfterItemsEdit({
        subtotal,
        discountTotal: pricing.discountTotal,
        giftCertificateAmount: pricing.giftCertificateAmount,
        shippingCost: pricing.shippingCost,
        netPaid: pricing.netPaid,
      }),
    [subtotal, pricing],
  );

  const bulkPressedPct = useMemo(() => {
    if (!editablePriceLines.length) return null;
    const first = matchingPresetPct(
      editablePriceLines[0].originalUnitPrice,
      editablePriceLines[0].unitPrice,
    );
    if (first == null) return null;
    return editablePriceLines.every(
      (l) =>
        matchingPresetPct(l.originalUnitPrice, l.unitPrice) === first,
    )
      ? first
      : null;
  }, [editablePriceLines]);

  function handleClose() {
    if (busy || confirmBusy || confirmMeta) return;
    onClose();
  }

  function updateLine(key: string, patch: Partial<DraftOrderLine>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(key: string) {
    if (busy) return;
    setLines((prev) => prev.filter((l) => l.key !== key));
    setLinePctDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setQtyDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPriceDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function commitQty(key: string) {
    const raw = qtyDraft[key];
    if (raw === undefined) return;
    const n = Math.max(1, Math.round(Number(raw)) || 1);
    updateLine(key, { qty: n });
    setQtyDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function commitPrice(key: string) {
    const raw = priceDraft[key];
    if (raw === undefined) return;
    const line = lines.find((l) => l.key === key);
    if (line?.isGratitudeGift) {
      setPriceDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const n = Math.max(0, Math.round(Number(raw)) || 0);
    updateLine(key, { unitPrice: n });
    setPriceDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** Зафиксировать все открытые draft перед расчётом/сохранением. */
  function flushDrafts(): DraftOrderLine[] {
    const nextQty = { ...qtyDraft };
    const nextPrice = { ...priceDraft };
    const flushed = lines.map((l) => {
      let qty = l.qty;
      let unitPrice = l.unitPrice;
      if (nextQty[l.key] !== undefined) {
        qty = Math.max(1, Math.round(Number(nextQty[l.key])) || 1);
        delete nextQty[l.key];
      }
      if (!l.isGratitudeGift && nextPrice[l.key] !== undefined) {
        unitPrice = Math.max(0, Math.round(Number(nextPrice[l.key])) || 0);
        delete nextPrice[l.key];
      }
      if (l.isGratitudeGift) unitPrice = 0;
      return { ...l, qty, unitPrice };
    });
    setQtyDraft({});
    setPriceDraft({});
    setLines(flushed);
    return flushed;
  }

  function applyPercentToLine(key: string, pct: number) {
    if (busy || !(pct > 0)) return;
    setLines((prev) => applyPercentOffLines(prev, pct, key));
  }

  function applyBulkPercent(pct: number) {
    if (busy || !(pct > 0) || !editablePriceLines.length) return;
    setLines((prev) => applyPercentOffLines(prev, pct));
  }

  function resetLinePrice(key: string) {
    if (busy) return;
    setLines((prev) =>
      prev.map((l) =>
        l.key === key && !l.isGratitudeGift
          ? { ...l, unitPrice: l.originalUnitPrice }
          : l,
      ),
    );
  }

  async function persist(from: DraftOrderLine[]) {
    if (!from.length || busy || persistLockRef.current) return;
    persistLockRef.current = true;
    setConfirmBusy(true);
    setSaveError(null);
    try {
      await onSave(buildItemsSavePayload(from, notifyCustomer));
      // Confirm закрываем только после успеха — иначе staff заново жмёт «Сохранить».
      setConfirmMeta(null);
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message.trim()
          ? e.message
          : 'Не удалось сохранить состав',
      );
    } finally {
      persistLockRef.current = false;
      setConfirmBusy(false);
    }
  }

  function applyCustomPct(raw: string, onlyKey?: string) {
    const pct = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(pct) || !(pct > 0)) return;
    if (onlyKey) applyPercentToLine(onlyKey, pct);
    else applyBulkPercent(pct);
  }

  function requestSave() {
    if (!lines.length || busy || confirmBusy || persistLockRef.current) return;
    const flushed = flushDrafts();
    if (!flushed.length) return;
    const nextSubtotal = flushed.reduce(
      (s, l) => s + l.unitPrice * l.qty,
      0,
    );
    const delta = nextSubtotal - baselineSubtotal;
    if (delta !== 0) {
      setConfirmMeta({ lines: flushed, delta, nextSubtotal });
      return;
    }
    void persist(flushed);
  }

  const confirmEstimate = confirmMeta
    ? estimateAfterItemsEdit({
        subtotal: confirmMeta.nextSubtotal,
        discountTotal: pricing.discountTotal,
        giftCertificateAmount: pricing.giftCertificateAmount,
        shippingCost: pricing.shippingCost,
        netPaid: pricing.netPaid,
      })
    : null;

  const confirmMessage = confirmMeta
    ? [
        confirmMeta.delta > 0
          ? `Товары: ${formatAdminMoney(baselineSubtotal)} → ${formatAdminMoney(confirmMeta.nextSubtotal)} (+${formatAdminMoney(confirmMeta.delta)}).`
          : `Товары: ${formatAdminMoney(baselineSubtotal)} → ${formatAdminMoney(confirmMeta.nextSubtotal)} (−${formatAdminMoney(Math.abs(confirmMeta.delta))}).`,
        confirmEstimate
          ? `Итого заказа ≈ ${formatAdminMoney(confirmEstimate.total)} (сейчас ${formatAdminMoney(pricing.currentTotal)}).`
          : null,
        confirmEstimate && confirmEstimate.balanceDue > 0
          ? `Ожидается доплата ≈ ${formatAdminMoney(confirmEstimate.balanceDue)}.`
          : confirmEstimate && confirmEstimate.refundSuggested > 0
            ? `Ожидается возврат ≈ ${formatAdminMoney(confirmEstimate.refundSuggested)}.`
            : 'Переплата/недоплата не ожидаются.',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <>
      <AdminModal
        open={open}
        title="Изменить состав"
        wide
        onClose={handleClose}
        closeDisabled={busy || confirmBusy || Boolean(confirmMeta)}
        footer={
          <AdminModalActions
            onCancel={handleClose}
            onConfirm={() => requestSave()}
            confirmLabel={busy || confirmBusy ? 'Сохранение…' : 'Сохранить'}
            confirmDisabled={
              busy || confirmBusy || lines.length === 0 || Boolean(confirmMeta)
            }
            cancelDisabled={busy || confirmBusy || Boolean(confirmMeta)}
          />
        }
      >
        {saveError ? (
          <p className={styles.error} role="alert" style={{ marginTop: 0 }}>
            {saveError}
          </p>
        ) : null}

        <div className={styles.itemsEditToolbar}>
          <AdminCompactBtn
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setPickerOpen(true)}
          >
            Добавить из каталога
          </AdminCompactBtn>

          <div className={styles.itemsEditBulk}>
            <span className={styles.itemsEditBulkLabel}>
              Скидка на все (кроме подарков)
            </span>
            <div className={styles.itemsEditPctRow}>
              {PCT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles.itemsEditPctBtn}
                  disabled={busy || editablePriceLines.length === 0}
                  aria-pressed={bulkPressedPct === p}
                  aria-label={`Скидка ${p}% на все позиции`}
                  onClick={() => applyBulkPercent(p)}
                >
                  −{p}%
                </button>
              ))}
              <AdminTextField
                label="Скидка %"
                inputMode="decimal"
                value={bulkPct}
                disabled={busy || editablePriceLines.length === 0}
                className={styles.itemsEditPctField}
                aria-label="Своя скидка в процентах на все позиции"
                onChange={(e) =>
                  setBulkPct(e.target.value.replace(/[^\d.,]/g, ''))
                }
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  applyCustomPct(bulkPct);
                }}
              />
              <AdminCompactBtn
                type="button"
                variant="outline"
                disabled={busy || editablePriceLines.length === 0}
                onClick={() => applyCustomPct(bulkPct)}
              >
                Применить
              </AdminCompactBtn>
            </div>
          </div>
        </div>

        {hasPromoOrGift ? (
          <p className={styles.muted} style={{ marginTop: 0, marginBottom: 12 }}>
            На заказе есть промокод или подарочный сертификат: после сохранения
            скидка и сумма сертификата будут ограничены новым составом (и
            доставкой).
          </p>
        ) : null}

        {dualDiscountWarn ? (
          <p className={styles.itemsEditDualWarn} role="status">
            Внимание: вы снижаете цены позиций (−%), а на заказе ещё действует
            промокод
            {pricing.promoCode ? ` «${pricing.promoCode}»` : ''}
            {pricing.discountTotal > 0
              ? ` (−${formatAdminMoney(pricing.discountTotal)})`
              : ''}
            . Скидка по промокоду останется и сложится с уценкой строк. Если
            нужен только один способ скидки — снимите промокод или не меняйте
            цены.
          </p>
        ) : null}

        {lines.length === 0 ? (
          <p className={styles.muted}>Добавьте хотя бы одну позицию</p>
        ) : (
          <ul className={styles.itemsEditList}>
            {lines.map((l) => {
              const lineTotal = l.unitPrice * l.qty;
              const gift = Boolean(l.isGratitudeGift);
              const priceChanged =
                !gift && l.unitPrice !== l.originalUnitPrice;
              const pctOff =
                !gift && l.originalUnitPrice > 0
                  ? Math.round(
                      (1 - l.unitPrice / l.originalUnitPrice) * 1000,
                    ) / 10
                  : 0;
              const draftPct = linePctDraft[l.key] ?? '';
              const qtyValue =
                qtyDraft[l.key] !== undefined
                  ? qtyDraft[l.key]
                  : String(l.qty);
              const priceValue =
                priceDraft[l.key] !== undefined
                  ? priceDraft[l.key]
                  : String(l.unitPrice);
              const linePressedPct = gift
                ? null
                : matchingPresetPct(l.originalUnitPrice, l.unitPrice);
              const lineLabel = l.title.trim() || l.sku || 'позиция';

              return (
                <li key={l.key} className={styles.itemsEditCard}>
                  <div className={styles.itemsEditCardHead}>
                    <div className={styles.itemsEditCardTitle}>
                      <div>{l.title}</div>
                      <span className={styles.mutedInline}>{l.sku}</span>
                      {l.shadeName || l.shadeId ? (
                        <div className={styles.mutedInline}>
                          Оттенок: {l.shadeName || l.shadeId}
                        </div>
                      ) : null}
                      {gift ? (
                        <div className={styles.mutedInline}>
                          Подарок благодарности · цена 0 ₽
                        </div>
                      ) : null}
                    </div>
                    <AdminCompactBtn
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => removeLine(l.key)}
                    >
                      Убрать
                    </AdminCompactBtn>
                  </div>

                  <div className={styles.itemsEditFields}>
                    <AdminTextField
                      label="Кол-во"
                      inputMode="numeric"
                      value={qtyValue}
                      disabled={busy}
                      className={styles.itemsEditQtyField}
                      aria-label={`Количество · ${lineLabel}`}
                      onChange={(e) =>
                        setQtyDraft((prev) => ({
                          ...prev,
                          [l.key]: digitsOnly(e.target.value),
                        }))
                      }
                      onBlur={() => commitQty(l.key)}
                    />
                    <AdminTextField
                      label="Цена, ₽"
                      inputMode="numeric"
                      value={priceValue}
                      disabled={busy || gift}
                      className={styles.itemsEditPriceField}
                      aria-label={`Цена · ${lineLabel}`}
                      onChange={(e) => {
                        if (gift) return;
                        setPriceDraft((prev) => ({
                          ...prev,
                          [l.key]: digitsOnly(e.target.value),
                        }));
                      }}
                      onBlur={() => commitPrice(l.key)}
                    />
                    <div className={styles.itemsEditLineSum}>
                      <span className={styles.itemsEditLineSumLabel}>Сумма</span>
                      <span className={styles.itemsEditLineSumValue}>
                        {formatAdminMoney(lineTotal)}
                      </span>
                    </div>
                  </div>

                  {gift ? (
                    <p className={styles.itemsEditPriceHint}>
                      Цена подарка благодарности зафиксирована: 0 ₽.
                    </p>
                  ) : (
                    <div className={styles.itemsEditPriceTools}>
                      <span className={styles.itemsEditBulkLabel}>Цена −%</span>
                      <div className={styles.itemsEditPctRow}>
                        {PCT_PRESETS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={styles.itemsEditPctBtn}
                            disabled={busy}
                            aria-pressed={linePressedPct === p}
                            aria-label={`Скидка ${p}% · ${lineLabel}`}
                            onClick={() => applyPercentToLine(l.key, p)}
                          >
                            −{p}%
                          </button>
                        ))}
                        <AdminTextField
                          label="%"
                          inputMode="decimal"
                          value={draftPct}
                          disabled={busy}
                          className={styles.itemsEditPctField}
                          placeholder="%"
                          aria-label={`Своя скидка в процентах · ${lineLabel}`}
                          onChange={(e) =>
                            setLinePctDraft((prev) => ({
                              ...prev,
                              [l.key]: e.target.value.replace(/[^\d.,]/g, ''),
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            applyCustomPct(draftPct, l.key);
                          }}
                        />
                        <AdminCompactBtn
                          type="button"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Применить скидку % · ${lineLabel}`}
                          onClick={() => applyCustomPct(draftPct, l.key)}
                        >
                          Применить
                        </AdminCompactBtn>
                        {priceChanged ? (
                          <AdminCompactBtn
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => resetLinePrice(l.key)}
                          >
                            Сбросить
                          </AdminCompactBtn>
                        ) : null}
                      </div>
                      {priceChanged ? (
                        <p className={styles.itemsEditPriceHint}>
                          Было {formatAdminMoney(l.originalUnitPrice)}
                          {' → '}
                          {formatAdminMoney(l.unitPrice)}
                          {pctOff > 0
                            ? ` (−${pctOff}%)`
                            : pctOff < 0
                              ? ` (+${Math.abs(pctOff)}%)`
                              : ''}
                          {' · % от цены при открытии'}
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className={styles.itemsEditSummary}>
          <div className={styles.itemsEditPreview} aria-live="polite">
            <div className={styles.itemsEditPreviewRow}>
              <span>Товары</span>
              <span>
                {formatAdminMoney(subtotal)}
                {subtotalDelta !== 0 ? (
                  <span className={styles.mutedInline}>
                    {' '}
                    ({subtotalDelta > 0 ? '+' : ''}
                    {formatAdminMoney(subtotalDelta)})
                  </span>
                ) : null}
              </span>
            </div>
            {pricing.discountTotal > 0 || estimate.discount > 0 ? (
              <div className={styles.itemsEditPreviewRow}>
                <span>
                  Промо
                  {pricing.promoCode ? ` «${pricing.promoCode}»` : ''}
                  {estimate.discountClamped ? ' · по составу' : ''}
                </span>
                <span>−{formatAdminMoney(estimate.discount)}</span>
              </div>
            ) : null}
            {pricing.giftCertificateAmount > 0 || estimate.gift > 0 ? (
              <div className={styles.itemsEditPreviewRow}>
                <span>
                  Сертификат
                  {estimate.giftClamped ? ' · по составу' : ''}
                </span>
                <span>−{formatAdminMoney(estimate.gift)}</span>
              </div>
            ) : null}
            <div className={styles.itemsEditPreviewRow}>
              <span>Доставка</span>
              <span>{formatAdminMoney(estimate.shipping)}</span>
            </div>
            <div
              className={`${styles.itemsEditPreviewRow} ${styles.itemsEditPreviewRowTotal}`}
            >
              <span>Итого ≈</span>
              <span>
                {formatAdminMoney(estimate.total)}
                {estimate.total !== pricing.currentTotal ? (
                  <span className={styles.mutedInline}>
                    {' '}
                    (сейчас {formatAdminMoney(pricing.currentTotal)})
                  </span>
                ) : null}
              </span>
            </div>
            {estimate.balanceDue > 0 ? (
              <div
                className={`${styles.itemsEditPreviewRow} ${styles.itemsEditPreviewSettle}`}
              >
                <span>Доплата ≈</span>
                <span>{formatAdminMoney(estimate.balanceDue)}</span>
              </div>
            ) : null}
            {estimate.refundSuggested > 0 ? (
              <div
                className={`${styles.itemsEditPreviewRow} ${styles.itemsEditPreviewSettle}`}
              >
                <span>Возврат ≈</span>
                <span>{formatAdminMoney(estimate.refundSuggested)}</span>
              </div>
            ) : null}
          </div>
          <p className={styles.muted} style={{ margin: '8px 0 0' }}>
            Оценка до сохранения: промо и сертификат подстроятся под новый
            состав. При изменении суммы попросим подтверждение.
          </p>
        </div>

        <div className={styles.labelCheckboxRow} style={{ marginTop: 12 }}>
          <AdminCheckbox
            id="order-items-notify"
            className={styles.adminCheckboxForm}
            checked={notifyCustomer}
            disabled={busy}
            onChange={(e) => setNotifyCustomer(e.target.checked)}
          />
          <label htmlFor="order-items-notify">Уведомить клиента письмом</label>
        </div>
      </AdminModal>

      <AdminConfirmDialog
        open={Boolean(confirmMeta)}
        title="Подтвердить изменение суммы"
        message={confirmMessage}
        confirmLabel={busy || confirmBusy ? 'Сохранение…' : 'Сохранить'}
        danger={(confirmMeta?.delta ?? 0) < 0}
        busy={busy || confirmBusy}
        onCancel={() => {
          if (!busy && !confirmBusy) setConfirmMeta(null);
        }}
        onConfirm={() => {
          if (!confirmMeta || persistLockRef.current || busy || confirmBusy) {
            return;
          }
          void persist(confirmMeta.lines);
        }}
      >
        {saveError ? (
          <p className={styles.error} role="alert" style={{ margin: 0 }}>
            {saveError}
          </p>
        ) : null}
      </AdminConfirmDialog>

      <VariantPickerModal
        open={pickerOpen}
        selectedVariantId=""
        selectedLabel=""
        onClose={() => setPickerOpen(false)}
        onApply={(variantId, label, details) => {
          const price = details?.price ?? 0;
          setLines((prev) => [
            ...prev,
            {
              key: `new-${variantId}-${Date.now()}`,
              variantId,
              shadeId: null,
              shadeName: null,
              title: details?.title || label,
              sku: details?.sku || '—',
              qty: 1,
              unitPrice: price,
              originalUnitPrice: price,
            },
          ]);
        }}
      />
    </>
  );
}
