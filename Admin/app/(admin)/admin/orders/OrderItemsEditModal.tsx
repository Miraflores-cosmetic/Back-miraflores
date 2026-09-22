'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { VariantPickerModal } from '@/app/(admin)/admin/settings/gratitude/VariantPickerModal';
import type { AdminOrderItem } from '@/lib/adminOrderTypes';
import { formatAdminMoney } from '@/lib/adminFormat';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from './orders.module.css';

const styles = { ...catalogStyles, ...orderStyles };

export type DraftOrderLine = {
  key: string;
  variantId: string | null;
  shadeId: string | null;
  shadeName: string | null;
  title: string;
  sku: string;
  qty: number;
  unitPrice: number;
  isGratitudeGift?: boolean;
};

function toDraft(items: AdminOrderItem[]): DraftOrderLine[] {
  return items.map((i, idx) => ({
    key: i.id || `line-${idx}`,
    variantId: i.variantId ?? null,
    shadeId: i.shadeId ?? null,
    shadeName: i.shadeName ?? null,
    title: i.title,
    sku: i.sku,
    qty: i.qty,
    unitPrice: i.unitPrice,
    isGratitudeGift: Boolean(i.isGratitudeGift),
  }));
}

export type OrderItemsSavePayload = {
  items: Array<{
    variantId: string | null;
    shadeId?: string | null;
    qty: number;
    unitPrice: number;
    title: string;
    sku: string;
    isGratitudeGift?: boolean;
  }>;
  notifyCustomer: boolean;
};

export function OrderItemsEditModal({
  open,
  initialItems,
  busy,
  hasPromoOrGift,
  onClose,
  onSave,
}: {
  open: boolean;
  initialItems: AdminOrderItem[];
  busy: boolean;
  /** Промо/сертификат — бэкенд clamp'ит суммы при урезании состава. */
  hasPromoOrGift?: boolean;
  onClose: () => void;
  onSave: (payload: OrderItemsSavePayload) => Promise<void>;
}) {
  const [lines, setLines] = useState<DraftOrderLine[]>([]);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Snapshot only when the modal opens — ignore soft-poll item refreshes while open.
  useEffect(() => {
    if (!open) return;
    setLines(toDraft(initialItems));
    setNotifyCustomer(true);
    setPickerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-only snapshot
  }, [open]);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [lines],
  );

  function handleClose() {
    if (busy) return;
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
  }

  async function save() {
    if (!lines.length || busy) return;
    await onSave({
      items: lines.map((l) => ({
        variantId: l.variantId,
        shadeId: l.shadeId,
        qty: Math.max(1, Math.round(l.qty) || 1),
        unitPrice: Math.max(0, Math.round(l.unitPrice) || 0),
        title: l.title,
        sku: l.sku,
        isGratitudeGift: l.isGratitudeGift,
      })),
      notifyCustomer,
    });
  }

  return (
    <>
      <AdminModal
        open={open}
        title="Изменить состав"
        wide
        onClose={handleClose}
        footer={
          <AdminModalActions
            onCancel={handleClose}
            onConfirm={() => void save()}
            confirmLabel={busy ? 'Сохранение…' : 'Сохранить'}
            confirmDisabled={busy || lines.length === 0}
          />
        }
      >
        <div style={{ marginBottom: 12 }}>
          <AdminCompactBtn
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setPickerOpen(true)}
          >
            Добавить из каталога
          </AdminCompactBtn>
        </div>

        {hasPromoOrGift ? (
          <p className={styles.muted} style={{ marginTop: 0, marginBottom: 12 }}>
            На заказе есть промокод или подарочный сертификат: после сохранения
            скидка и сумма сертификата будут ограничены новым составом (и
            доставкой).
          </p>
        ) : null}

        {lines.length === 0 ? (
          <p className={styles.muted}>Добавьте хотя бы одну позицию</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <div>{l.title}</div>
                      <span className={styles.mutedInline}>{l.sku}</span>
                      {l.shadeName || l.shadeId ? (
                        <div className={styles.mutedInline}>
                          Оттенок: {l.shadeName || l.shadeId}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ width: 88 }}>
                      <AdminTextField
                        label="Кол-во"
                        value={String(l.qty)}
                        disabled={busy}
                        onChange={(e) =>
                          updateLine(l.key, {
                            qty: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                      />
                    </td>
                    <td style={{ width: 110 }}>
                      <AdminTextField
                        label="Цена"
                        value={String(l.unitPrice)}
                        disabled={busy}
                        onChange={(e) =>
                          updateLine(l.key, {
                            unitPrice: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                      />
                    </td>
                    <td>{formatAdminMoney(l.unitPrice * l.qty)}</td>
                    <td>
                      <AdminCompactBtn
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => removeLine(l.key)}
                      >
                        Убрать
                      </AdminCompactBtn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.muted} style={{ marginTop: 12 }}>
          Товары (без доставки/скидок): {formatAdminMoney(subtotal)}
        </p>

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

      <VariantPickerModal
        open={pickerOpen}
        selectedVariantId=""
        selectedLabel=""
        onClose={() => setPickerOpen(false)}
        onApply={(variantId, label, details) => {
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
              unitPrice: details?.price ?? 0,
            },
          ]);
        }}
      />
    </>
  );
}
