'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminListPagination } from '@/components/admin/AdminListPagination/AdminListPagination';
import { AdminTextField } from '@/components/AdminTextField/AdminTextField';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime, formatAdminMoney } from '@/lib/adminFormat';
import {
  GIFT_LEDGER_KIND_RU,
  GIFT_STATUS_LABEL_RU,
  type AdminGiftCertificate,
} from '@/lib/adminGiftCertificateTypes';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

const LEDGER_LIMIT = 20;

export function CertificateDetailClient({
  certificateId,
  canCertificatesFinance = false,
}: {
  certificateId: string;
  canCertificatesFinance?: boolean;
}) {
  const router = useRouter();
  const [row, setRow] = useState<AdminGiftCertificate | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [extendDate, setExtendDate] = useState('');

  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        ledgerPage: String(ledgerPage),
        ledgerLimit: String(LEDGER_LIMIT),
      });
      const data = await adminBackendJson<AdminGiftCertificate>(
        `gift-certificates/admin/${certificateId}?${sp}`,
      );
      setRow(data);
      if (data.expiresAt) {
        try {
          setExtendDate(
            new Date(data.expiresAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }),
          );
        } catch {
          setExtendDate('');
        }
      } else {
        setExtendDate('');
      }
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [certificateId, ledgerPage]);

  useEffect(() => {
    void load();
  }, [load]);

  function pushFlash(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2500);
  }

  async function onRevoke() {
    if (!window.confirm('Отозвать сертификат? Баланс станет 0, использование невозможно.')) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`gift-certificates/admin/${certificateId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Отзыв из админки' }),
      });
      pushFlash('Отозван');
      await load();
      router.refresh();
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка отзыва');
    } finally {
      setSaving(false);
    }
  }

  async function onResend() {
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`gift-certificates/admin/${certificateId}/resend-email`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      pushFlash('Письмо отправлено');
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось отправить');
    } finally {
      setSaving(false);
    }
  }

  async function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    const delta = Math.trunc(Number(adjustDelta));
    if (!Number.isFinite(delta) || delta === 0) {
      setError('Укажите ненулевую дельту (например 100 или -50)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminBackendJson(`gift-certificates/admin/${certificateId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          delta,
          note: adjustNote.trim() || undefined,
        }),
      });
      setAdjustDelta('');
      setAdjustNote('');
      pushFlash('Баланс обновлён');
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Ошибка корректировки');
    } finally {
      setSaving(false);
    }
  }

  async function onExtend(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const expiresAt = extendDate.trim()
        ? new Date(`${extendDate}T23:59:59.000+03:00`).toISOString()
        : null;
      await adminBackendJson(`gift-certificates/admin/${certificateId}/extend`, {
        method: 'POST',
        body: JSON.stringify({ expiresAt }),
      });
      pushFlash('Срок обновлён');
      await load();
    } catch (err) {
      setError(err instanceof AdminBackendRequestError ? err.message : 'Ошибка продления');
    } finally {
      setSaving(false);
    }
  }

  async function copyCode() {
    if (!row?.code) return;
    try {
      await navigator.clipboard.writeText(row.code);
      setCopied(true);
      pushFlash('Код скопирован');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  if (loading && !row) {
    return <p className={styles.lead}>Загрузка…</p>;
  }
  if (!row) {
    return (
      <>
        <div className={styles.errorBanner} role="alert">
          {error ?? 'Не найден'}
        </div>
        <AdminCompactBtnLink href="/admin/certificates">К списку</AdminCompactBtnLink>
      </>
    );
  }

  const ledger = row.ledger ?? [];
  const ledgerTotal = row.ledgerTotal ?? 0;

  return (
    <>
      <h1 className={styles.title}>
        <code>{row.code}</code>
      </h1>
      <p className={styles.lead}>
        {GIFT_STATUS_LABEL_RU[row.status]} · номинал {formatAdminMoney(row.faceValue)} · остаток{' '}
        {formatAdminMoney(row.balance)}
        {row.denomination ? ` · ${row.denomination.name}` : ''}
      </p>
      <p className={styles.lead}>
        Источник: {row.source === 'PURCHASE' ? 'Покупка' : 'Админка'}
        {' · '}
        Выпустил: {row.issuedBy?.label ?? (row.issuedByUserId ? `${row.issuedByUserId.slice(0, 8)}…` : '—')}
        {row.purchaseOrder ? (
          <>
            {' · '}
            Заказ покупки:{' '}
            <AdminCompactBtnLink href={`/admin/orders/${row.purchaseOrder.id}`}>
              {row.purchaseOrder.number ?? row.purchaseOrder.id.slice(0, 8)}
            </AdminCompactBtnLink>
          </>
        ) : null}
      </p>
      {flash ? (
        <p className={styles.lead} style={{ color: '#1f6b36' }} role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      ) : null}

      <div className={styles.formActions}>
        <AdminCompactBtn type="button" onClick={() => void copyCode()}>
          {copied ? 'Скопировано' : 'Копировать код'}
        </AdminCompactBtn>
        {canCertificatesFinance && row.recipientEmail && row.status !== 'REVOKED' ? (
          <AdminCompactBtn
            type="button"
            disabled={saving}
            onClick={() => void onResend()}
          >
            Отправить письмо
          </AdminCompactBtn>
        ) : null}
        {canCertificatesFinance && row.status !== 'REVOKED' ? (
          <AdminCompactBtn type="button" variant="danger" disabled={saving} onClick={() => void onRevoke()}>
            Отозвать
          </AdminCompactBtn>
        ) : null}
        <AdminCompactBtnLink href="/admin/certificates">К списку</AdminCompactBtnLink>
      </div>

      <p className={styles.lead} style={{ marginTop: 16 }}>
        Получатель: {row.recipientEmail ?? '—'}
        {' · '}
        Выпущен: {formatAdminDateTime(row.issuedAt)}
        {' · '}
        Срок: {row.expiresAt ? formatAdminDateTime(row.expiresAt) : 'бессрочно'}
      </p>
      {row.note ? <p className={styles.lead}>Комментарий: {row.note}</p> : null}

      {canCertificatesFinance && row.status !== 'REVOKED' ? (
        <>
          <h2 className={styles.groupHeading}>Корректировка баланса</h2>
          <form className={styles.form} onSubmit={(e) => void onAdjust(e)}>
            <AdminTextField
              label="Дельта, ₽ (+пополнить / −списать)"
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
              placeholder="100 или -50"
            />
            <AdminTextField
              label="Причина"
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
            />
            <AdminCompactBtn type="submit" variant="accent" disabled={saving}>
              Применить
            </AdminCompactBtn>
          </form>

          <h2 className={styles.groupHeading}>Срок действия</h2>
          <form className={styles.form} onSubmit={(e) => void onExtend(e)}>
            <AdminTextField
              label="Действует до (пусто = бессрочно)"
              type="date"
              value={extendDate}
              onChange={(e) => setExtendDate(e.target.value)}
            />
            <AdminCompactBtn type="submit" disabled={saving}>
              Сохранить срок
            </AdminCompactBtn>
          </form>
        </>
      ) : null}

      <h2 className={styles.groupHeading}>
        История (ledger)
        {ledgerTotal > 0 ? (
          <span className={styles.lead} style={{ display: 'inline', marginLeft: 8 }}>
            {ledgerTotal} запис.
            {ledgerTotal > LEDGER_LIMIT
              ? ` · стр. ${ledgerPage}/${Math.max(1, Math.ceil(ledgerTotal / LEDGER_LIMIT))}`
              : ''}
          </span>
        ) : null}
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Когда</th>
              <th>Тип</th>
              <th>Сумма</th>
              <th>Баланс после</th>
              <th>Кто</th>
              <th>Заказ</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 ? (
              <tr>
                <td colSpan={7}>Пока пусто</td>
              </tr>
            ) : (
              ledger.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatAdminDateTime(entry.createdAt)}</td>
                  <td>{GIFT_LEDGER_KIND_RU[entry.kind] ?? entry.kind}</td>
                  <td>{formatAdminMoney(entry.amount)}</td>
                  <td>{formatAdminMoney(entry.balanceAfter)}</td>
                  <td title={entry.actor?.email ?? entry.actorUserId ?? undefined}>
                    {entry.actor?.label ?? (entry.actorUserId ? `${entry.actorUserId.slice(0, 8)}…` : '—')}
                  </td>
                  <td>
                    {entry.order ? (
                      <AdminCompactBtnLink href={`/admin/orders/${entry.order.id}`}>
                        {entry.order.number ?? `${entry.order.id.slice(0, 8)}…`}
                      </AdminCompactBtnLink>
                    ) : entry.orderId ? (
                      <AdminCompactBtnLink href={`/admin/orders/${entry.orderId}`}>
                        {entry.orderId.slice(0, 8)}…
                      </AdminCompactBtnLink>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{entry.note ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {ledgerTotal > LEDGER_LIMIT ? (
        <AdminListPagination
          page={ledgerPage}
          total={ledgerTotal}
          limit={LEDGER_LIMIT}
          onPageChange={(p) => {
            setLedgerPage(p);
          }}
        />
      ) : null}
    </>
  );
}
