export type OzonHealthFailure = 'disconnected' | 'refresh_failed' | 'points_failed' | 'points_empty';

export const OZON_HEALTH_FAILURE_LABEL: Record<OzonHealthFailure, string> = {
  disconnected: 'Ozon отключён (refresh token отозван или удалён)',
  refresh_failed: 'Не удалось обновить токен Ozon',
  points_failed: 'Справочник ПВЗ Ozon не загружается',
  points_empty: 'Справочник ПВЗ Ozon пуст (pointCount = 0)',
};

/** Алерт после N подряд неудачных проверок; повтор, пока не восстановится, — не чаще cooldown. */
export const OZON_ALERT_AFTER_FAILURES = 2;
export const OZON_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type OzonAlertState = {
  alertState: string | null;
  consecutiveFailures: number;
  lastAlertAt: Date | null;
};

export type OzonAlertDecision = OzonAlertState & {
  alert: 'failing' | 'recovered' | null;
};

export function decideOzonAlert(
  prev: OzonAlertState,
  ok: boolean,
  now: Date,
): OzonAlertDecision {
  if (ok) {
    return {
      alertState: 'ok',
      consecutiveFailures: 0,
      lastAlertAt: prev.lastAlertAt,
      alert: prev.alertState === 'failing' ? 'recovered' : null,
    };
  }
  const consecutiveFailures = prev.consecutiveFailures + 1;
  const cooledDown =
    !prev.lastAlertAt || now.getTime() - prev.lastAlertAt.getTime() >= OZON_ALERT_COOLDOWN_MS;
  const shouldAlert =
    consecutiveFailures >= OZON_ALERT_AFTER_FAILURES && (prev.alertState !== 'failing' || cooledDown);
  return {
    alertState: shouldAlert ? 'failing' : prev.alertState === 'failing' ? 'failing' : prev.alertState,
    consecutiveFailures,
    lastAlertAt: shouldAlert ? now : prev.lastAlertAt,
    alert: shouldAlert ? 'failing' : null,
  };
}

/** Интервал фоновых проверок, мин; 0 — выключено. */
export function ozonHealthIntervalMin(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(24 * 60, Math.max(5, Math.round(n)));
}
