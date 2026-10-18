'use client';

import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import type { DeliverySurchargeKind } from '@/lib/deliverySurcharge';
import styles from './delivery.module.css';

type Props = {
  label: string;
  kind: DeliverySurchargeKind;
  onKindChange: (kind: DeliverySurchargeKind) => void;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function DeliverySurchargeField({
  label,
  kind,
  onKindChange,
  value,
  onChange,
  disabled,
}: Props) {
  const valueLabel = kind === 'PERCENT' ? `${label}, %` : `${label}, ₽`;

  return (
    <div className={styles.surchargeField}>
      <span className={styles.surchargeKindLabel}>Добавочная стоимость</span>
      <div className={styles.surchargeKindRow} role="radiogroup" aria-label="Тип добавочной стоимости">
        <label className={styles.surchargeKindOption}>
          <input
            type="radio"
            name={`${label}-kind`}
            checked={kind === 'FIXED'}
            disabled={disabled}
            onChange={() => onKindChange('FIXED')}
          />
          Фикс, ₽
        </label>
        <label className={styles.surchargeKindOption}>
          <input
            type="radio"
            name={`${label}-kind`}
            checked={kind === 'PERCENT'}
            disabled={disabled}
            onChange={() => onKindChange('PERCENT')}
          />
          Процент, %
        </label>
      </div>
      <AdminTextField
        label={valueLabel}
        type="number"
        inputMode="numeric"
        min={0}
        max={kind === 'PERCENT' ? 100 : 500000}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={styles.hint}>
        Плюсуется к тарифу на checkout
        {kind === 'PERCENT' ? ' (от рассчитанной стоимости доставки)' : ''}. Отдельной строкой
        покупателю не показывается.
      </p>
    </div>
  );
}
