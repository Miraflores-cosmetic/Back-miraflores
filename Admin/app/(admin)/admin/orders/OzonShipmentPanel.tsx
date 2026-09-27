'use client';

import { useMemo, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import type { AdminOrderDetail } from '@/lib/adminOrderTypes';
import { OZON_CABINET_URL, ozonShipmentBlockers } from '@/lib/shipping/ozonFulfillment';
import styles from './orders.module.css';

const SHIPPED = new Set(['SHIPPED', 'DELIVERED']);

/**
 * «Отправка» для заказа Ozon: создать отправление из админки нельзя (у API Ozon Доставки
 * нет метода), поэтому шаги ручные — кабинет Ozon → трек → «Заказ отправлен».
 */
export function OzonShipmentPanel({
  order,
  tracking,
  onOpenChecklist,
}: {
  order: AdminOrderDetail;
  tracking: string;
  onOpenChecklist: () => void;
}) {
  const blockers = useMemo(() => ozonShipmentBlockers(order), [order]);
  const savedTrack = order.shipments?.[0]?.tracking?.trim() || '';
  const shipped = SHIPPED.has(order.status);
  const notified = order.events.some((e) => e.type === 'TRACKING_SENT');
  const steps = [
    { id: 'cabinet', done: Boolean(tracking.trim() || savedTrack), cabinet: true },
    { id: 'track', done: Boolean(savedTrack) || (Boolean(tracking.trim()) && !shipped) },
    { id: 'ship', done: shipped && notified },
  ];

  return (
    <div className={styles.ozonManualPanel} role="note">
      <p className={styles.ozonManualTitle}>Автосоздание отправления Ozon недоступно</p>
      <p className={styles.orderHint}>
        Ozon не даёт создать отправление из админки. Оформите его в кабинете продавца — пункт выдачи
        выбирайте по ID из блока «Доставка».
      </p>
      <ol className={styles.ozonManualSteps}>
        <li className={steps[0].done ? styles.ozonManualStepDone : undefined}>
          Создайте отправление в кабинете Ozon{' '}
          <a className={styles.orderInlineLink} href={OZON_CABINET_URL} target="_blank" rel="noopener noreferrer">
            Открыть кабинет ↗
          </a>
        </li>
        <li className={steps[1].done ? styles.ozonManualStepDone : undefined}>
          Вставьте номер отправления Ozon в «Трек»
        </li>
        <li className={steps[2].done ? styles.ozonManualStepDone : undefined}>
          «Заказ отправлен» → «Отправить трек-номер»
        </li>
      </ol>
      {blockers.length ? (
        <ul className={styles.ozonBlockers}>
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      <AdminCompactBtn type="button" variant="outline" onClick={onOpenChecklist}>
        Данные для формы и чеклист
      </AdminCompactBtn>
    </div>
  );
}

/** Факт списания Ozon за отправление — копится для сверки тарифной сетки. */
export function OzonCarrierCostForm({
  shipment,
  busy,
  onSave,
}: {
  shipment: AdminOrderDetail['shipments'][number];
  busy: boolean;
  onSave: (carrierCostRub: number) => void;
}) {
  const [editing, setEditing] = useState(shipment.carrierCostRub == null);
  const [value, setValue] = useState(shipment.carrierCostRub != null ? String(shipment.carrierCostRub) : '');
  const parsed = Number(value.replace(',', '.'));
  const valid = Number.isInteger(parsed) && parsed > 0 && parsed <= 1_000_000;

  if (!editing && shipment.carrierCostRub != null) {
    const est = shipment.estimatedCostRub;
    const delta = est ? Math.round(((shipment.carrierCostRub - est) / est) * 100) : null;
    return (
      <span className={styles.ozonCostRow}>
        Стоимость у Ozon: <strong>{shipment.carrierCostRub} ₽</strong>
        {est != null ? (
          <span className={styles.orderMetaMuted}>
            {' '}
            · по сетке {est} ₽{delta ? ` (${delta > 0 ? '+' : ''}${delta}%)` : ''}
          </span>
        ) : null}
        <button type="button" className={styles.ozonCopyBtn} disabled={busy} onClick={() => setEditing(true)}>
          Изменить
        </button>
      </span>
    );
  }

  return (
    <form
      className={styles.ozonCostRow}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(parsed);
      }}
    >
      <label className={styles.orderMetaMuted} htmlFor={`ozon-cost-${shipment.id}`}>
        Стоимость у Ozon, ₽
      </label>
      <input
        id={`ozon-cost-${shipment.id}`}
        className={styles.ozonCostInput}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        placeholder="из кабинета"
        disabled={busy}
      />
      <button type="submit" className={styles.ozonCopyBtn} disabled={busy || !valid}>
        Сохранить
      </button>
      {shipment.carrierCostRub != null ? (
        <button type="button" className={styles.ozonCopyBtn} disabled={busy} onClick={() => setEditing(false)}>
          Отмена
        </button>
      ) : null}
    </form>
  );
}
