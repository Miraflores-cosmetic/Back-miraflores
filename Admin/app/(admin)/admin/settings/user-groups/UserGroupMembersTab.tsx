'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import type { AdminGroupMember, AdminGroupMemberListResponse } from '@/lib/adminUserGroupTypes';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';
import { UserGroupMemberPickerModal } from './UserGroupMemberPickerModal';

const PAGE_SIZE = 20;

export function UserGroupMembersTab({
  groupId,
  assignable,
  onChanged,
}: {
  groupId: string;
  assignable: boolean;
  onChanged?: () => void;
}) {
  const { showToast } = useToast();
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<AdminGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<AdminGroupMember | null>(null);

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
      showToast('Участник добавлен');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось добавить');
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemoveMember() {
    if (!removeMember) return;
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`user-groups/admin/${groupId}/members/${removeMember.id}`, {
        method: 'DELETE',
      });
      showToast('Участник убран из группы');
      setRemoveMember(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось удалить');
    } finally {
      setSaving(false);
    }
  }

  if (!assignable) {
    return (
      <p className={catalogStyles.muted}>
        Системную группу нельзя назначать вручную — пользователи попадают сюда автоматически (гости
        или все зарегистрированные без явной группы для розницы).
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className={catalogStyles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={settingsStyles.menuProductActions}>
        <div className={catalogStyles.searchBoxToolbar} style={{ flex: 1, minWidth: 200 }}>
          <AdminSearchBox
            placeholder="Поиск по email или имени"
            ariaLabel="Поиск участников"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <AdminCompactBtn type="button" variant="accent" disabled={saving} onClick={() => setPickerOpen(true)}>
          Добавить
        </AdminCompactBtn>
      </div>
      {loading ? <p className={catalogStyles.muted}>Загрузка…</p> : null}
      <div className={catalogStyles.tableWrap}>
        <table className={catalogStyles.table}>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Email</th>
              <th>Добавлен</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className={settingsStyles.settingsEmpty}>
                    <p className={settingsStyles.settingsEmptyTitle}>Участников пока нет</p>
                    <p className={settingsStyles.settingsEmptyHint}>
                      Добавьте покупателя в группу — для него применятся цены и правила видимости.
                    </p>
                    <AdminCompactBtn
                      type="button"
                      variant="accent"
                      disabled={saving}
                      onClick={() => setPickerOpen(true)}
                    >
                      Добавить участника
                    </AdminCompactBtn>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/admin/users/${m.id}`} className={catalogStyles.link}>
                      {m.displayName?.trim() || '—'}
                    </Link>
                  </td>
                  <td>{m.email}</td>
                  <td className={catalogStyles.mutedInline}>{formatAdminDateTime(m.createdAt)}</td>
                  <td>
                    <AdminCompactBtn
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => setRemoveMember(m)}
                    >
                      Убрать
                    </AdminCompactBtn>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
      <ConfirmDialog
        open={removeMember != null}
        title="Убрать из группы?"
        message={
          removeMember
            ? `Снять ${removeMember.email} с этой группы? Пользователь перейдёт в розничную группу.`
            : ''
        }
        confirmLabel="Убрать"
        cancelLabel="Отмена"
        danger
        onCancel={() => setRemoveMember(null)}
        onConfirm={() => void confirmRemoveMember()}
      />
    </>
  );
}
