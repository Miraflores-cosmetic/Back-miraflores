import { OrderPayClient } from './OrderPayClient';
import styles from '@/app/(site)/checkout/CheckoutPage.module.css';

export const metadata = {
  title: 'Оплата заказа — Miraflores',
  robots: { index: false, follow: false },
};

export default function OrderPayPage() {
  return (
    <main className={styles.main}>
      <div className={`padding-global ${styles.successWrap}`}>
        <OrderPayClient />
      </div>
    </main>
  );
}
