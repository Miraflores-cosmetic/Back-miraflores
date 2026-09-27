'use client';

import { useCallback, useEffect, useState } from 'react';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { AdminBackendRequestError, adminBackendJson } from '@/lib/adminBackendFetch';
import styles from './delivery.module.css';

type HealthEntry = {
  at: string;
  ok: boolean;
  connected: boolean;
  pointCount: number | null;
  durationMs: number;
  failure: string | null;
  failureLabel: string | null;
  error: string | null;
  trigger: 'scheduled' | 'manual' | string;
};

type HealthDashboard = {
  intervalMin: number;
  alertEmailConfigured: boolean;
  alertAfterFailures: number;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastPointCount: number | null;
  consecutiveFailures: number;
  alertState: string | null;
  lastAlertAt: string | null;
  uptime24h: number | null;
  history: HealthEntry[];
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Мониторинг Ozon: результат фоновых проверок, история, настройки алертов. */
export function OzonHealthCard({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<HealthDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminBackendJson<HealthDashboard>('delivery/ozon/admin/health'));
      setError(null);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить мониторинг');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const lastFailure = data?.history.find((h) => !h.ok) ?? null;
  const failing = data?.alertState === 'failing' || (data?.consecutiveFailures ?? 0) > 0;
  const chronological = data ? [...data.history].reverse() : [];

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logoMuted}`} aria-hidden>
          API
        </span>
        <div className={styles.cardHeadText}>
          <h2 className={styles.cardTitle}>Мониторинг Ozon</h2>
          <p className={styles.cardSub}>
            {data
              ? data.intervalMin
                ? `Фоновая проверка токена и справочника ПВЗ каждые ${data.intervalMin} мин`
                : 'Фоновые проверки выключены (OZON_HEALTH_INTERVAL_MIN=0)'
              : 'Токен, справочник ПВЗ, алерты'}
          </p>
        </div>
        {data?.lastCheckAt ? (
          <span className={`${styles.pill} ${failing ? styles.pillError : styles.pillOk}`}>
            {failing ? `Сбой (${data.consecutiveFailures} подряд)` : 'Работает'}
          </span>
        ) : null}
      </header>

      {error ? (
        <div className={catalogStyles.errorBanner} role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {data ? (
        <>
          {!data.lastCheckAt ? (
            <p className={styles.hint}>
              Проверок ещё не было — первая запустится через минуту после старта сервера, либо нажмите
              «Проверить API».
            </p>
          ) : (
            <div className={styles.tiles}>
              <div className={`${styles.tile} ${data.lastCheckOk ? styles.tileGood : styles.tileBad}`}>
                <span className={styles.tileLabel}>Последняя проверка</span>
                <span className={styles.tileValue}>{data.lastCheckOk ? 'OK' : 'Ошибка'}</span>
                <span className={styles.tileLabel}>{formatDate(data.lastCheckAt)}</span>
              </div>
              <div className={`${styles.tile} ${data.lastPointCount === 0 ? styles.tileBad : ''}`}>
                <span className={styles.tileLabel}>Пунктов в справочнике</span>
                <span className={styles.tileValue}>
                  {data.lastPointCount == null ? '—' : data.lastPointCount.toLocaleString('ru-RU')}
                </span>
              </div>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Успешных за 24 ч</span>
                <span className={styles.tileValue}>{data.uptime24h == null ? '—' : `${data.uptime24h}%`}</span>
              </div>
              <div className={`${styles.tile} ${data.alertEmailConfigured ? '' : styles.tileBad}`}>
                <span className={styles.tileLabel}>Email-алерты</span>
                <span className={styles.tileValue}>{data.alertEmailConfigured ? 'Настроены' : 'Нет адреса'}</span>
                <span className={styles.tileLabel}>
                  {data.lastAlertAt ? `Последний: ${formatDate(data.lastAlertAt)}` : `после ${data.alertAfterFailures} сбоев`}
                </span>
              </div>
            </div>
          )}

          {chronological.length ? (
            <div>
              <p className={styles.hint}>
                История ({chronological.length}): зелёный — OK, красный — сбой, в рамке — ручная проверка.
              </p>
              <div className={styles.history} role="list" aria-label="История проверок">
                {chronological.map((h) => (
                  <span
                    key={h.at}
                    role="listitem"
                    className={`${styles.historyDot} ${h.ok ? '' : styles.historyDotBad} ${
                      h.trigger === 'manual' ? styles.historyDotManual : ''
                    }`}
                    title={`${formatDate(h.at)} · ${
                      h.ok ? `OK, ${h.pointCount ?? '—'} ПВЗ` : (h.failureLabel ?? 'Сбой')
                    } · ${h.durationMs} мс${h.error ? ` · ${h.error}` : ''}`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {lastFailure ? (
            <p className={`${styles.hint} ${failing ? styles.warnText : ''}`}>
              Последний сбой {formatDate(lastFailure.at)}: {lastFailure.failureLabel ?? lastFailure.failure}
              {lastFailure.error ? ` — ${lastFailure.error}` : ''}
            </p>
          ) : null}

          {!data.alertEmailConfigured ? (
            <div className={catalogStyles.warningBanner} role="status">
              <span>
                Алерты пишутся только в лог (<code>OPS_ALERT ozon_health</code>). Для писем задайте{' '}
                <code>OPS_ALERT_EMAIL</code> или <code>SUPPORT_EMAIL</code> в backend/.env.
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
