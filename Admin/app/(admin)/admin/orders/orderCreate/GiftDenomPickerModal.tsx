'use client';

import { useEffect, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminModal, AdminModalActions } from '@/components/admin/AdminModal/AdminModal';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminMoney } from '@/lib/adminFormat';
import type { AdminGiftDenomination } from '@/lib/adminGiftCertificateTypes';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

export function GiftDenomPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (denom: AdminGiftDenomination) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denoms, setDenoms] = useState<AdminGiftDenomination[]>([]);
  const [draftId, setDraftId] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraftId('');
    setError(null);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await adminBackendJson<AdminGiftDenomination[]>(
          'gift-certificates/admin/denominations?active=1',
        );
        if (cancelled) return;
        setDenoms(Array.isArray(rows) ? rows : []);
        if (rows?.[0]) setDraftId(rows[0].id);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof AdminBackendRequestError
              ? e.status === 403
                ? 'Нет доступа к номиналам. Нужен раздел «Заказы» или «Сертификаты».'
                : e.message
              : 'Ошибка загрузки номиналов',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function apply() {
    const d = denoms.find((x) => x.id === draftId);
    if (!d) return;
    onPick(d);
    onClose();
  }

  return (
    <AdminModal
      open={open}
      title="Подарочный сертификат"
      onClose={onClose}
      footer={
        <AdminModalActions
          onCancel={onClose}
          onConfirm={apply}
          confirmLabel="Добавить"
          confirmDisabled={!draftId || loading}
        />
      }
    >
      {loading ? <p className={catalogStyles.muted}>Загрузка…</p> : null}
      {error ? (
        <p className={catalogStyles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error ? (
        <div className={catalogStyles.tableWrap}>
          <table className={catalogStyles.table}>
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>Номинал</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {denoms.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      type="radio"
                      name="gift-denom-pick"
                      checked={draftId === d.id}
                      onChange={() => setDraftId(d.id)}
                      aria-label={d.name}
                    />
                  </td>
                  <td>{d.name}</td>
                  <td>{formatAdminMoney(d.faceValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {denoms.length === 0 ? (
            <p className={catalogStyles.muted}>Нет активных номиналов</p>
          ) : null}
        </div>
      ) : null}
      {!loading && error ? (
        <AdminCompactBtn type="button" variant="outline" onClick={onClose}>
          Закрыть
        </AdminCompactBtn>
      ) : null}
    </AdminModal>
  );
}
