'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminModal } from '@/components/admin/AdminModal/AdminModal';
import {
  AdminBackendRequestError,
  adminBackendFetch,
  adminBackendJson,
  readAdminApiError,
} from '@/lib/adminBackendFetch';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

export type NewsletterAdminStats = {
  total: number;
  active: number;
  unsubscribed: number;
  withName: number;
  linkedToUser: number;
  last7Days: number;
  last30Days: number;
  bySource: Array<{ source: string; count: number }>;
};

function formatSourceLabel(source: string): string {
  if (source === 'homepage') return 'Home';
  if (source.startsWith('article:')) {
    const slug = source.slice('article:'.length);
    return slug ? `Статья · ${slug}` : 'Статья';
  }
  return source;
}

export function UsersFormsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<NewsletterAdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setStatsError(null);
    setStatsLoading(true);
    try {
      const res = await adminBackendJson<NewsletterAdminStats>('newsletter/admin/stats');
      setStats(res);
    } catch (e) {
      setStats(null);
      setStatsError(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить статистику',
      );
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadStats();
  }, [open, loadStats]);

  const exportCsv = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const res = await adminBackendFetch('newsletter/admin/export.csv');
      if (!res.ok) {
        throw new AdminBackendRequestError(await readAdminApiError(res), res.status);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(
        e instanceof AdminBackendRequestError ? e.message : 'Не удалось выгрузить CSV',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminModal open={open} title="Формы" onClose={onClose} wide>
      <div style={{ display: 'grid', gap: 20 }}>
        <section>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 8,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 15 }}>Подписка на рассылку</h3>
            <AdminCompactBtn
              type="button"
              variant="accent"
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? 'Выгрузка…' : 'Выгрузить всех CSV'}
            </AdminCompactBtn>
          </div>
          {exportError ? <p className={styles.error}>{exportError}</p> : null}
          <p style={{ margin: '0 0 12px', opacity: 0.85, lineHeight: 1.45 }}>
            Форма на Home и в статьях блога. Сохраняет подписчика; если email уже есть у
            покупателя — включает маркетинговое согласие в карточке.
          </p>

          {statsLoading && !stats ? (
            <p className={styles.mutedInline}>Загрузка статистики…</p>
          ) : null}
          {statsError ? (
            <p className={styles.error}>
              {statsError}{' '}
              <button type="button" className={styles.linkBtn} onClick={() => void loadStats()}>
                Повторить
              </button>
            </p>
          ) : null}

          {stats ? (
            <>
              <dl className={styles.detailDl} style={{ marginTop: 0, maxWidth: 'none' }}>
                <div className={styles.detailDlRow}>
                  <dt>Активные</dt>
                  <dd>
                    {stats.active}
                    <span className={styles.mutedInline}>
                      {' '}
                      · всего {stats.total}
                      {stats.unsubscribed > 0 ? ` · отписались ${stats.unsubscribed}` : ''}
                    </span>
                  </dd>
                </div>
                <div className={styles.detailDlRow}>
                  <dt>За 7 / 30 дней</dt>
                  <dd>
                    {stats.last7Days} / {stats.last30Days}
                    <span className={styles.mutedInline}> новых активных</span>
                  </dd>
                </div>
                <div className={styles.detailDlRow}>
                  <dt>С ФИО</dt>
                  <dd>
                    {stats.withName}
                    {stats.active > 0 ? (
                      <span className={styles.mutedInline}>
                        {' '}
                        · {Math.round((stats.withName / stats.active) * 100)}%
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className={styles.detailDlRow}>
                  <dt>Связаны с ЛК</dt>
                  <dd>
                    {stats.linkedToUser}
                    {stats.active > 0 ? (
                      <span className={styles.mutedInline}>
                        {' '}
                        · {Math.round((stats.linkedToUser / stats.active) * 100)}%
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>

              {stats.bySource.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
                    По источникам (активные)
                  </h4>
                  <table className={styles.table} style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Источник</th>
                        <th>Кол-во</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.bySource.map((row) => (
                        <tr key={row.source}>
                          <td>{formatSourceLabel(row.source)}</td>
                          <td>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <section>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Поля формы</h3>
          <ul style={{ margin: 0, paddingLeft: '1.2em', lineHeight: 1.5 }}>
            <li>
              <strong>Email</strong> — обязательное, ключ подписки
            </li>
            <li>
              <strong>ФИО</strong> — опционально; подставляется в имя пользователя, если пустое
            </li>
            <li>
              <strong>Источник</strong> — <code>homepage</code> или <code>article:…</code>
            </li>
            <li>
              Галочка в таблице = согласие в профиле <em>или</em> активная запись подписки
            </li>
          </ul>
        </section>
      </div>
    </AdminModal>
  );
}
