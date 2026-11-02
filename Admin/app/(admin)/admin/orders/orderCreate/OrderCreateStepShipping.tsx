'use client';

import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import type { ShippingDraft } from './types';
import { orderCreateStyles as styles } from './styles';

export function OrderCreateStepShipping({
  shipping,
  costDraft,
  estimating,
  estimateHint,
  onOpenCarrier,
  onCostDraft,
}: {
  shipping: ShippingDraft | null;
  costDraft: string;
  estimating: boolean;
  estimateHint: string | null;
  onOpenCarrier: () => void;
  onCostDraft: (raw: string) => void;
}) {
  return (
    <div className={styles.wizardStack}>
      {shipping ? (
        <>
          <div className={styles.wizardShippingCard}>
            <div>
              <strong>
                {shipping.shippingMethod} ·{' '}
                {shipping.selection.dropoff === 'pvz' ? 'ПВЗ' : 'Курьер'}
              </strong>
              <p className={styles.wizardHint}>
                {shipping.address.city}, {shipping.address.address}
                {shipping.address.pvzCode
                  ? ` · ПВЗ ${shipping.address.pvzCode}`
                  : ''}
              </p>
            </div>
            <AdminCompactBtn type="button" variant="outline" onClick={onOpenCarrier}>
              Изменить
            </AdminCompactBtn>
          </div>
          <AdminTextField
            label="Стоимость доставки ₽"
            type="number"
            min={0}
            max={500000}
            value={costDraft}
            onChange={(e) => onCostDraft(e.target.value)}
            disabled={estimating}
          />
          {estimateHint ? (
            <p className={styles.wizardHint}>{estimateHint}</p>
          ) : null}
        </>
      ) : (
        <AdminCompactBtn type="button" variant="accent" onClick={onOpenCarrier}>
          Выбрать доставку (СДЭК / Ozon / Яндекс)
        </AdminCompactBtn>
      )}
    </div>
  );
}
