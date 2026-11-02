'use client';

import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { orderCreateStyles as styles } from './styles';

export function OrderCreateStepDiscounts({
  promoCode,
  giftCertificateCode,
  discountPreview,
  previewBusy = false,
  onPromoCode,
  onGiftCertificateCode,
  onPreview,
}: {
  promoCode: string;
  giftCertificateCode: string;
  discountPreview: string | null;
  previewBusy?: boolean;
  onPromoCode: (v: string) => void;
  onGiftCertificateCode: (v: string) => void;
  onPreview: () => void;
}) {
  return (
    <div className={styles.wizardStack}>
      <p className={styles.wizardHint}>
        Промокод или подарочный сертификат — не оба сразу. Оба поля можно оставить
        пустыми.
      </p>
      <AdminTextField
        label="Промокод"
        value={promoCode}
        onChange={(e) => onPromoCode(e.target.value)}
        disabled={Boolean(giftCertificateCode.trim()) || previewBusy}
      />
      <AdminTextField
        label="Подарочный сертификат"
        value={giftCertificateCode}
        onChange={(e) => onGiftCertificateCode(e.target.value)}
        disabled={Boolean(promoCode.trim()) || previewBusy}
      />
      <AdminCompactBtn
        type="button"
        variant="outline"
        onClick={onPreview}
        disabled={previewBusy}
        aria-busy={previewBusy}
      >
        {previewBusy ? 'Проверяем…' : 'Проверить скидку'}
      </AdminCompactBtn>
      {discountPreview ? (
        <p className={styles.wizardHint} role="status">
          {discountPreview}
        </p>
      ) : null}
    </div>
  );
}
