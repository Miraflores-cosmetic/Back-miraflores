'use client';

import Link from 'next/link';
import { AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { CDEK_ORIGIN_LABEL } from '@/lib/shipping/cdekOrigin';
import { DeliverySurchargeField } from './DeliverySurchargeField';
import styles from './delivery.module.css';

type Props = {
  surchargeRub: string;
  onSurchargeChange: (value: string) => void;
  surchargeDisabled?: boolean;
};

/** СДЭК — основная служба на витрине; настройки ключей только на API-сервере. */
export function CdekSettingsCard({ surchargeRub, onSurchargeChange, surchargeDisabled }: Props) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logoCdek}`} aria-hidden>
          С
        </span>
        <div className={styles.cardHeadText}>
          <h2 className={styles.cardTitle}>СДЭК</h2>
          <p className={styles.cardSub}>ПВЗ, постаматы и курьер — основной способ доставки на сайте</p>
        </div>
        <span className={`${styles.pill} ${styles.pillOk}`}>На витрине</span>
      </header>

      <DeliverySurchargeField
        label="Добавочная стоимость, ₽"
        value={surchargeRub}
        onChange={onSurchargeChange}
        disabled={surchargeDisabled}
      />

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Отправка</dt>
          <dd>{CDEK_ORIGIN_LABEL}</dd>
        </div>
        <div className={styles.fact}>
          <dt>В заказах</dt>
          <dd>Автосоздание отправления без трека (кнопка «Заказ отправлен»)</dd>
        </div>
      </dl>

      <p className={styles.hint}>
        Стоимость на checkout считается по API СДЭК. Порог бесплатной доставки для шкалы в корзине — в{' '}
        <Link href="/admin/cart">настройках корзины</Link>.
      </p>

      <div className={styles.actions}>
        <AdminCompactBtnLink href="/admin/orders" variant="outline">
          Заказы
        </AdminCompactBtnLink>
        <AdminCompactBtnLink href="/admin/cart" variant="outline">
          Корзина и порог доставки
        </AdminCompactBtnLink>
      </div>

      <details className={styles.advancedBlock}>
        <summary className={styles.advancedSummary}>Ключи API на сервере</summary>
        <div className={styles.advancedInner}>
          <p className={styles.hint}>
            В <code>backend/.env</code> на API: <code>CDEK_ACCOUNT</code>, <code>CDEK_SECURE</code>, при
            необходимости <code>CDEK_SHIPMENT_POINT</code> и <code>CDEK_FROM_CITY_CODE</code>. Без ключей
            отметка «отправлен» только меняет статус; с ключами Nest создаёт отправление в СДЭК.
          </p>
        </div>
      </details>
    </section>
  );
}
