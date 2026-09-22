'use client';

import { useEffect, useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from './orders.module.css';

const styles = { ...catalogStyles, ...orderStyles };

export function OrderShippingCostEditModal({
  open,
  shippingCost,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  shippingCost: number;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: {
    shippingCost: number;
    notifyCustomer: boolean;
  }) => Promise<void>;
}) {
  const [cost, setCost] = useState('0');
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  useEffect(() => {
    if (!open) return;
    setCost(String(Math.max(0, Math.round(shippingCost ?? 0))));
    setNotifyCustomer(true);
  }, [open, shippingCost]);

  async function save() {
    const shippingCostNum = Math.max(
      0,
      Math.min(500_000, Math.round(Number(cost) || 0)),
    );
    await onSave({ shippingCost: shippingCostNum, notifyCustomer });
  }

  return (
    <AdminModal
      open={open}
      title="Стоимость доставки"
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={() => void save()}
          confirmLabel={busy ? 'Сохранение…' : 'Сохранить'}
          confirmDisabled={busy}
        />
      }
    >
      <div className={styles.orderAddressConfirm}>
        <p className={styles.muted} style={{ marginTop: 0, marginBottom: 12 }}>
          Можно указать любую сумму в рублях (0–500&nbsp;000). Итог заказа
          пересчитается; адрес и тариф не меняются.
        </p>
        <AdminTextField
          label="Стоимость доставки, ₽"
          value={cost}
          onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ''))}
          disabled={busy}
          inputMode="numeric"
        />
        <div className={styles.labelCheckboxRow} style={{ marginTop: 14 }}>
          <AdminCheckbox
            id="order-shipping-cost-notify"
            className={styles.adminCheckboxForm}
            checked={notifyCustomer}
            onChange={(e) => setNotifyCustomer(e.target.checked)}
            disabled={busy}
          />
          <label htmlFor="order-shipping-cost-notify">
            Уведомить покупателя по email
          </label>
        </div>
      </div>
    </AdminModal>
  );
}
