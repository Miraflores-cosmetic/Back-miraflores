'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { useToast } from '@/components/Toast/ToastProvider';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { AdminBackendRequestError, adminBackendJson } from '@/lib/adminBackendFetch';
import styles from './delivery.module.css';

type TierReport = {
  index: number;
  label: string;
  currentRub: number;
  n: number;
  medianActualRub: number | null;
  deltaPct: number | null;
  suggestedRub: number | null;
  needsReview: boolean;
};

type ReconRow = {
  orderId: string;
  orderNumber: string;
  shippedAt: string;
  dropoff: 'pvz' | 'courier';
  billableGrams: number | null;
  estimatedCostRub: number | null;
  carrierCostRub: number;
  tariffVersion: string | null;
};

type Report = {
  tariffVersion: string;
  days: number;
  minSamplesPerTier: number;
  thresholdPct: number;
  summary: {
    shipments: number;
    estimatedTotalRub: number;
    actualTotalRub: number;
    biasPct: number | null;
    meanAbsPct: number | null;
  };
  pvzTiers: TierReport[];
  courier: { n: number; currentMultiplier: number; medianMultiplier: number | null; needsReview: boolean };
  rows: ReconRow[];
};

type Tariff = {
  version: string;
  pvzTiers: Array<[number, number]>;
  pvzMaxRub: number;
  courierMultiplier: number;
};

function signedPct(n: number | null): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toLocaleString('ru-RU')}%`;
}

/** Предложенная сетка в формате env; цены по ступеням не убывают (иначе backend отклонит сетку). */
function suggestedEnv(report: Report, tariff: Tariff): string {
  let prev = 0;
  const priced = report.pvzTiers.map((t) => {
    const rub = Math.max(prev, t.needsReview && t.suggestedRub != null ? t.suggestedRub : t.currentRub);
    prev = rub;
    return rub;
  });
  const tiers = tariff.pvzTiers.map(([kg], i) => `${kg}:${priced[i]}`);
  const max = priced[tariff.pvzTiers.length] ?? tariff.pvzMaxRub;
  const mult =
    report.courier.needsReview && report.courier.medianMultiplier != null
      ? report.courier.medianMultiplier
      : tariff.courierMultiplier;
  const d = new Date();
  const version = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-reconciled`;
  return [
    `OZON_TARIFF_PVZ_TIERS=${[...tiers, `max:${max}`].join(',')}`,
    `OZON_TARIFF_COURIER_MULTIPLIER=${mult}`,
    `OZON_TARIFF_VERSION=${version}`,
  ].join('\n');
}

