'use client';

import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTextArea, AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { PhoneField } from '@/components/PhoneField/PhoneField';
import type { Step1FieldErrors } from './helpers';
import type { ClientMode } from './types';
import { orderCreateStyles as styles } from './styles';

export function OrderCreateStepClient({
  clientMode,
  userId,
  userLabelText,
  email,
  phone,
  customerName,
  customerNote,
  fieldErrors,
  onGuest,
  onPickUser,
  onClearUser,
  onEmail,
  onPhone,
  onCustomerName,
  onCustomerNote,
}: {
  clientMode: ClientMode;
  userId: string | null;
  userLabelText: string;
  email: string;
  phone: string;
  customerName: string;
  customerNote: string;
  fieldErrors?: Step1FieldErrors | null;
  onGuest: () => void;
  onPickUser: () => void;
  onClearUser: () => void;
  onEmail: (v: string) => void;
  onPhone: (v: string) => void;
  onCustomerName: (v: string) => void;
  onCustomerNote: (v: string) => void;
}) {
  const err = fieldErrors ?? {};
  return (
    <div className={styles.wizardStack}>
      <div
        role="radiogroup"
        aria-label="Тип клиента"
        className={styles.wizardModeRow}
      >
        <AdminCompactBtn
          type="button"
          role="radio"
          aria-checked={clientMode === 'guest'}
          aria-pressed={clientMode === 'guest'}
          variant={clientMode === 'guest' ? 'accent' : 'outline'}
          onClick={onGuest}
        >
          Гость
        </AdminCompactBtn>
        <AdminCompactBtn
          type="button"
          role="radio"
          aria-checked={clientMode === 'user'}
          aria-pressed={clientMode === 'user'}
          variant={clientMode === 'user' ? 'accent' : 'outline'}
          onClick={onPickUser}
        >
          Существующий пользователь
        </AdminCompactBtn>
      </div>
      {clientMode === 'user' ? (
        userId ? (
          <p className={styles.wizardHint}>
            Пользователь: <strong>{userLabelText}</strong>{' '}
            <button type="button" className={styles.linkBtn} onClick={onClearUser}>
              сбросить
            </button>
          </p>
        ) : (
          <p
            className={err.userId ? styles.wizardError : styles.wizardHint}
            role={err.userId ? 'alert' : 'status'}
          >
            {err.userId ||
              'Режим «пользователь»: выберите запись из списка — иначе заказ не привяжется.'}
          </p>
        )
      ) : null}
      <AdminTextField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => onEmail(e.target.value)}
        autoComplete="email"
        error={err.email}
      />
      <PhoneField
        label="Телефон"
        value={phone}
        onChange={onPhone}
        error={err.phone}
      />
      <AdminTextField
        label="Имя"
        value={customerName}
        onChange={(e) => onCustomerName(e.target.value)}
        error={err.customerName}
      />
      <AdminTextArea
        label="Комментарий клиента (опционально)"
        value={customerNote}
        onChange={(e) => onCustomerNote(e.target.value)}
        rows={3}
      />
    </div>
  );
}
