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
  if (source === 'article') return 'Статья';
  if (source.startsWith('article:')) {
    const slug = source.slice('article:'.length);
    return slug ? `Статья · ${slug}` : 'Статья';
  }
  return source;
}

function isNewsletterStats(value: unknown): value is NewsletterAdminStats {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.total === 'number' &&
    typeof v.active === 'number' &&
    typeof v.unsubscribed === 'number' &&
    typeof v.withName === 'number' &&
    typeof v.linkedToUser === 'number' &&
    typeof v.last7Days === 'number' &&
    typeof v.last30Days === 'number' &&
    Array.isArray(v.bySource)
  );
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
      const res = await adminBackendJson<unknown>('newsletter/admin/stats');
      if (!isNewsletterStats(res)) {
        throw new AdminBackendRequestError('Некорректный ответ статистики', 502);
      }
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
      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15 }}>Подписка на рассылку</h3>
          <AdminCompactBtn
            type="button"
            variant="accent"
            disabled={exporting || statsLoading}
            onClick={() => void exportCsv()}
          >
            {exporting ? 'Выгрузка…' : 'Выгрузить всех CSV'}
          </AdminCompactBtn>
        </div>

        {exportError ? <p className={styles.error}>{exportError}</p> : null}

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

            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
                По источникам (активные)
              </h4>
              {stats.bySource.length === 0 ? (
                <p className={styles.mutedInline} style={{ margin: 0 }}>
                  Пока нет активных подписчиков
                </p>
              ) : (
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
              )}
            </div>
          </>
        ) : null}
      </div>
    </AdminModal>
  );
}
