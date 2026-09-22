'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatRub } from '@/lib/publicCatalog';
import {
  orderStatusLabel,
  orderStatusBadgeClass,
} from '@/lib/orderStatusLabels';
import type { BuyerOrder } from './accountTypes';
import { buyerOrderCanPayNow } from './accountTypes';
import styles from './AccountPage.module.css';

type Tab = 'all' | 'delivered' | 'process' | 'cancelled' | 'refunded';

const DELIVERED = new Set(['DELIVERED']);
const PROCESS = new Set([
  'NEW',
  'AWAITING_PAYMENT',
  'PAID',
  'PACKING',
  'SHIPPED',
]);
const CANCELLED = new Set(['CANCELLED']);
const REFUNDED = new Set(['REFUNDED']);

function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const raw = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(d);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function AccountOrdersClient() {
  const [orders, setOrders] = useState<BuyerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/account/orders', {
          credentials: 'same-origin',
        });
        if (!res.ok) {
          if (!cancelled) setError('Не удалось загрузить заказы');
          return;
        }
        const data = (await res.json()) as BuyerOrder[];
        if (!cancelled) setOrders(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setError('Сеть недоступна');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    let delivered = 0;
    let process = 0;
    let cancelled = 0;
    let refunded = 0;
    for (const o of orders) {
      if (DELIVERED.has(o.status)) delivered += 1;
      else if (PROCESS.has(o.status)) process += 1;
      else if (CANCELLED.has(o.status)) cancelled += 1;
      else if (REFUNDED.has(o.status)) refunded += 1;
    }
    return { all: orders.length, delivered, process, cancelled, refunded };
  }, [orders]);

  const filtered = useMemo(() => {
    if (tab === 'delivered') return orders.filter((o) => DELIVERED.has(o.status));
    if (tab === 'process') return orders.filter((o) => PROCESS.has(o.status));
    if (tab === 'cancelled') return orders.filter((o) => CANCELLED.has(o.status));
    if (tab === 'refunded') return orders.filter((o) => REFUNDED.has(o.status));
    return orders;
  }, [orders, tab]);

  return (
    <>
      {loading ? (
        <p className={styles.loading}>Загрузка заказов…</p>
      ) : error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        <>
          <ul className={styles.tabs} role="tablist" aria-label="Статусы заказов">
            {(
              [
                ['all', 'Все', counts.all],
                ['process', 'В обработке', counts.process],
                ['delivered', 'Доставлен', counts.delivered],
                ['cancelled', 'Отменённые', counts.cancelled],
                ['refunded', 'Возвраты', counts.refunded],
              ] as const
            ).map(([key, label, count]) => (
              <li key={key} role="presentation">
                <button
                  type="button"
                  role="tab"
                  id={`orders-tab-${key}`}
                  aria-selected={tab === key}
                  className={[styles.tab, tab === key ? styles.tabActive : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setTab(key)}
                >
                  {label}
                  <span className={styles.tabCount}>{count}</span>
                </button>
              </li>
            ))}
          </ul>

          {filtered.length === 0 ? (
            <p className={styles.empty}>
              {orders.length === 0
                ? 'Заказов пока нет'
                : 'Нет заказов в этом статусе'}
            </p>
          ) : (
            filtered.map((order) => {
              const canPay = buyerOrderCanPayNow(order);
              return (
                <article key={order.id} className={styles.orderGroup}>
                  <Link
                    href={`/account/orders/${encodeURIComponent(order.id)}`}
                    className={styles.orderLink}
                    scroll={false}
                  >
                    <div className={styles.orderHead}>
                      <div>
                        <p className={styles.orderDate}>
                          {formatOrderDate(order.createdAt)}
                        </p>
                        <p className={styles.orderNumber}>{order.number}</p>
                        {order.tracking ? (
                          <p className={styles.orderTracking}>
                            Трек {order.tracking}
                          </p>
                        ) : null}
                      </div>
                      <div className={styles.orderHeadRight}>
                        <span
                          className={`${styles.badge} ${orderStatusBadgeClass(order.status, styles)}`}
                        >
                          {orderStatusLabel(order.status)}
                        </span>
                      </div>
                    </div>
                    <ul className={styles.itemList}>
                      {order.items.map((item) => (
                        <li key={item.id} className={styles.itemCard}>
                          <div className={styles.itemThumb}>
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                className={styles.itemThumbImg}
                                src={item.imageUrl}
                                alt=""
                              />
                            ) : null}
                          </div>
                          <div className={styles.itemInfo}>
                            <p className={styles.itemTitle}>{item.title}</p>
                            <p className={styles.itemSub}>
                              {[
                                item.subtitle,
                                item.qty > 1 ? `× ${item.qty}` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || item.sku}
                            </p>
                          </div>
                          <p className={styles.itemPrice}>
                            {formatRub(item.lineTotal)}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className={styles.orderTotal}>
                      <span>Итого</span>
                      <span>{formatRub(order.total)}</span>
                    </p>
                  </Link>
                  {canPay ? (
                    <div className={styles.orderListPay}>
                      <Link
                        href={`/account/orders/${encodeURIComponent(order.id)}`}
                        className={styles.orderListPayLink}
                        scroll={false}
                      >
                        Оплатить {formatRub(order.total)}
                      </Link>
                      {order.payExpiresAt ? (
                        <p className={styles.orderMetaComment}>
                          до{' '}
                          {new Date(order.payExpiresAt).toLocaleString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </>
      )}
    </>
  );
}