/** Своя тарифная сетка vs фактический биллинг Ozon (факт вводится в карточке заказа). */
export function OzonTariffCard() {
  const { showToast } = useToast();
  const [days, setDays] = useState(90);
  const [report, setReport] = useState<Report | null>(null);
  const [tariff, setTariff] = useState<Tariff | null>(null);
  const [missingCost, setMissingCost] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, t, flags] = await Promise.all([
        adminBackendJson<Report>(`delivery/ozon/admin/tariff-reconciliation?days=${days}`),
        adminBackendJson<Tariff>('delivery/ozon/admin/tariff'),
        adminBackendJson<{ noCost: number }>('orders/admin/ozon-flags').catch(() => null),
      ]);
      setReport(r);
      setTariff(t);
      setMissingCost(flags?.noCost ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof AdminBackendRequestError ? e.message : 'Не удалось загрузить сверку тарифа');
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const needsReview = report ? report.pvzTiers.some((t) => t.needsReview) || report.courier.needsReview : false;
  const env = report && tariff && needsReview ? suggestedEnv(report, tariff) : null;

  async function copyEnv() {
    if (!env) return;
    try {
      await navigator.clipboard.writeText(env);
      showToast('Скопировано');
    } catch {
      showToast('Не удалось скопировать');
    }
  }

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logoMuted}`} aria-hidden>
          ₽
        </span>
        <div className={styles.cardHeadText}>
          <h2 className={styles.cardTitle}>Тарифная сетка Ozon</h2>
          <p className={styles.cardSub}>
            {tariff ? `Версия ${tariff.version}. ` : ''}Сверка с фактическими списаниями Ozon: введите
            стоимость из кабинета в карточке заказа после отправки.
          </p>
        </div>
        {report ? (
          <span className={`${styles.pill} ${needsReview ? styles.pillError : styles.pillOk}`}>
            {needsReview ? 'Нужен пересмотр' : report.summary.shipments ? 'В пределах нормы' : 'Нет данных'}
          </span>
        ) : null}
      </header>

      {error ? (
        <div className={catalogStyles.errorBanner} role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {report && tariff ? (
        <>
          {missingCost ? (
            <div className={catalogStyles.warningBanner} role="status">
              <span>
                Отправлений Ozon без факта стоимости: <strong>{missingCost}</strong> — они не попадают в
                сверку.{' '}
                <Link href="/admin/orders?flag=ozon_no_cost">Внести в заказах →</Link>
              </span>
            </div>
          ) : null}
          <div className={styles.toolbarRow}>
            <label className={styles.hint}>
              Период{' '}
              <select className={styles.select} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={30}>30 дней</option>
                <option value={90}>90 дней</option>
                <option value={180}>180 дней</option>
                <option value={365}>год</option>
              </select>
            </label>
            <span className={styles.hint}>
              Ступень помечается, если по ней ≥ {report.minSamplesPerTier} отправлений и медиана факта
              отличается от цены на ≥ {report.thresholdPct}%.
            </span>
          </div>

          <div className={styles.tiles}>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Отправлений с фактом</span>
              <span className={styles.tileValue}>{report.summary.shipments}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>По сетке / факт</span>
              <span className={styles.tileValue}>
                {report.summary.estimatedTotalRub.toLocaleString('ru-RU')} /{' '}
                {report.summary.actualTotalRub.toLocaleString('ru-RU')} ₽
              </span>
            </div>
            <div
              className={`${styles.tile} ${
                report.summary.biasPct != null && Math.abs(report.summary.biasPct) >= report.thresholdPct
                  ? styles.tileBad
                  : ''
              }`}
            >
              <span className={styles.tileLabel}>Смещение (факт − сетка)</span>
              <span className={styles.tileValue}>{signedPct(report.summary.biasPct)}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Средняя ошибка</span>
              <span className={styles.tileValue}>
                {report.summary.meanAbsPct == null ? '—' : `${report.summary.meanAbsPct}%`}
              </span>
            </div>
          </div>

          <div className={catalogStyles.tableWrap}>
            <table className={`${catalogStyles.table} ${styles.tableCompact}`}>
              <thead>
                <tr>
                  <th>ПВЗ, оплачиваемый вес</th>
                  <th className={styles.num}>Цена сейчас</th>
                  <th className={styles.num}>Отправлений</th>
                  <th className={styles.num}>Медиана факта</th>
                  <th className={styles.num}>Отклонение</th>
                </tr>
              </thead>
              <tbody>
                {report.pvzTiers.map((t) => (
                  <tr key={t.index} className={t.needsReview ? styles.rowReview : undefined}>
                    <td>{t.label}</td>
                    <td className={styles.num}>{t.currentRub} ₽</td>
                    <td className={styles.num}>{t.n || '—'}</td>
                    <td className={styles.num}>{t.medianActualRub != null ? `${t.medianActualRub} ₽` : '—'}</td>
                    <td className={styles.num}>{signedPct(t.deltaPct)}</td>
                  </tr>
                ))}
                <tr className={report.courier.needsReview ? styles.rowReview : undefined}>
                  <td>Курьер — множитель к цене ПВЗ</td>
                  <td className={styles.num}>×{report.courier.currentMultiplier}</td>
                  <td className={styles.num}>{report.courier.n || '—'}</td>
                  <td className={styles.num}>
                    {report.courier.medianMultiplier != null ? `×${report.courier.medianMultiplier}` : '—'}
                  </td>
                  <td className={styles.num}>—</td>
                </tr>
              </tbody>
            </table>
          </div>

          {env ? (
            <>
              <p className={styles.hint}>
                Предложенная сетка (помеченные ступени — по медиане факта). Проверьте, добавьте в
                backend/.env и перезапустите сервер; затем обновите <code>DEFAULT_OZON_TARIFF</code> в коде
                при следующем релизе.
              </p>
              <pre className={styles.envBox}>{env}</pre>
              <div className={styles.actions}>
                <AdminCompactBtn type="button" variant="outline" onClick={() => void copyEnv()}>
                  Копировать
                </AdminCompactBtn>
              </div>
            </>
          ) : null}

          {report.rows.length ? (
            <div className={catalogStyles.tableWrap}>
              <table className={`${catalogStyles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr>
                    <th>Заказ</th>
                    <th>Способ</th>
                    <th className={styles.num}>Опл. вес</th>
                    <th className={styles.num}>По сетке</th>
                    <th className={styles.num}>Факт</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.slice(0, 10).map((r) => (
                    <tr key={`${r.orderId}-${r.shippedAt}`}>
                      <td>
                        <Link href={`/admin/orders/${r.orderId}`}>{r.orderNumber}</Link>
                      </td>
                      <td>{r.dropoff === 'courier' ? 'Курьер' : 'ПВЗ'}</td>
                      <td className={styles.num}>
                        {r.billableGrams != null ? `${(r.billableGrams / 1000).toLocaleString('ru-RU')} кг` : '—'}
                      </td>
                      <td className={styles.num}>{r.estimatedCostRub != null ? `${r.estimatedCostRub} ₽` : '—'}</td>
                      <td className={styles.num}>{r.carrierCostRub} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.hint}>
              За период нет отправлений Ozon с фактической стоимостью. В карточке заказа Ozon после
              отправки укажите сумму из кабинета — она появится здесь.
            </p>
          )}
        </>
      ) : !error ? (
        <p className={catalogStyles.lead}>Загрузка…</p>
      ) : null}
    </section>
  );
}
