'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import type { AdminRetailUserListResponse } from '@/lib/adminUserTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { UsersFormsModal } from './UsersFormsModal';

const LIMIT = 20;

export function UsersListClient() {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminRetailUserListResponse | null>(null);
  const [formsOpen, setFormsOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setError(null);
    setFetching(true);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      if (qDebounced.trim()) sp.set('q', qDebounced.trim());
      const res = await adminBackendJson<AdminRetailUserListResponse>(
        `users/admin?${sp}`,
      );
      setData(res);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
      setData(null);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [page, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];

  return (
    <>
      <h1 className={styles.title}>Пользователи</h1>

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void load()}
        loadingLabel="Загрузка…"
        empty="Пользователей пока нет"
        isEmpty={!loading && items.length === 0}
        isFetching={fetching}
        toolbar={
          <div className={styles.toolbar}>
            <div className={styles.searchBoxToolbar}>
              <AdminSearchBox
                placeholder="Email, имя или телефон"
                ariaLabel="Поиск пользователей"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
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
              <th>Email</th>
              <th>Имя</th>
              <th>Заказы</th>
              <th>Регистрация</th>
              <th>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setFormsOpen(true)}
                  title="Формы"
                >
                  Подписка
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const on = Boolean(u.subscribed);
              return (
                <tr key={u.id}>
                  <td>
                    <Link href={`/admin/users/${u.id}`}>{u.email}</Link>
                  </td>
                  <td>{u.displayName?.trim() || '—'}</td>
                  <td>{u.orderCount}</td>
                  <td className={styles.mutedInline}>{formatAdminDateTime(u.createdAt)}</td>
                  <td aria-label={on ? 'Подписан' : 'Нет подписки'}>{on ? '✓' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </AdminListShell>

      <UsersFormsModal open={formsOpen} onClose={() => setFormsOpen(false)} />
    </>
  );
}
