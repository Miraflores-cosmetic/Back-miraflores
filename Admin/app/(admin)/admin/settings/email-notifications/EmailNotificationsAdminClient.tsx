'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from '../Settings.module.css';
import local from './emailNotifications.module.css';

type ListItem = {
  eventKey: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
  isCustomized: boolean;
  lastSendPath?: string | null;
  lastSendAt?: string | null;
  lastEditedByEmail?: string | null;
  lastEditedAt?: string | null;
};

type ListFilter = 'all' | 'off' | 'custom';

const PATH_META: Record<
  string,
  { short: string; title: string; badge: 'on' | 'warn' | 'off' }
> = {
  rendered_db: {
    short: 'БД',
    title: 'Шаблон из БД отрендерен и отправлен',
    badge: 'on',
  },
  rendered_legacy: {
    short: 'legacy',
    title: 'Упал рендер БД — ушло письмо из кода (legacy)',
    badge: 'warn',
  },
  skipped_disabled: {
    short: 'skip',
    title: 'Шаблон выключен — письмо не отправлялось',
    badge: 'off',
  },
  failed: {
    short: 'fail',
    title: 'Ошибка отправки (SMTP / рендер)',
    badge: 'warn',
  },
};

const PATH_LEGEND = [
  PATH_META.rendered_db,
  PATH_META.rendered_legacy,
  PATH_META.skipped_disabled,
  PATH_META.failed,
];

function pathBadgeClass(badge: 'on' | 'warn' | 'off') {
  if (badge === 'on') return local.badgeOn;
  if (badge === 'warn') return local.badgeWarn;
  return local.badgeOff;
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmailNotificationsAdminClient() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ListFilter>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<ListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminBackendJson<ListItem[]>(
        'settings/admin/email-notifications',
      );
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(
        e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'off') return items.filter((r) => !r.enabled);
    if (filter === 'custom') return items.filter((r) => r.isCustomized);
    return items;
  }, [items, filter]);

  const counts = useMemo(
    () => ({
      all: items.length,
      off: items.filter((r) => !r.enabled).length,
      custom: items.filter((r) => r.isCustomized).length,
    }),
    [items],
  );

  async function setEnabled(row: ListItem, next: boolean) {
    setBusyKey(row.eventKey);
    try {
      await adminBackendJson(
        `settings/admin/email-notifications/${encodeURIComponent(row.eventKey)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        },
      );
      setItems((prev) =>
        prev.map((r) =>
          r.eventKey === row.eventKey ? { ...r, enabled: next } : r,
        ),
      );
      showToast(next ? 'Письмо включено' : 'Письмо выключено');
    } catch (e) {
      showToast(
        e instanceof AdminBackendRequestError
          ? e.message
          : 'Не удалось изменить статус',
      );
    } finally {
      setBusyKey(null);
    }
  }

  function onToggleEnabled(row: ListItem, checked: boolean) {
    if (!checked && row.enabled) {
      setDisableTarget(row);
      return;
    }
    void setEnabled(row, checked);
  }

  return (
    <div className={local.page}>
      <div className={styles.faqCardHead} style={{ marginBottom: 16 }}>
        <h1 className={catalogStyles.title} style={{ margin: 0 }}>
          Email-уведомления
        </h1>
      </div>

      <AdminTabs
        ariaLabel="Фильтр шаблонов"
        variant="underline"
        compact
        activeId={filter}
        onChange={(id) => setFilter(id as ListFilter)}
        items={[
          { id: 'all', label: `Все (${counts.all})` },
          { id: 'off', label: `Выкл. (${counts.off})` },
          { id: 'custom', label: `Изменённые (${counts.custom})` },
        ]}
      />

      <details className={local.pathLegendDetails}>
        <summary className={local.pathLegendSummary}>
          Легенда send-path
        </summary>
        <ul className={local.pathLegend} aria-label="Легенда последнего send-path">
          {PATH_LEGEND.map((p) => (
            <li key={p.short} className={local.pathLegendItem}>
              <span className={pathBadgeClass(p.badge)}>{p.short}</span>
              <span>
                <strong>{p.short}</strong> — {p.title}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <AdminListShell
        loading={loading}
        error={error}
        onRetry={() => void load()}
        loadingLabel="Загрузка…"
        empty="Нет шаблонов по фильтру"
        isEmpty={!loading && !error && filtered.length === 0}
        wrapContent={false}
      >
        <div className={catalogStyles.tableWrap}>
          <table className={catalogStyles.table}>
            <thead>
              <tr>
                <th>Событие</th>
                <th>Статус</th>
                <th>Посл. send</th>
                <th>Обновлено</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const path = row.lastSendPath
                  ? PATH_META[row.lastSendPath]
                  : null;
                return (
                  <tr key={row.eventKey}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.label}</div>
                      <div className={catalogStyles.mutedInline}>
                        {row.description}
                      </div>
                      {row.isCustomized ? (
                        <div className={local.listMuted}>текст изменён</div>
                      ) : null}
                      {row.lastEditedByEmail ? (
                        <div className={local.listMuted}>
                          ред.: {row.lastEditedByEmail}
                        </div>
                      ) : null}
                    </td>
                    <td className={local.listStatus}>
                      <div className={local.enableCell}>
                        <label className={catalogStyles.labelCheckboxRow}>
                          <AdminCheckbox
                            checked={row.enabled}
                            disabled={busyKey === row.eventKey}
                            onChange={(e) =>
                              onToggleEnabled(row, e.target.checked)
                            }
                            aria-label={
                              row.enabled
                                ? 'Выключить отправку'
                                : 'Включить отправку'
                            }
                          />
                          <span
                            className={
                              row.enabled ? local.badgeOn : local.badgeOff
                            }
                          >
                            {row.enabled ? 'Шлётся' : 'Не шлётся'}
                          </span>
                        </label>
                      </div>
                    </td>
                    <td>
                      {path && row.lastSendPath ? (
                        <>
                          <span
                            className={pathBadgeClass(path.badge)}
                            title={path.title}
                          >
                            {path.short}
                          </span>
                          {row.lastSendAt ? (
                            <div className={local.listMuted}>
                              {formatAdminDateTime(row.lastSendAt)}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className={catalogStyles.mutedInline}>—</span>
                      )}
                    </td>
                    <td className={catalogStyles.mutedInline}>
                      {row.updatedAt
                        ? formatAdminDateTime(row.updatedAt)
                        : '—'}
                    </td>
                    <td className={catalogStyles.tableCellActions}>
                      <AdminCompactBtnLink
                        href={`/admin/settings/email-notifications/${encodeURIComponent(row.eventKey)}`}
                        variant="outline"
                        className={catalogStyles.iconBtn}
                        aria-label={`Изменить «${row.label}»`}
                        title="Изменить"
                      >
                        <EditIcon />
                      </AdminCompactBtnLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AdminListShell>

      <AdminConfirmDialog
        open={Boolean(disableTarget)}
        title="Выключить письмо?"
        message={
          disableTarget
            ? `«${disableTarget.label}» больше не будет уходить покупателям. Legacy-fallback тоже не сработает.`
            : ''
        }
        confirmLabel="Выключить"
        cancelLabel="Оставить включённым"
        danger
        onConfirm={() => {
          if (disableTarget) void setEnabled(disableTarget, false);
          setDisableTarget(null);
        }}
        onCancel={() => setDisableTarget(null)}
      />
    </div>
  );
}
