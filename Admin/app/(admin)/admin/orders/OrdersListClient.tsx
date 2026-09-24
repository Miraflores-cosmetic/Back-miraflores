'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime, formatAdminMoney } from '@/lib/adminFormat';
import type { AdminOrderListResponse } from '@/lib/adminOrderTypes';
import { orderStatusLabel, orderStatusBadgeClass } from '@/lib/orderStatusLabels';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from './orders.module.css';

const styles = { ...catalogStyles, ...orderStyles };

const LIMIT = 20;
const AWAITING_SOFT_POLL_MS = 12_000;
const CHAT_UNREAD_REFRESH_EVENT = 'admin-orders-chat-unread-refresh';

function formatChatMessageCount(n: number): string {
  if (n > 99) return '99+';
  return String(Math.max(0, n));
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Все статусы' },
  { value: 'AWAITING_PAYMENT', label: 'Ожидает оплаты' },
  { value: 'PAID', label: 'Оплачен' },
  { value: 'PACKING', label: 'Собирается' },
  { value: 'SHIPPED', label: 'Отправлен' },
  { value: 'DELIVERED', label: 'Доставлен' },
  { value: 'CANCELLED', label: 'Отменён' },
  { value: 'REFUNDED', label: 'Возвращён' },
  // NEW — legacy, скрыт из фильтра
];

export function OrdersListClient() {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminOrderListResponse | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    setError(null);
    if (!soft) setFetching(true);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      if (qDebounced.trim()) sp.set('q', qDebounced.trim());
      if (status) sp.set('status', status);
      const res = await adminBackendJson<AdminOrderListResponse>(
        `orders/admin?${sp}`,
      );
      setData(res);
    } catch (e) {
      if (!soft) {
        setError(
          e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить',
        );
        setData(null);
      }
    } finally {
      setLoading(false);
      if (!soft) setFetching(false);
    }
  }, [page, qDebounced, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChatRefresh = () => void load({ soft: true });
    document.addEventListener(CHAT_UNREAD_REFRESH_EVENT, onChatRefresh);
    return () => document.removeEventListener(CHAT_UNREAD_REFRESH_EVENT, onChatRefresh);
  }, [load]);

  const items = data?.items ?? [];

  const shouldSoftPoll = useMemo(() => {
    if (status === 'AWAITING_PAYMENT') return true;
    if (status) return false;
    return items.some((o) => o.status === 'AWAITING_PAYMENT');
  }, [items, status]);

  useEffect(() => {
    if (!shouldSoftPoll) return;

    const softRefresh = () => void load({ soft: true });
    const onFocus = () => softRefresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') softRefresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(softRefresh, AWAITING_SOFT_POLL_MS);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [shouldSoftPoll, load]);

  return (
    <>
      <h1 className={styles.title}>Заказы</h1>

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void load()}
        loadingLabel="Загрузка заказов…"
        empty="Заказов пока нет"
        isEmpty={!loading && items.length === 0}
        isFetching={fetching}
        toolbar={
          <div className={styles.toolbar}>
            <div className={styles.searchBoxToolbar}>
              <AdminSearchBox
                placeholder="Номер, email, телефон, имя"
                ariaLabel="Поиск заказов"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <label className={styles.filterLabel}>
              <span className={styles.srOnly}>Статус</span>
              <select
                className={styles.select}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                disabled={fetching}
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value || 'all'} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
        pagination={
          data ? (
            <AdminListPagination
              page={data.page}
              total={data.total}
              limit={data.limit}
              onPageChange={setPage}
              disabled={fetching}
            />
          ) : null
        }
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Статус</th>
              <th>Клиент</th>
              <th>Телефон</th>
              <th>Сумма</th>
              <th>Дата</th>
              <th className={styles.orderChatColHead} aria-label="Чат" />
            </tr>
          </thead>
          <tbody>
            {items.map((o) => {
              const messageCount = o.chatMessageCount ?? 0;
              const unreadCount = o.chatUnreadCount ?? 0;
              return (
              <tr key={o.id}>
                <td>
                  <Link href={`/admin/orders/${o.id}`}>{o.number}</Link>
                </td>
                <td>
                  <span
                    className={`${styles.badge} ${orderStatusBadgeClass(o.status, styles)}`}
                  >
                    {orderStatusLabel(o.status)}
                  </span>
                  {(o.refundedAmount ?? 0) > 0 && o.status !== 'REFUNDED' ? (
                    <span className={styles.mutedInline}>
                      {' '}
                      · возврат {formatAdminMoney(o.refundedAmount ?? 0)}
                    </span>
                  ) : null}
                </td>
                <td>
                  {o.userId ? (
                    <Link href={`/admin/users/${o.userId}`}>
                      {o.customerName?.trim() || o.email}
                    </Link>
                  ) : (
                    o.customerName?.trim() || o.email
                  )}
                </td>
                <td>{o.phone || '—'}</td>
                <td>{formatAdminMoney(o.total)}</td>
                <td className={styles.mutedInline}>
                  {formatAdminDateTime(o.createdAt)}
                </td>
                <td className={styles.orderChatCol}>
                  {o.userId ? (
                    <Link
                      href={`/admin/orders/${o.id}#order-chat`}
                      className={styles.orderChatLink}
                      title={
                        unreadCount > 0
                          ? `${messageCount} сообщений, ${unreadCount} непрочитанных`
                          : messageCount > 0
                            ? `${messageCount} сообщений`
                            : 'Чат по заказу'
                      }
                      aria-label={`Чат заказа ${o.number}: ${messageCount} сообщений${
                        unreadCount > 0 ? `, ${unreadCount} непрочитанных` : ''
                      }`}
                    >
                      <span className={styles.orderChatIcon} aria-hidden>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className={styles.orderChatCountGray}>
                        {formatChatMessageCount(messageCount)}
                      </span>
                    </Link>
                  ) : (
                    <span className={styles.orderChatEmpty} aria-hidden>
                      —
                    </span>
                  )}
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </AdminListShell>
    </>
  );
}
