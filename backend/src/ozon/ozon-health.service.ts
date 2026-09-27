import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { OzonAuthService } from './ozon-auth.service';
import { OzonPointsService } from './ozon-points.service';
import {
  decideOzonAlert,
  OZON_ALERT_AFTER_FAILURES,
  OZON_HEALTH_FAILURE_LABEL,
  ozonHealthIntervalMin,
  type OzonHealthFailure,
} from './ozon-health.util';

const SINGLETON_ID = 'default';
const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 48;
const FIRST_RUN_DELAY_MS = 60_000;

export type OzonHealthCheckResult = {
  ok: boolean;
  connected: boolean;
  /** false — Ozon ни разу не подключали: проверка не пишется и не алертит */
  configured: boolean;
  pointCount: number | null;
  durationMs: number;
  failure: OzonHealthFailure | null;
  error: string | null;
  checkedAt: string;
};

function errMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Фоновые проверки Ozon (токен, справочник ПВЗ) + email-алерт о падении/восстановлении. */
@Injectable()
export class OzonHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OzonHealthService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstRun: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<OzonHealthCheckResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: OzonAuthService,
    private readonly points: OzonPointsService,
    @Optional() private readonly mail?: MailService,
  ) {}

  intervalMin(): number {
    return ozonHealthIntervalMin(this.config.get<string>('OZON_HEALTH_INTERVAL_MIN'));
  }

  private alertEmail(): string | null {
    return (
      this.config.get<string>('OPS_ALERT_EMAIL')?.trim() ||
      this.config.get<string>('SUPPORT_EMAIL')?.trim() ||
      null
    );
  }

  onModuleInit() {
    const min = this.intervalMin();
    if (!min || process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    const tick = () => {
      void this.check('scheduled').catch((e) =>
        this.logger.warn(`Ozon health check failed: ${errMessage(e)}`),
      );
    };
    this.firstRun = setTimeout(tick, FIRST_RUN_DELAY_MS);
    this.timer = setInterval(tick, min * 60_000);
    if (typeof this.firstRun.unref === 'function') this.firstRun.unref();
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
    this.firstRun = null;
    this.timer = null;
  }

  private withBypass<T>(fn: () => Promise<T>): Promise<T> {
    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, fn);
  }

  /** Одна проверка за раз: ручная кнопка во время фоновой не дублирует запросы к Ozon. */
  check(trigger: 'scheduled' | 'manual'): Promise<OzonHealthCheckResult> {
    if (!this.running) {
      this.running = this.runCheck(trigger).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async probe(): Promise<Omit<OzonHealthCheckResult, 'durationMs' | 'checkedAt'>> {
    const status = await this.auth.status();
    if (!status.connected) {
      const wasConnected = Boolean(status.connectedAt);
      return {
        ok: false,
        connected: false,
        configured: wasConnected,
        pointCount: null,
        failure: wasConnected ? 'disconnected' : null,
        error: wasConnected ? status.lastError : 'Ozon Доставка не подключена',
      };
    }
    try {
      await this.auth.authHeaders();
    } catch (e) {
      const after = await this.auth.status().catch(() => null);
      return {
        ok: false,
        connected: after?.connected ?? false,
        configured: true,
        pointCount: null,
        failure: after && !after.connected ? 'disconnected' : 'refresh_failed',
        error: after?.lastError || errMessage(e),
      };
    }
    try {
      const list = await this.points.pointListHealth();
      if (list.staleError) {
        return {
          ok: false,
          connected: true,
          configured: true,
          pointCount: list.count,
          failure: 'points_failed',
          error: list.staleError,
        };
      }
      if (list.count === 0) {
        return {
          ok: false,
          connected: true,
          configured: true,
          pointCount: 0,
          failure: 'points_empty',
          error: null,
        };
      }
      return { ok: true, connected: true, configured: true, pointCount: list.count, failure: null, error: null };
    } catch (e) {
      return {
        ok: false,
        connected: true,
        configured: true,
        pointCount: null,
        failure: 'points_failed',
        error: errMessage(e),
      };
    }
  }

  private async runCheck(trigger: 'scheduled' | 'manual'): Promise<OzonHealthCheckResult> {
    const started = Date.now();
    const probe = await this.probe();
    const now = new Date();
    const result: OzonHealthCheckResult = {
      ...probe,
      durationMs: Date.now() - started,
      checkedAt: now.toISOString(),
    };
    if (!result.configured) return result;

    const row = await this.withBypass(() =>
      this.prisma.ozonIntegration.findUnique({ where: { id: SINGLETON_ID } }),
    );
    const decision = decideOzonAlert(
      {
        alertState: row?.alertState ?? null,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        lastAlertAt: row?.lastAlertAt ?? null,
      },
      result.ok,
      now,
    );
    const integration = {
      lastCheckAt: now,
      lastCheckOk: result.ok,
      lastPointCount: result.pointCount ?? row?.lastPointCount ?? null,
      consecutiveFailures: decision.consecutiveFailures,
      alertState: decision.alertState,
      lastAlertAt: decision.lastAlertAt,
    };
    await this.withBypass(async () => {
      await this.prisma.ozonHealthCheck.create({
        data: {
          ok: result.ok,
          connected: result.connected,
          pointCount: result.pointCount,
          durationMs: result.durationMs,
          failure: result.failure,
          error: result.error,
          trigger,
        },
      });
      await this.prisma.ozonIntegration.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, ...integration },
        update: integration,
      });
      await this.prisma.ozonHealthCheck.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - HISTORY_RETENTION_MS) } },
      });
    });

    if (decision.alert) await this.sendAlert(decision.alert, result, decision.consecutiveFailures);
    return result;
  }

  private async sendAlert(
    kind: 'failing' | 'recovered',
    result: OzonHealthCheckResult,
    failures: number,
  ): Promise<void> {
    const label = result.failure ? OZON_HEALTH_FAILURE_LABEL[result.failure] : 'Ozon Доставка снова работает';
    this.logger.error(
      `OPS_ALERT ozon_health state=${kind} failure=${result.failure ?? 'none'} failures=${failures} pointCount=${result.pointCount ?? 'n/a'}`,
    );
    const to = this.alertEmail();
    if (!to || !this.mail) {
      this.logger.warn('OPS_ALERT ozon_health: set OPS_ALERT_EMAIL or SUPPORT_EMAIL for email notify');
      return;
    }
    const adminUrl = this.config.get<string>('ADMIN_PUBLIC_URL')?.trim().replace(/\/$/, '');
    const link = adminUrl ? `${adminUrl}/admin/settings/delivery` : null;
    const subject =
      kind === 'failing' ? `[Miraflores] Ozon Доставка: ${label}` : '[Miraflores] Ozon Доставка восстановлена';
    const lines =
      kind === 'failing'
        ? [
            `${label}.`,
            `Неудачных проверок подряд: ${failures} (алерт после ${OZON_ALERT_AFTER_FAILURES}).`,
            result.error ? `Ошибка: ${result.error}` : '',
            'Пока Ozon недоступен, витрина скрывает Ozon в checkout (покупатели выбирают СДЭК).',
            result.failure === 'disconnected' ? 'Нужно заново подключить Ozon в админке.' : '',
          ]
        : [`Проверка прошла успешно, пунктов выдачи: ${result.pointCount ?? '—'}.`];
    const body = lines.filter(Boolean);
    try {
      await this.mail.sendRaw({
        to,
        subject,
        text: [...body, link ? `Службы доставки: ${link}` : ''].filter(Boolean).join('\n'),
        html: [
          ...body.map((l) => `<p>${escapeHtml(l)}</p>`),
          link ? `<p><a href="${escapeHtml(link)}">Открыть «Службы доставки»</a></p>` : '',
        ].join(''),
      });
    } catch (e) {
      this.logger.warn(`OPS_ALERT ozon_health: email failed: ${errMessage(e)}`);
    }
  }

  async dashboard() {
    const [row, history] = await this.withBypass(() =>
      Promise.all([
        this.prisma.ozonIntegration.findUnique({ where: { id: SINGLETON_ID } }),
        this.prisma.ozonHealthCheck.findMany({ orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT }),
      ]),
    );
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const day = history.filter((h) => h.createdAt.getTime() >= since);
    return {
      intervalMin: this.intervalMin(),
      alertEmailConfigured: Boolean(this.alertEmail()),
      alertAfterFailures: OZON_ALERT_AFTER_FAILURES,
      lastCheckAt: row?.lastCheckAt?.toISOString() ?? null,
      lastCheckOk: row?.lastCheckOk ?? null,
      lastPointCount: row?.lastPointCount ?? null,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      alertState: row?.alertState ?? null,
      lastAlertAt: row?.lastAlertAt?.toISOString() ?? null,
      uptime24h: day.length ? Math.round((day.filter((h) => h.ok).length / day.length) * 1000) / 10 : null,
      history: history.map((h) => ({
        at: h.createdAt.toISOString(),
        ok: h.ok,
        connected: h.connected,
        pointCount: h.pointCount,
        durationMs: h.durationMs,
        failure: h.failure,
        failureLabel: h.failure ? (OZON_HEALTH_FAILURE_LABEL[h.failure as OzonHealthFailure] ?? h.failure) : null,
        error: h.error,
        trigger: h.trigger,
      })),
    };
  }
}
