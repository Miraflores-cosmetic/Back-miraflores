'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime, formatAdminMoney } from '@/lib/adminFormat';
import type { AdminOrderListResponse } from '@/lib/adminOrderTypes';
import {
  ADMIN_ORDERS_UNVIEWED_REFRESH_EVENT,
  useAdminUnviewedOrdersCount,
} from '@/hooks/useAdminUnviewedOrdersCount';
import { orderStatusLabel, orderStatusBadgeClass } from '@/lib/orderStatusLabels';
import { usePathname } from 'next/navigation';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { AwaitingPaymentChips } from './AwaitingPaymentChips';
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
  const pathname = usePathname();
  const unviewedSidebarCount = useAdminUnviewedOrdersCount(true, pathname);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [unviewedOnly, setUnviewedOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [clarificationOnly, setClarificationOnly] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [clarificationCount, setClarificationCount] = useState(0);
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
      if (unviewedOnly) sp.set('unviewed', '1');
      if (overdueOnly) sp.set('overdue', '1');
      if (clarificationOnly) sp.set('clarification', '1');
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
  }, [page, qDebounced, status, unviewedOnly, overdueOnly, clarificationOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshOverdueCount = useCallback(async () => {
    try {
      const res = await adminBackendJson<{ count: number }>(
        'orders/admin/awaiting-overdue-count',
      );
      setOverdueCount(Math.max(0, res.count ?? 0));
    } catch {
      /* leave previous count */
    }
  }, []);

  const refreshClarificationCount = useCallback(async () => {
    try {
      const res = await adminBackendJson<{ count: number }>(
        'orders/admin/address-clarification-count',
      );
      setClarificationCount(Math.max(0, res.count ?? 0));
    } catch {
      /* leave previous count */
    }
  }, []);

  useEffect(() => {
    void refreshOverdueCount();
    void refreshClarificationCount();
  }, [refreshOverdueCount, refreshClarificationCount, data]);

  useEffect(() => {
    const onRefresh = () => {
      void load({ soft: true });
      void refreshOverdueCount();
      void refreshClarificationCount();
    };
    document.addEventListener(CHAT_UNREAD_REFRESH_EVENT, onRefresh);
    document.addEventListener(ADMIN_ORDERS_UNVIEWED_REFRESH_EVENT, onRefresh);
    return () => {
      document.removeEventListener(CHAT_UNREAD_REFRESH_EVENT, onRefresh);
      document.removeEventListener(ADMIN_ORDERS_UNVIEWED_REFRESH_EVENT, onRefresh);
    };
  }, [load, refreshOverdueCount, refreshClarificationCount]);

  const items = data?.items ?? [];

  const shouldSoftPoll = useMemo(() => {
    if (overdueOnly || clarificationOnly || status === 'AWAITING_PAYMENT') return true;
    if (status) return false;
    return items.some(
      (o) => o.status === 'AWAITING_PAYMENT' || o.needsAddressClarification,
    );
  }, [items, status, overdueOnly, clarificationOnly]);

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
        empty={
          clarificationOnly
            ? 'Нет заказов с адресом на уточнении'
            : overdueOnly
              ? 'Нет просроченных неоплаченных заказов'
              : unviewedOnly
                ? 'Нет непросмотренных оплаченных заказов'
                : 'Заказов пока нет'
        }
        isEmpty={!loading && items.length === 0}
        isFetching={fetching}
        toolbar={
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <div className={styles.searchBoxToolbar}>
                <AdminSearchBox
                  placeholder="Номер, email, телефон, имя"
                  ariaLabel="Поиск заказов"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.ordersToolbarEnd}>
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
              <button
                type="button"
                className={`${styles.orderUnviewedChip} ${
                  overdueOnly ? styles.orderUnviewedChipActive : ''
                }`}
                aria-pressed={overdueOnly}
                title="Неоплаченные старше SLA (default 72 ч). Stock и gift hold до ручной отмены."
                disabled={fetching}
                onClick={() => {
                  setOverdueOnly((v) => !v);
                  if (!overdueOnly) {
                    setUnviewedOnly(false);
                    setClarificationOnly(false);
                  }
                  setPage(1);
                }}
              >
                Просрочено &gt;72ч
                <span
                  className={`${styles.orderUnviewedChipCount} ${
                    overdueCount < 1 ? styles.orderUnviewedChipCountZero : ''
                  }`}
                >
                  {overdueCount > 99 ? '99+' : overdueCount}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.orderUnviewedChip} ${
                  clarificationOnly ? styles.orderUnviewedChipActive : ''
                }`}
                aria-pressed={clarificationOnly}
                title="Клиент не нашёл адрес на чекауте — нужно уточнить доставку и выставить оплату"
                disabled={fetching}
                onClick={() => {
                  setClarificationOnly((v) => !v);
                  if (!clarificationOnly) {
                    setOverdueOnly(false);
                    setUnviewedOnly(false);
                  }
                  setPage(1);
                }}
              >
                Нужен адрес
                <span
                  className={`${styles.orderUnviewedChipCount} ${
                    clarificationCount < 1 ? styles.orderUnviewedChipCountZero : ''
                  }`}
                >
                  {clarificationCount > 99 ? '99+' : clarificationCount}
                </span>
              </button>
              {unviewedSidebarCount > 0 || unviewedOnly ? (
                <button
                  type="button"
                  className={`${styles.orderUnviewedChip} ${
                    unviewedOnly ? styles.orderUnviewedChipActive : ''
                  }`}
                  aria-pressed={unviewedOnly}
                  title="Оплаченные заказы, карточку которых ещё не открывали — как зелёная «1» у пункта «Заказы»"
                  disabled={fetching}
                  onClick={() => {
                    setUnviewedOnly((v) => !v);
                    if (!unviewedOnly) {
                      setOverdueOnly(false);
                      setClarificationOnly(false);
                    }
                    setPage(1);
                  }}
                >
                  Непросмотренные
                  <span
                    className={`${styles.orderUnviewedChipCount} ${
                      unviewedSidebarCount < 1
                        ? styles.orderUnviewedChipCountZero
                        : ''
                    }`}
                  >
                    {unviewedSidebarCount > 99 ? '99+' : unviewedSidebarCount}
                  </span>
                </button>
              ) : null}
              <AdminCompactBtnLink href="/admin/orders/new" variant="accent">
                Новый заказ
              </AdminCompactBtnLink>
            </div>
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
              const awaitingOverdue = Boolean(o.awaitingPayment?.overdue);
              return (
              <tr
                key={o.id}
                className={awaitingOverdue ? styles.orderRowAwaitingOverdue : undefined}
              >
                <td>
                  <Link href={`/admin/orders/${o.id}`} className={styles.orderNumberLink}>
                    {o.adminUnviewed ? (
                      <span
                        className={styles.orderUnviewedDot}
                        title="Новый оплаченный заказ — откройте карточку, чтобы снять уведомление"
                        aria-hidden
                      />
                    ) : null}
                    {o.needsAddressClarification ? (
                      <span
                        className={styles.addressClarificationIcon}
                        title="Нужно уточнить адрес доставки"
                        aria-label="Нужно уточнить адрес доставки"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M12 2.5c-3.6 0-6.5 2.85-6.5 6.35 0 4.55 5.4 10.7 6.1 11.45a.55.55 0 0 0 .8 0c.7-.75 6.1-6.9 6.1-11.45C18.5 5.35 15.6 2.5 12 2.5Zm0 8.75a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8Z"
                            fill="currentColor"
                          />
                        </svg>
                      </span>
                    ) : null}
                    <span>{o.number}</span>
                  </Link>
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
                  <AwaitingPaymentChips timeline={o.awaitingPayment} compact />
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
