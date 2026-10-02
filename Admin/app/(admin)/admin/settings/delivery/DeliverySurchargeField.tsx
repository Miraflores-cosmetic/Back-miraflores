'use client';

import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import styles from './delivery.module.css';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function DeliverySurchargeField({ label, value, onChange, disabled }: Props) {
  return (
    <div className={styles.surchargeField}>
      <AdminTextField
        label={label}
        type="number"
        inputMode="numeric"
        min={0}
        max={500000}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={styles.hint}>
        Плюсуется к тарифу на checkout. Отдельной строкой покупателю не показывается.
      </p>
    </div>
  );
}
