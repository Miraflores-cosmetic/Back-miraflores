'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminUserGroupListResponse } from '@/lib/adminUserGroupTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

const LIMIT = 20;

function groupBadge(g: { isDefaultGuest: boolean; isDefaultRegistered: boolean }): string {
  if (g.isDefaultGuest) return 'Гости';
  if (g.isDefaultRegistered) return 'Розница (зарег.)';
  return 'Кастомная';
}

export function UserGroupsAdminClient() {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminUserGroupListResponse | null>(null);
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [creating, setCreating] = useState(false);

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
      const sp = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (qDebounced.trim()) sp.set('q', qDebounced.trim());
      const res = await adminBackendJson<AdminUserGroupListResponse>(`user-groups/admin?${sp}`);
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

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim() || !createSlug.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await adminBackendJson('user-groups/admin', {
        method: 'POST',
        body: JSON.stringify({
          name: createName.trim(),
          slug: createSlug.trim().toLowerCase(),
        }),
      });
      setCreateName('');
      setCreateSlug('');
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Не удалось создать');
    } finally {
      setCreating(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <>
      <h1 className={styles.title}>Группы пользователей</h1>
      <p className={styles.lead}>
        Цены, видимость каталога и промо по группам. Гости и зарегистрированные розничные
        покупатели — системные группы.
      </p>

      <form className={styles.inlineForm} onSubmit={createGroup}>
        <input
          className={styles.input}
          placeholder="Название"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
        />
        <input
          className={styles.input}
          placeholder="slug (latin)"
          value={createSlug}
          onChange={(e) => setCreateSlug(e.target.value)}
        />
        <AdminCompactBtn type="submit" disabled={creating}>
          {creating ? '…' : 'Создать'}
        </AdminCompactBtn>
      </form>

      <AdminListShell loading={loading} error={error} fetching={fetching}>
        <AdminSearchBox value={q} onChange={setQ} placeholder="Поиск по названию или slug" />
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Название</th>
              <th>Slug</th>
              <th>Тип</th>
              <th>Участники</th>
              <th>Цены SKU</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id}>
                <td>
                  <Link href={`/admin/user-groups/${g.id}`} className={styles.link}>
                    {g.name}
                  </Link>
                  {!g.active ? <span className={styles.muted}> (выкл.)</span> : null}
                </td>
                <td>{g.slug}</td>
                <td>{groupBadge(g)}</td>
                <td>{g.counts.users}</td>
                <td>{g.counts.variantPrices}</td>
                <td>
                  <AdminCompactBtnLink href={`/admin/user-groups/${g.id}`}>
                    Открыть
                  </AdminCompactBtnLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data ? (
          <AdminListPagination
            page={data.page}
            limit={data.limit}
            total={data.total}
            onPageChange={setPage}
          />
        ) : null}
      </AdminListShell>
    </>
  );
}
