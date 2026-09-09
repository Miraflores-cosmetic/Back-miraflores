'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import type { AdminGroupMember, AdminGroupMemberListResponse } from '@/lib/adminUserGroupTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { UserGroupMemberPickerModal } from './UserGroupPickers';

const PAGE_SIZE = 20;

export function UserGroupMembersTab({
  groupId,
  assignable,
}: {
  groupId: string;
  assignable: boolean;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<AdminGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (qDebounced.trim()) sp.set('q', qDebounced.trim());
      const res = await adminBackendJson<AdminGroupMemberListResponse>(
        `user-groups/admin/${groupId}/members?${sp}`,
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [groupId, page, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(userId: string) {
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      await load();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось добавить');
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(userId: string) {
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/members/${userId}`, {
        method: 'DELETE',
      });
      await load();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить');
    } finally {
      setSaving(false);
    }
  }

  if (!assignable) {
    return (
      <p className={styles.muted}>
        Системную группу нельзя назначать вручную — пользователи попадают сюда автоматически.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.inlineForm}>
        <AdminSearchBox
          placeholder="Поиск по email или имени"
          ariaLabel="Поиск участников"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <AdminCompactBtn
          type="button"
          disabled={saving}
          onClick={() => setPickerOpen(true)}
        >
          Добавить
        </AdminCompactBtn>
      </div>
      {loading ? <p className={styles.muted}>Загрузка…</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Имя</th>
            <th>Email</th>
            <th>С</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td>
                <Link href={`/admin/users/${m.id}`} className={styles.link}>
                  {m.displayName?.trim() || '—'}
                </Link>
              </td>
              <td>{m.email}</td>
              <td className={styles.mutedInline}>{formatAdminDateTime(m.createdAt)}</td>
              <td>
                <AdminCompactBtn
                  type="button"
                  disabled={saving}
                  onClick={() => void removeMember(m.id)}
                >
                  Убрать
                </AdminCompactBtn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && items.length === 0 ? (
        <p className={styles.muted}>Участников пока нет</p>
      ) : null}
      <AdminListPagination
        page={page}
        total={total}
        limit={PAGE_SIZE}
        onPageChange={setPage}
        disabled={loading || saving}
      />
      <UserGroupMemberPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onApply={(userId) => void addMember(userId)}
      />
    </>
  );
}
