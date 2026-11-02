'use client';

import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import { formatAdminMoney } from '@/lib/adminFormat';
import type {
  AdminOrderPreview,
  DraftLine,
  PayMode,
  ShippingDraft,
} from './types';
import { orderCreateStyles as styles } from './styles';

const PAY_MODE_OPTIONS: Array<{
  value: PayMode;
  label: string;
  help: string;
  financeOnly?: boolean;
}> = [
  {
    value: 'awaiting_link',
    label: 'Ссылка на оплату',
    help: 'Создадим заказ и сразу выпустим ссылку ЮKassa — можно скопировать или открыть клиенту.',
  },
  {
    value: 'mark_paid',
    label: 'Сразу оплачен',
    help: 'Заказ сразу в статусе «оплачен» без платёжной ссылки (оплата вне кассы / перевод).',
    financeOnly: true,
  },
  {
    value: 'awaiting',
    label: 'Ждёт оплаты без ссылки',
    help: 'Заказ останется «ожидает оплаты»; ссылку можно выпустить позже из карточки заказа.',
  },
];

export function OrderCreateStepConfirm({
  customerName,
  email,
  phone,
  userId,
  lines,
  attachGratitude,
  promoCode,
  giftCertificateCode,
  shipping,
  giftOnly = false,
  preview,
  previewBusy,
  previewError,
  canOrdersFinance,
  payMode,
  notifyCustomer,
  affiliateOpen,
  refHash,
  extUserId,
  onPayMode,
  onNotifyCustomer,
  onToggleAffiliate,
  onRefHash,
  onExtUserId,
}: {
  customerName: string;
  email: string;
  phone: string;
  userId: string | null;
  lines: DraftLine[];
  attachGratitude: boolean;
  promoCode: string;
  giftCertificateCode: string;
  shipping: ShippingDraft | null;
  giftOnly?: boolean;
  preview: AdminOrderPreview | null;
  previewBusy: boolean;
  previewError: string | null;
  canOrdersFinance: boolean;
  payMode: PayMode;
  notifyCustomer: boolean;
  affiliateOpen: boolean;
  refHash: string;
  extUserId: string;
  onPayMode: (v: PayMode) => void;
  onNotifyCustomer: (v: boolean) => void;
  onToggleAffiliate: () => void;
  onRefHash: (v: string) => void;
  onExtUserId: (v: string) => void;
}) {
  return (
    <div className={styles.wizardStack}>
      <section className={styles.wizardSummary}>
        <h2 className={styles.wizardSummaryTitle}>Клиент</h2>
        <p>
          {customerName} · {email} · {phone}
          {userId ? ' · аккаунт в магазине' : ' · гость'}
        </p>
      </section>
      <section className={styles.wizardSummary}>
        <h2 className={styles.wizardSummaryTitle}>Позиции</h2>
        <ul className={styles.wizardLineList}>
          {lines.map((l) => (
            <li key={l.key}>
              {l.title} × {l.qty} — {formatAdminMoney(l.unitPrice * l.qty)}
            </li>
          ))}
        </ul>
        <p className={styles.wizardHint}>
          Благодарности: {attachGratitude ? 'да' : 'нет'}
        </p>
      </section>
      <section className={styles.wizardSummary}>
        <h2 className={styles.wizardSummaryTitle}>Скидки</h2>
        <p>
          {preview?.promoCode
            ? `Промо ${preview.promoCode}: −${formatAdminMoney(preview.discountTotal)}`
            : preview?.giftCertificateCode
              ? `Сертификат ${preview.giftCertificateCode}: −${formatAdminMoney(preview.giftCertificateAmount)}`
              : promoCode.trim() || giftCertificateCode.trim()
                ? 'Скидка в запросе — ждём пересчёт…'
                : 'Без скидки'}
        </p>
      </section>
      <section className={styles.wizardSummary}>
        <h2 className={styles.wizardSummaryTitle}>Доставка</h2>
        <p>
          {giftOnly
            ? 'Электронный сертификат — без доставки'
            : shipping
              ? `${shipping.shippingMethod}: ${shipping.address.city}, ${shipping.address.address} — ${formatAdminMoney(preview?.shippingCost ?? shipping.shippingCost)}`
              : '—'}
        </p>
      </section>
      <section className={styles.wizardSummary}>
        <h2 className={styles.wizardSummaryTitle}>Итог</h2>
        {previewBusy && !preview ? (
          <p className={styles.wizardHint}>Считаем как на сервере…</p>
        ) : previewError ? (
          <p className={styles.wizardError} role="alert">
            {previewError}
          </p>
        ) : preview ? (
          <div className={styles.wizardHint}>
            <p>
              Товары {formatAdminMoney(preview.subtotal)}
              {preview.discountTotal > 0
                ? ` − промо ${formatAdminMoney(preview.discountTotal)}`
                : ''}
              {preview.giftCertificateAmount > 0
                ? ` − сертификат ${formatAdminMoney(preview.giftCertificateAmount)}`
                : ''}
              {' + '}
              доставка {formatAdminMoney(preview.shippingCost)}
              {' = '}
              <strong>{formatAdminMoney(preview.total)}</strong>
            </p>
            {preview.gratitudeCount > 0 ? (
              <p>Подарки благодарности: {preview.gratitudeCount}</p>
            ) : null}
            {preview.priceOverrides.length > 0 ? (
              <p>Override цен: {preview.priceOverrides.length} поз.</p>
            ) : null}
          </div>
        ) : (
          <p className={styles.wizardHint}>Нет данных превью</p>
        )}
      </section>

      <fieldset className={styles.wizardPayModes}>
        <legend>Оплата</legend>
        {PAY_MODE_OPTIONS.filter(
          (o) => !o.financeOnly || canOrdersFinance,
        ).map((o) => (
          <label key={o.value} className={styles.wizardRadioBlock}>
            <span className={styles.wizardRadio}>
              <input
                type="radio"
                name="payMode"
                checked={payMode === o.value}
                onChange={() => onPayMode(o.value)}
              />
              {o.label}
            </span>
            <span className={styles.wizardRadioHelp}>{o.help}</span>
          </label>
        ))}
        {!canOrdersFinance ? (
          <p className={styles.wizardHint}>
            «Сразу оплачен» доступно только с правом «Заказы: оплата и возвраты».
          </p>
        ) : null}
      </fieldset>

      <div className={styles.labelCheckboxRow}>
        <AdminCheckbox
          id="order-create-notify"
          className={styles.adminCheckboxForm}
          checked={notifyCustomer}
          onChange={(e) => onNotifyCustomer(e.target.checked)}
        />
        <label htmlFor="order-create-notify">Уведомить клиента</label>
      </div>

      <button type="button" className={styles.linkBtn} onClick={onToggleAffiliate}>
        {affiliateOpen ? 'Скрыть партнёрскую атрибуцию' : 'Партнёрская атрибуция (опционально)'}
      </button>
      {affiliateOpen ? (
        <div className={styles.wizardStack}>
          <div className={styles.wizardStack}>
            <AdminTextField
              label="Реф. хеш партнёра"
              value={refHash}
              onChange={(e) => onRefHash(e.target.value)}
            />
            <p className={styles.wizardHint}>Из cookie / ссылки Yourich</p>
          </div>
          <div className={styles.wizardStack}>
            <AdminTextField
              label="Внешний ID покупателя"
              value={extUserId}
              onChange={(e) => onExtUserId(e.target.value)}
            />
            <p className={styles.wizardHint}>Отпечаток покупателя, если есть</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
