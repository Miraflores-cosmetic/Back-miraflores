'use client';

import { useEffect, useState } from 'react';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type { AdminRetailUser, AdminRetailUserListResponse } from '@/lib/adminUserTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

const PAGE_SIZE = 50;

export function UserGroupMemberPickerModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (userId: string, label: string) => void;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminRetailUser[]>([]);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setQ('');
    setQDebounced('');
    setPage(1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        if (qDebounced.trim()) sp.set('q', qDebounced.trim());
        const res = await adminBackendJson<AdminRetailUserListResponse>(`users/admin?${sp}`);
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, qDebounced, page]);

  function userLabel(u: AdminRetailUser): string {
    return u.displayName?.trim() || u.email;
  }

  function apply() {
    if (!draft) return;
    const u = rows.find((r) => r.id === draft);
    if (!u) return;
    onApply(u.id, userLabel(u));
    onClose();
  }

  return (
    <AdminModal
      open={open}
      title="Добавить участника"
      wide
      onClose={onClose}
      footer={
        <AdminModalActions onCancel={onClose} onConfirm={apply} confirmDisabled={!draft} />
      }
    >
      <AdminSearchBox
        placeholder="Email или имя"
        ariaLabel="Поиск пользователя"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loading ? <p className={styles.muted}>Загрузка…</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!error ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Имя</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <input
                        type="radio"
                        name="ug-member"
                        checked={draft === u.id}
                        onChange={() => setDraft(u.id)}
                        aria-label={userLabel(u)}
                      />
                    </td>
                    <td>{u.displayName?.trim() || '—'}</td>
                    <td>{u.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && rows.length === 0 ? (
              <p className={styles.muted}>Ничего не найдено</p>
            ) : null}
          </div>
          <AdminListPagination
            page={page}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            disabled={loading}
          />
        </>
      ) : null}
    </AdminModal>
  );
}
