'use client';

import { useEffect, useState } from 'react';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import type {
  AdminRetailUser,
  AdminRetailUserListResponse,
} from '@/lib/adminUserTypes';
import { userLabel } from './helpers';
import { orderCreateStyles as styles } from './styles';

export function UserPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (u: AdminRetailUser) => void;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [rows, setRows] = useState<AdminRetailUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const sp = new URLSearchParams({ page: '1', limit: '30' });
        if (qDebounced.trim()) sp.set('q', qDebounced.trim());
        const res = await adminBackendJson<AdminRetailUserListResponse>(
          `users/admin?${sp}`,
        );
        if (!cancelled) setRows(res.items);
      } catch (e) {
        if (!cancelled) {
          setErr(
            e instanceof AdminBackendRequestError
              ? e.message
              : 'Ошибка загрузки',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, qDebounced]);

  useEffect(() => {
    if (!open) {
      setQ('');
      setQDebounced('');
      setRows([]);
      setErr(null);
    }
  }, [open]);

  return (
    <AdminModal
      open={open}
      title="Выбрать пользователя"
      wide
      onClose={onClose}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={onClose}
          confirmLabel="Закрыть"
          cancelLabel="Отмена"
        />
      }
    >
      <AdminSearchBox
        placeholder="Email, имя, телефон"
        ariaLabel="Поиск пользователей"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loading ? <p className={styles.wizardHint}>Загрузка…</p> : null}
      {err ? <p className={styles.wizardError}>{err}</p> : null}
      <ul className={styles.wizardUserList}>
        {rows.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              className={styles.wizardUserBtn}
              onClick={() => onPick(u)}
            >
              <span>{userLabel(u)}</span>
              <span className={styles.wizardHint}>{u.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </AdminModal>
  );
}
