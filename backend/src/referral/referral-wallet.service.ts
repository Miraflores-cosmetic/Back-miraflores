import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ReferralEarnMode,
  ReferralLedgerKind,
  ReferralLedgerStatus,
  ReferralQuarantineMode,
} from '@prisma/client';
import { createHash } from 'crypto';
import { MailService } from '../mail/mail.service';
import { computeCommissionBase } from '../orders/commission-base';
import { PrismaService } from '../prisma/prisma.service';
import { scheduleAfterRlsCommitWithBypass } from '../rls/rls-after-commit';
import { PRIOR_PURCHASE_STATUSES } from '../yourich/yourich-lead';
import { lockReferralWalletUser } from './referral-wallet-lock';
import { ReferralSettingsService } from './referral-settings.service';

const EARN_KEY = (orderId: string) => `earn:${orderId}`;
/** Бонус приглашённому (buyer) за первый qualifying заказ по ?mf=. */
const INVITEE_BONUS_KEY = (orderId: string) => `invitee_bonus:${orderId}`;
/** Seq-based: повтор при том же owed после частичного take (мало баланса) — новый seq. */
const CLAWBACK_SEQ_KEY = (orderId: string, seq: number) =>
  `clawback:${orderId}:${seq}`;
const DEBT_KEY = (orderId: string, source: 'earn' | 'invitee') =>
  source === 'invitee' ? `debt_invitee:${orderId}` : `debt:${orderId}`;
/** Идемпотентность погашения: earnId | spend_release:… | adjust:… */
const DEBT_REPAY_KEY = (sourceKey: string) => `debt_repay:${sourceKey}`;
const SPEND_HOLD_KEY = (orderId: string, seq = 1) =>
  seq <= 1 ? `spend_hold:${orderId}` : `spend_hold:${orderId}:${seq}`;
const SPEND_RELEASE_KEY = (orderId: string, seq = 1) =>
  seq <= 1 ? `spend_release:${orderId}` : `spend_release:${orderId}:${seq}`;

const TOUCH_OUTBOX_MAX_ATTEMPTS = 12;
const TOUCH_OUTBOX_DEAD = 'DEAD';
const TOUCH_OUTBOX_ERROR = 'ERROR';
const TOUCH_OUTBOX_PENDING = 'PENDING';
const TOUCH_OUTBOX_DONE = 'DONE';

function touchBackoffMs(attempts: number): number {
  const mins = [1, 2, 5, 15, 30, 60, 120, 180, 360];
  const idx = Math.min(Math.max(0, attempts - 1), mins.length - 1);
  return mins[idx]! * 60_000;
}

export type ReferralLedgerHistoryItem = {
  id: string;
  createdAt: string;
  kind: ReferralLedgerKind;
  status: ReferralLedgerStatus;
  amount: number;
  /**
   * Номер своего заказа (SPEND_*). Для EARN / INVITEE_BONUS / CLAWBACK / DEBT —
   * всегда null (номер заказа друга не отдаём в ЛК).
   */
  orderNumber: string | null;
};

/** Bucket 60s: одинаковый retry в окне → тот же key; новый клик через минуту — новый ADJUST. */
const ADJUST_IDEMPOTENCY_BUCKET_MS = 60_000;

/**
 * Клиентский Idempotency-Key или hash(actor|userId|amount|note|bucket).
 * randomUUID нельзя — retry двойно кредитует.
 */
export function buildAdjustIdempotencyKey(opts: {
  userId: string;
  actorUserId: string;
  amount: number;
  note: string;
  clientKey?: string | null;
  nowMs?: number;
}): string {
  const client = opts.clientKey?.trim();
  if (client) {
    const safe = client.replace(/[^\w.:-]/g, '').slice(0, 128);
    if (safe) return `adjust:client:${opts.userId}:${safe}`;
  }
  const bucket = Math.floor(
    (opts.nowMs ?? Date.now()) / ADJUST_IDEMPOTENCY_BUCKET_MS,
  );
  const payload = `${opts.actorUserId}|${opts.userId}|${opts.amount}|${opts.note}|${bucket}`;
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 32);
  return `adjust:h:${hash}`;
}

export type EarnMeta = {
  base: number;
  pct: number;
  /** Snapshot quarantine — не live settings. */
  qMode: ReferralQuarantineMode;
  qDays: number;
};

/** CLAWBACK / DEBT source column (+ legacy note prefixes). */
export type ReferralLedgerSource = 'earn' | 'invitee' | 'debt';

// DELIVERED_PLUS_DAYS до DELIVERED — иначе prefix match «съест» PLUS.
const Q_MODE_RE = /qMode=(DELIVERED_PLUS_DAYS|DAYS_AFTER_PAID|DELIVERED)/;
const Q_DAYS_RE = /qDays=(\d+)/;

/** Human-readable note (legacy readers / админка). Canonical = колонки. */
export function encodeEarnMeta(meta: EarnMeta): string {
  return `base=${meta.base};pct=${meta.pct};qMode=${meta.qMode};qDays=${meta.qDays}`;
}

/**
 * Snapshot из note (legacy). Предпочитать колонки через earnMetaFromRow.
 */
export function parseEarnMeta(
  note: string | null | undefined,
): (Pick<EarnMeta, 'base' | 'pct'> & Partial<Pick<EarnMeta, 'qMode' | 'qDays'>>) | null {
  if (!note) return null;
  const baseM = note.match(/base=(\d+)/);
  const pctM = note.match(/pct=(\d+)/);
  if (!baseM || !pctM) return null;
  const qModeM = note.match(Q_MODE_RE);
  const qDaysM = note.match(Q_DAYS_RE);
  return {
    base: Number(baseM[1]),
    pct: Number(pctM[1]),
    ...(qModeM
      ? { qMode: qModeM[1] as ReferralQuarantineMode }
      : {}),
    ...(qDaysM ? { qDays: Number(qDaysM[1]) } : {}),
  };
}

export type LedgerEarnRow = {
  note?: string | null;
  qMode?: ReferralQuarantineMode | null;
  qDays?: number | null;
  earnBase?: number | null;
  earnPct?: number | null;
};

/** Колонки → meta; fallback note для legacy строк. */
export function earnMetaFromRow(
  row: LedgerEarnRow,
): (Pick<EarnMeta, 'base' | 'pct'> & Partial<Pick<EarnMeta, 'qMode' | 'qDays'>>) | null {
  const fromNote = parseEarnMeta(row.note);
  const base = row.earnBase ?? fromNote?.base;
  const pct = row.earnPct ?? fromNote?.pct;
  if (base == null || pct == null) return fromNote;
  return {
    base,
    pct,
    qMode: row.qMode ?? fromNote?.qMode,
    qDays: row.qDays ?? fromNote?.qDays,
  };
}

/** Live fallback только для legacy без q* (не для новых snapshot-строк). */
export function resolveQuarantine(
  meta: ReturnType<typeof parseEarnMeta>,
  live: { quarantineMode: ReferralQuarantineMode; quarantineDays: number },
): { qMode: ReferralQuarantineMode; qDays: number } {
  return {
    qMode: meta?.qMode ?? live.quarantineMode,
    qDays: Math.max(1, meta?.qDays ?? live.quarantineDays),
  };
}

export function resolveLedgerSource(
  source: string | null | undefined,
  note?: string | null,
): ReferralLedgerSource | null {
  const s = source?.trim();
  if (s === 'earn' || s === 'invitee' || s === 'debt') return s;
  const n = note ?? '';
  if (n.startsWith('clawback invitee') || n.startsWith('debt invitee')) {
    return 'invitee';
  }
  if (n.startsWith('clawback debt')) return 'debt';
  if (n.startsWith('clawback earn') || n.startsWith('debt earn')) return 'earn';
  return null;
}

/**
 * Worker picks PENDING where availableAt ≤ now.
 * DAYS_AFTER_PAID → paidAt + qDays;
 * DELIVERED → null (release via touch);
 * DELIVERED_PLUS_DAYS → null at create, touch ставит deliveredAt+qDays.
 */
export function computeAvailableAt(
  qMode: ReferralQuarantineMode,
  qDays: number,
  paidAt: Date | null | undefined,
): Date | null {
  if (qMode !== ReferralQuarantineMode.DAYS_AFTER_PAID) return null;
  const base = paidAt ?? new Date();
  return new Date(base.getTime() + Math.max(1, qDays) * 24 * 60 * 60_000);
}

/** Карантин после доставки: deliveredAt + N дней. */
export function computeDeliveredPlusAvailableAt(
  qDays: number,
  deliveredAt: Date | null | undefined,
): Date {
  const base = deliveredAt ?? new Date();
  return new Date(base.getTime() + Math.max(1, qDays) * 24 * 60 * 60_000);
}

const PAID_LIKE: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

type TxClient = Prisma.TransactionClient;

@Injectable()
export class ReferralWalletService {
  private readonly logger = new Logger(ReferralWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ReferralSettingsService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /**
   * Email после commit (EARN created / POSTED / CLAWBACK).
   * Push в проекте нет — только mail module.
   */
  private scheduleReferralMail(
    kind: 'created' | 'posted' | 'clawback',
    opts: {
      userId: string;
      amount: number;
      orderId?: string | null;
      kindLabel?: string;
    },
  ): void {
    if (!this.mail) return;
    const amount = Math.abs(Math.floor(opts.amount));
    if (amount < 1) return;
    const mail = this.mail;
    const userId = opts.userId;
    const kindLabel = opts.kindLabel || 'начисление';
    scheduleAfterRlsCommitWithBypass(this.prisma, async () => {
      try {
        // Номер заказа друга рефереру не передаём (как в истории ЛК).
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, displayName: true },
        });
        const to = user?.email?.trim();
        if (!to) return;
        const payload = {
          to,
          amount,
          orderNumber: null as string | null,
          displayName: user?.displayName ?? null,
        };
        if (kind === 'created') {
          await mail.sendReferralEarnCreated({
            ...payload,
            kindLabel,
          });
        } else if (kind === 'posted') {
          await mail.sendReferralEarnPosted({
            ...payload,
            kindLabel,
          });
        } else {
          await mail.sendReferralClawback(payload);
        }
      } catch (e) {
        this.logger.warn(
          `referral mail ${kind} failed user=${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    });
  }

  /** Available ₽ (POSTED sum без DEBT, floored at 0). */
  async availableBalance(userId: string): Promise<number> {
    const agg = await this.prisma.referralWalletLedger.aggregate({
      where: {
        userId,
        status: ReferralLedgerStatus.POSTED,
        kind: { not: ReferralLedgerKind.DEBT },
      },
      _sum: { amount: true },
    });
    return Math.max(0, agg._sum.amount ?? 0);
  }

  /** Открытый clawback-долг (Σ DEBT POSTED). */
  async debtBalance(userId: string): Promise<number> {
    const agg = await this.prisma.referralWalletLedger.aggregate({
      where: {
        userId,
        status: ReferralLedgerStatus.POSTED,
        kind: ReferralLedgerKind.DEBT,
      },
      _sum: { amount: true },
    });
    return Math.max(0, agg._sum.amount ?? 0);
  }

  async pendingBalance(userId: string): Promise<number> {
    const agg = await this.prisma.referralWalletLedger.aggregate({
      where: {
        userId,
        status: ReferralLedgerStatus.PENDING,
        kind: {
          in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
        },
      },
      _sum: { amount: true },
    });
    return Math.max(0, agg._sum.amount ?? 0);
  }

  /**
   * История ЛК: дата, kind, status, сумма.
   * orderNumber только для SPEND_* (свой заказ); earn/bonus/clawback/debt — null.
   * Cursor = createdAt ISO + id.
   * filter: all | pending (status) | spend (SPEND_* / CLAWBACK).
   */
  async listLedgerHistory(
    userId: string,
    opts?: {
      limit?: number;
      cursor?: string | null;
      filter?: 'all' | 'pending' | 'spend' | null;
    },
  ): Promise<{
    items: ReferralLedgerHistoryItem[];
    nextCursor: string | null;
  }> {
    const take = Math.min(50, Math.max(1, Math.floor(opts?.limit ?? 20)));
    const cursorRaw = opts?.cursor?.trim() || '';
    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursorRaw) {
      const sep = cursorRaw.lastIndexOf('|');
      if (sep > 0) {
        const ts = cursorRaw.slice(0, sep);
        const id = cursorRaw.slice(sep + 1);
        const d = new Date(ts);
        if (!Number.isNaN(d.getTime()) && id) {
          cursorCreatedAt = d;
          cursorId = id;
        }
      }
    }

    const filter = opts?.filter === 'pending' || opts?.filter === 'spend'
      ? opts.filter
      : 'all';

    const kindFilter =
      filter === 'spend'
        ? {
            kind: {
              in: [
                ReferralLedgerKind.SPEND_HOLD,
                ReferralLedgerKind.SPEND_RELEASE,
                ReferralLedgerKind.CLAWBACK,
                ReferralLedgerKind.DEBT,
              ],
            },
          }
        : {};

    const statusFilter =
      filter === 'pending'
        ? { status: ReferralLedgerStatus.PENDING }
        : {};

    const rows = await this.prisma.referralWalletLedger.findMany({
      where: {
        userId,
        ...kindFilter,
        ...statusFilter,
        ...(cursorCreatedAt && cursorId
          ? {
              OR: [
                { createdAt: { lt: cursorCreatedAt } },
                { createdAt: cursorCreatedAt, id: { lt: cursorId } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: {
        id: true,
        createdAt: true,
        kind: true,
        status: true,
        amount: true,
        order: { select: { number: true } },
      },
    });

    const page = rows.slice(0, take);
    const hasMore = rows.length > take;
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        const ownOrder =
          r.kind === ReferralLedgerKind.SPEND_HOLD ||
          r.kind === ReferralLedgerKind.SPEND_RELEASE;
        return {
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          kind: r.kind,
          status: r.status,
          amount: r.amount,
          orderNumber: ownOrder ? (r.order?.number ?? null) : null,
        };
      }),
      nextCursor:
        hasMore && last
          ? `${last.createdAt.toISOString()}|${last.id}`
          : null,
    };
  }

  /**
   * После PAID / DELIVERED / cancel / refund — пересчитать earn по заказу.
   * pct + quarantineMode/Days — snapshot при create (note); live не ретроактивны.
   */
  async touch(orderId: string): Promise<void> {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, () =>
      this.touchInTx(this.prisma as unknown as TxClient, orderId),
    );
  }

  /**
   * After-commit entry: enqueue outbox → touch → DONE / ERROR (+ worker retry).
   * Один немедленный retry при первой ошибке.
   */
  async runScheduledTouch(orderId: string): Promise<void> {
    await this.enqueueTouch(orderId);
    try {
      await this.touch(orderId);
      await this.markTouchDone(orderId);
    } catch (first) {
      try {
        await this.touch(orderId);
        await this.markTouchDone(orderId);
      } catch (second) {
        await this.markTouchError(orderId, second);
        throw second;
      }
    }
  }

  async enqueueTouch(orderId: string): Promise<void> {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, () =>
      this.enqueueTouchInTx(this.prisma as unknown as TxClient, orderId, {
        // Worker/reconcile не реанимируют DEAD — только смена статуса / админ.
        reviveDead: false,
      }),
    );
  }

  /**
   * Upsert outbox в той же tx, что смена статуса заказа.
   * Иначе падение между commit и after-commit теряет событие (DELIVERED → вечный PENDING earn).
   * `reviveDead` (default true) — новая смена статуса поднимает DEAD; worker/reconcile — false.
   */
  async enqueueTouchInTx(
    tx: TxClient,
    orderId: string,
    opts?: { reviveDead?: boolean },
  ): Promise<void> {
    const reviveDead = opts?.reviveDead !== false;
    const existing = await tx.referralTouchOutbox.findUnique({
      where: { orderId },
      select: { state: true },
    });
    if (existing?.state === TOUCH_OUTBOX_DEAD && !reviveDead) {
      return;
    }
    await tx.referralTouchOutbox.upsert({
      where: { orderId },
      create: {
        orderId,
        state: TOUCH_OUTBOX_PENDING,
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        doneAt: null,
      },
      update: {
        state: TOUCH_OUTBOX_PENDING,
        nextAttemptAt: new Date(),
        lastError: null,
        doneAt: null,
        ...(existing?.state === TOUCH_OUTBOX_DEAD ? { attempts: 0 } : {}),
      },
    });
  }

  private async markTouchDone(orderId: string): Promise<void> {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      await this.prisma.referralTouchOutbox.updateMany({
        where: { orderId },
        data: {
          state: TOUCH_OUTBOX_DONE,
          doneAt: new Date(),
          lastError: null,
        },
      });
    });
  }

  private async markTouchError(orderId: string, err: unknown): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const row = await this.prisma.referralTouchOutbox.findUnique({
        where: { orderId },
        select: { attempts: true },
      });
      const attempts = (row?.attempts ?? 0) + 1;
      const dead = attempts >= TOUCH_OUTBOX_MAX_ATTEMPTS;
      await this.prisma.referralTouchOutbox.updateMany({
        where: { orderId },
        data: {
          state: dead ? TOUCH_OUTBOX_DEAD : TOUCH_OUTBOX_ERROR,
          attempts,
          nextAttemptAt: dead
            ? new Date(Date.now() + 365 * 24 * 60 * 60_000)
            : new Date(Date.now() + touchBackoffMs(attempts)),
          lastError: msg.slice(0, 2000),
        },
      });
      if (dead) {
        this.logger.error(
          `referral touch DEAD order=${orderId} attempts=${attempts}: ${msg.slice(0, 500)}`,
        );
      }
    });
  }

  /** Зависшие после MAX попыток — для админки рефералки. */
  async listDeadTouches(opts?: { limit?: number }): Promise<{
    count: number;
    items: Array<{
      orderId: string;
      orderNumber: string | null;
      attempts: number;
      lastError: string | null;
      updatedAt: string;
    }>;
  }> {
    const take = Math.min(50, Math.max(1, Math.floor(opts?.limit ?? 20)));
    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const where = { state: TOUCH_OUTBOX_DEAD };
      const [count, rows] = await Promise.all([
        this.prisma.referralTouchOutbox.count({ where }),
        this.prisma.referralTouchOutbox.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take,
          select: {
            orderId: true,
            attempts: true,
            lastError: true,
            updatedAt: true,
            order: { select: { number: true } },
          },
        }),
      ]);
      return {
        count,
        items: rows.map((r) => ({
          orderId: r.orderId,
          orderNumber: r.order?.number ?? null,
          attempts: r.attempts,
          lastError: r.lastError,
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    });
  }

  /** Вернуть DEAD → PENDING для ручного retry. */
  async requeueDeadTouch(orderId: string): Promise<{ ok: true }> {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const updated = await this.prisma.referralTouchOutbox.updateMany({
        where: { orderId, state: TOUCH_OUTBOX_DEAD },
        data: {
          state: TOUCH_OUTBOX_PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
          doneAt: null,
        },
      });
      if (updated.count === 0) {
        throw new NotFoundException('DEAD outbox не найден');
      }
    });
    await this.runScheduledTouch(orderId);
    return { ok: true };
  }

  /**
   * Worker: PENDING/ERROR outbox с nextAttemptAt ≤ now.
   * ERROR с attempts < max — тоже ретраим (state остаётся ERROR до DONE).
   */
  async processDueTouches(limit = 20): Promise<number> {
    const take = Math.max(1, Math.min(100, Math.floor(limit)));
    const due = await this.prisma.runInRlsTransaction(
      { userId: '', bypass: true },
      () =>
        this.prisma.referralTouchOutbox.findMany({
          where: {
            state: { in: ['PENDING', 'ERROR'] },
            nextAttemptAt: { lte: new Date() },
            attempts: { lt: TOUCH_OUTBOX_MAX_ATTEMPTS },
          },
          orderBy: { nextAttemptAt: 'asc' },
          take,
          select: { orderId: true },
        }),
    );

    let n = 0;
    for (const row of due) {
      try {
        await this.touch(row.orderId);
        await this.markTouchDone(row.orderId);
        n += 1;
      } catch (e) {
        await this.markTouchError(row.orderId, e);
        this.logger.warn(
          `referral touch outbox failed order=${row.orderId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return n;
  }

  /**
   * Safety-net: PAID+attribution без outbox; CANCELLED/REFUNDED с живым EARN/INVITEE.
   * Идемпотентно — после успешного touch outbox=DONE / earn voided.
   */
  async reconcileMissedTouches(limit = 30): Promise<number> {
    const take = Math.max(1, Math.min(100, Math.floor(limit)));
    const since = new Date(Date.now() - 14 * 24 * 60 * 60_000);
    const orderIds = new Set<string>();

    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const missingOutbox = await this.prisma.order.findMany({
        where: {
          status: { in: PAID_LIKE },
          giftPurchaseDenominationId: null,
          paidAt: { gte: since },
          referralAttribution: { isNot: null },
          referralTouchOutbox: { is: null },
        },
        take,
        orderBy: { paidAt: 'asc' },
        select: { id: true },
      });
      for (const o of missingOutbox) orderIds.add(o.id);

      // PENDING — void; POSTED без CLAWBACK/DEBT — clawback ещё не делали.
      // Фильтр в SQL: иначе take по самым старым заполняется уже обработанными
      // отменами и свежие CANCELLED/REFUNDED вытесняются навсегда.
      const needVoidRows = await this.prisma.$queryRaw<
        Array<{ orderId: string }>
      >(Prisma.sql`
        SELECT l."orderId" AS "orderId"
        FROM "ReferralWalletLedger" l
        INNER JOIN "Order" o ON o.id = l."orderId"
        WHERE l.kind::text IN ('EARN', 'INVITEE_BONUS')
          AND l.status::text IN ('PENDING', 'POSTED')
          AND o.status::text IN ('CANCELLED', 'REFUNDED')
          AND l."orderId" IS NOT NULL
          AND (
            l.status::text = 'PENDING'
            OR NOT EXISTS (
              SELECT 1
              FROM "ReferralWalletLedger" c
              WHERE c."orderId" = l."orderId"
                AND c.kind::text IN ('CLAWBACK', 'DEBT')
            )
          )
        GROUP BY l."orderId"
        ORDER BY MIN(l."createdAt") ASC
        LIMIT ${take}
      `);
      for (const r of needVoidRows) {
        if (r.orderId) orderIds.add(r.orderId);
      }
    });

    let n = 0;
    for (const orderId of orderIds) {
      try {
        await this.runScheduledTouch(orderId);
        n += 1;
      } catch (e) {
        this.logger.warn(
          `referral reconcile touch failed order=${orderId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return n;
  }

  async touchInTx(tx: TxClient, orderId: string): Promise<void> {
    const settings = await this.settings.ensureDefaults();
    // enabled гейтит только create EARN/invitee bonus; void/clawback/post — всегда.

    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        status: true,
        email: true,
        phone: true,
        userId: true,
        subtotal: true,
        discountTotal: true,
        giftCertificateAmount: true,
        referralWalletAmount: true,
        referralWalletReleasedAmount: true,
        refundedAmount: true,
        giftPurchaseDenominationId: true,
        paidAt: true,
        referralAttribution: {
          select: {
            code: true,
            referrerUserId: true,
            createdAt: true,
            addressMatchSuspect: true,
          },
        },
      },
    });
    if (!order?.referralAttribution) return;
    if (order.giftPurchaseDenominationId) return;

    const referrerUserId = order.referralAttribution.referrerUserId;
    const cancelled =
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED;

    const existingEarn = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: referrerUserId,
          idempotencyKey: EARN_KEY(order.id),
        },
      },
    });

    if (cancelled) {
      await this.handleCancelOrFullRefund(tx, {
        orderId: order.id,
        referrerUserId,
        existingEarn,
      });
      await this.handleInviteeBonusCancel(tx, order);
      return;
    }

    if (!PAID_LIKE.includes(order.status)) return;

    const base = computeCommissionBase(order);

    if (!existingEarn) {
      // Earn-skip (enabled / enabledAt / minOrder / % / FIRST_GOODS) ≠ skip invitee —
      // maybeCreditInviteeBonus ниже со своими гейтами. Не return до него.
      let createEarn = settings.enabled;
      if (
        createEarn &&
        (!settings.enabledAt ||
          order.referralAttribution.createdAt < settings.enabledAt)
      ) {
        createEarn = false;
      }
      const targetAmount = this.computeEarnAmount(base, settings.earnPercent);
      if (createEarn && (base < settings.minOrderRub || targetAmount <= 0)) {
        createEarn = false;
      }
      if (createEarn && settings.earnMode === ReferralEarnMode.FIRST_GOODS_ORDER) {
        const prior = await this.hasPriorGoodsPurchaseExcluding(tx, order);
        if (prior) createEarn = false;
      }
      if (
        createEarn &&
        settings.earnMode === ReferralEarnMode.EVERY &&
        (settings.earnWindowMaxOrders ?? 0) > 0
      ) {
        const inWindow = await this.isWithinEarnWindow(tx, order, {
          maxOrders: settings.earnWindowMaxOrders,
          windowDays: settings.earnWindowDays ?? 0,
        });
        if (!inWindow) createEarn = false;
      }
      let earnAmount = targetAmount;
      if (createEarn && (settings.monthlyEarnCapRub ?? 0) > 0) {
        const room = await this.monthlyEarnRoom(
          tx,
          referrerUserId,
          settings.monthlyEarnCapRub,
        );
        if (room <= 0) createEarn = false;
        else earnAmount = Math.min(earnAmount, room);
      }
      if (createEarn && earnAmount > 0) {
        await this.createPendingEarn(tx, {
          referrerUserId,
          orderId: order.id,
          amount: earnAmount,
          paidAt: order.paidAt,
          // Address hold: без availableAt — иначе DAYS_AFTER_PAID забивают worker queue.
          holdAvailableAt:
            order.referralAttribution.addressMatchSuspect === true,
          meta: {
            base,
            pct: settings.earnPercent,
            qMode: settings.quarantineMode,
            qDays: Math.max(1, settings.quarantineDays),
          },
        });
      }
    } else if (existingEarn.status === ReferralLedgerStatus.PENDING) {
      // Shrink/void только по snapshot pct (+ сохраняем qMode/qDays) — не live settings.
      const meta = earnMetaFromRow(existingEarn);
      if (!meta) {
        this.logger.warn(
          `referral earn missing snapshot meta order=${order.id} earn=${existingEarn.id}`,
        );
      } else {
        const targetAmount = this.computeEarnAmount(base, meta.pct);
        if (targetAmount <= 0) {
          await tx.referralWalletLedger.update({
            where: { id: existingEarn.id },
            data: {
              status: ReferralLedgerStatus.VOIDED,
              amount: 0,
              availableAt: null,
            },
          });
        } else if (targetAmount !== existingEarn.amount || base !== meta.base) {
          // Не «запечатывать» live quarantine в legacy note без q*.
          const nextNote =
            meta.qMode != null && meta.qDays != null
              ? encodeEarnMeta({
                  base,
                  pct: meta.pct,
                  qMode: meta.qMode,
                  qDays: meta.qDays,
                })
              : `base=${base};pct=${meta.pct}`;
          await tx.referralWalletLedger.update({
            where: { id: existingEarn.id },
            data: {
              amount: targetAmount,
              note: nextNote,
              earnBase: base,
              earnPct: meta.pct,
              ...(meta.qMode != null ? { qMode: meta.qMode } : {}),
              ...(meta.qDays != null ? { qDays: meta.qDays } : {}),
            },
          });
        }
      }
    } else if (existingEarn.status === ReferralLedgerStatus.POSTED) {
      await this.clawbackIfNeeded(tx, {
        orderId: order.id,
        referrerUserId,
        existingEarn,
        currentBase: base,
      });
    }

    const earn = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: referrerUserId,
          idempotencyKey: EARN_KEY(order.id),
        },
      },
    });
    if (earn?.status === ReferralLedgerStatus.PENDING) {
      const q = resolveQuarantine(earnMetaFromRow(earn), settings);
      const holdAddress = order.referralAttribution.addressMatchSuspect === true;
      if (!holdAddress) {
        // После approve: DAYS_AFTER_PAID мог быть создан без availableAt.
        if (
          q.qMode === ReferralQuarantineMode.DAYS_AFTER_PAID &&
          !earn.availableAt
        ) {
          const at = computeAvailableAt(q.qMode, q.qDays, order.paidAt);
          if (at) {
            await tx.referralWalletLedger.update({
              where: { id: earn.id },
              data: { availableAt: at },
            });
            if (at.getTime() <= Date.now()) {
              await this.postEarn(tx, earn.id, referrerUserId, earn.amount, {
                orderId: order.id,
                kindLabel: 'реферальное начисление',
              });
            }
          }
        } else if (order.status === OrderStatus.DELIVERED) {
          if (q.qMode === ReferralQuarantineMode.DELIVERED) {
            await this.postEarn(tx, earn.id, referrerUserId, earn.amount, {
              orderId: order.id,
              kindLabel: 'реферальное начисление',
            });
          } else if (q.qMode === ReferralQuarantineMode.DELIVERED_PLUS_DAYS) {
            // Старт окна возврата: availableAt = now + N (worker потом POSTED).
            if (!earn.availableAt) {
              await tx.referralWalletLedger.update({
                where: { id: earn.id },
                data: {
                  availableAt: computeDeliveredPlusAvailableAt(
                    q.qDays,
                    new Date(),
                  ),
                },
              });
            }
          }
        }
      }
    }

    await this.maybeCreditInviteeBonus(tx, {
      order,
      settings,
      base,
      referrerUserId,
      attributionCreatedAt: order.referralAttribution.createdAt,
      programEnabled: settings.enabled,
      addressMatchSuspect: order.referralAttribution.addressMatchSuspect,
    });
  }

  /**
   * Worker: PENDING с availableAt ≤ now → POSTED.
   * DELIVERED-mode / address-hold: availableAt=null — не в выборке
   * (иначе suspect DAYS_AFTER_PAID забивают limit и голодают остальных).
   */
  async processDueQuarantine(limit = 50): Promise<number> {
    // Void/post карантина — всегда (даже при выключенной программе).
    const settings = await this.settings.ensureDefaults();
    const now = new Date();
    const take = Math.max(1, Math.min(200, Math.floor(limit)));

    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const tx = this.prisma as unknown as TxClient;

      // Legacy: suspect уже с availableAt — выкинуть из очереди (иначе starvation).
      await tx.referralWalletLedger.updateMany({
        where: {
          kind: {
            in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
          },
          status: ReferralLedgerStatus.PENDING,
          availableAt: { not: null },
          order: {
            referralAttribution: { addressMatchSuspect: true },
          },
        },
        data: { availableAt: null },
      });

      const candidates = await tx.referralWalletLedger.findMany({
        where: {
          kind: {
            in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
          },
          status: ReferralLedgerStatus.PENDING,
          availableAt: { lte: now },
          // Не брать address-hold (continue в цикле голодал бы очередь).
          NOT: {
            order: {
              referralAttribution: { addressMatchSuspect: true },
            },
          },
        },
        take,
        orderBy: { availableAt: 'asc' },
        select: {
          id: true,
          userId: true,
          amount: true,
          orderId: true,
          kind: true,
          note: true,
          qMode: true,
          qDays: true,
          earnBase: true,
          earnPct: true,
          order: {
            select: {
              status: true,
              paidAt: true,
            },
          },
        },
      });

      let n = 0;
      for (const row of candidates) {
        const order = row.order;
        const postOpts = {
          orderId: row.orderId,
          kindLabel:
            row.kind === ReferralLedgerKind.INVITEE_BONUS
              ? 'бонус приглашённому'
              : 'реферальное начисление',
        };
        if (
          !order ||
          order.status === OrderStatus.CANCELLED ||
          order.status === OrderStatus.REFUNDED
        ) {
          await tx.referralWalletLedger.update({
            where: { id: row.id },
            data: { status: ReferralLedgerStatus.VOIDED, availableAt: null },
          });
          n += 1;
          continue;
        }
        if (!PAID_LIKE.includes(order.status)) continue;

        // Defensive: availableAt уже отфильтрован; колонки / note / live — sanity.
        const q = resolveQuarantine(earnMetaFromRow(row), settings);
        if (q.qMode === ReferralQuarantineMode.DAYS_AFTER_PAID) {
          await this.postEarn(tx, row.id, row.userId, row.amount, postOpts);
          n += 1;
          continue;
        }
        if (q.qMode === ReferralQuarantineMode.DELIVERED_PLUS_DAYS) {
          // Окно стартовало на DELIVERED; к due-дате заказ должен остаться доставленным.
          if (order.status !== OrderStatus.DELIVERED) continue;
          await this.postEarn(tx, row.id, row.userId, row.amount, postOpts);
          n += 1;
          continue;
        }
        // DELIVERED-mode не должен иметь availableAt — сброс, иначе starvation.
        await tx.referralWalletLedger.update({
          where: { id: row.id },
          data: { availableAt: null },
        });
      }
      return n;
    });
  }

  /**
   * Max списание: min(available, floor(payable × spendCap%/100), payable).
   * payable = товары(+доставка) после промо, до wallet (XOR → обычно без promo/gift).
   */
  computeSpendAmount(opts: {
    available: number;
    payableRub: number;
    spendCapPercent: number;
  }): number {
    const payable = Math.max(0, Math.floor(opts.payableRub));
    const available = Math.max(0, Math.floor(opts.available));
    const capPct = Math.min(100, Math.max(0, Math.floor(opts.spendCapPercent)));
    const capped = Math.floor((payable * capPct) / 100);
    return Math.min(available, capped, payable);
  }

  /** Settings для preview в ЛК /account (без payable). */
  async getSpendPolicy(): Promise<{
    enabled: boolean;
    spendCapPercent: number;
    linkTtlDays: number;
    earnPercent: number;
    quarantineMode: ReferralQuarantineMode;
    quarantineDays: number;
  }> {
    const settings = await this.settings.ensureDefaults();
    return {
      enabled: settings.enabled,
      spendCapPercent: settings.spendCapPercent,
      linkTtlDays: Math.min(
        3650,
        Math.max(1, Math.floor(settings.linkTtlDays) || 60),
      ),
      earnPercent: Math.max(0, Math.floor(settings.earnPercent) || 0),
      quarantineMode: settings.quarantineMode,
      quarantineDays: Math.max(1, Math.floor(settings.quarantineDays) || 7),
    };
  }

  /** Share template + bonus knobs для ЛК (без секретов). */
  async getBuyerShare(): Promise<{
    shareTextTemplate: string;
    inviteeBonusEnabled: boolean;
    inviteeBonusRub: number;
  }> {
    const settings = await this.settings.ensureDefaults();
    return {
      shareTextTemplate: settings.shareText,
      inviteeBonusEnabled: settings.inviteeBonusEnabled,
      inviteeBonusRub: settings.inviteeBonusRub,
    };
  }

  /**
   * Preview / createOrder: сколько можно списать с учётом balance + cap.
   * `enabled=false` гейтит только новые EARN — spend с уже накопленного баланса
   * разрешён (иначе «баланс сохраняется» был бы ложью).
   */
  async quoteSpend(
    userId: string,
    payableRub: number,
  ): Promise<{
    enabled: boolean;
    available: number;
    spendCapPercent: number;
    amount: number;
    debt: number;
  }> {
    const settings = await this.settings.ensureDefaults();
    const [available, debt] = await Promise.all([
      this.availableBalance(userId),
      this.debtBalance(userId),
    ]);
    if (debt > 0) {
      return {
        enabled: settings.enabled,
        available,
        spendCapPercent: settings.spendCapPercent,
        amount: 0,
        debt,
      };
    }
    return {
      enabled: settings.enabled,
      available,
      spendCapPercent: settings.spendCapPercent,
      amount: this.computeSpendAmount({
        available,
        payableRub,
        spendCapPercent: settings.spendCapPercent,
      }),
      debt: 0,
    };
  }

  /**
   * Hold при create / re-hold после clamp (как gift CAPTURE).
   * Первый hold: spend_hold:orderId; повтор после RELEASE — :2, :3…
   */
  async holdSpendInTx(
    tx: TxClient,
    opts: { userId: string; orderId: string; amount: number; note?: string },
  ): Promise<void> {
    const amount = Math.floor(opts.amount);
    if (amount < 1) {
      throw new BadRequestException('Сумма списания с реф. баланса должна быть ≥ 1');
    }
    await lockReferralWalletUser(tx, opts.userId);
    const debt = await this.sumDebt(tx, opts.userId);
    if (debt > 0) {
      throw new BadRequestException(
        'Реферальный баланс заблокирован: есть долг по clawback. Дождитесь погашения из новых начислений.',
      );
    }
    const available = Math.max(0, await this.sumPosted(tx, opts.userId));
    if (available < amount) {
      throw new BadRequestException('Недостаточно средств на реферальном балансе');
    }
    const priorHolds = await tx.referralWalletLedger.count({
      where: {
        orderId: opts.orderId,
        kind: ReferralLedgerKind.SPEND_HOLD,
      },
    });
    const seq = priorHolds + 1;
    const idempotencyKey = SPEND_HOLD_KEY(opts.orderId, seq);
    try {
      await tx.referralWalletLedger.create({
        data: {
          userId: opts.userId,
          kind: ReferralLedgerKind.SPEND_HOLD,
          status: ReferralLedgerStatus.POSTED,
          amount: -amount,
          balanceAfter: available - amount,
          orderId: opts.orderId,
          idempotencyKey,
          note: opts.note?.trim() || 'Резерв реф. баланса под заказ',
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Идемпотентный retry: silent return только если |amount| совпадает.
        const existing = await tx.referralWalletLedger.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: opts.userId,
              idempotencyKey,
            },
          },
          select: { amount: true },
        });
        if (!existing || Math.abs(existing.amount) !== amount) {
          throw new BadRequestException(
            'Конфликт резерва реф. баланса: сумма не совпадает с уже записанным hold',
          );
        }
        return;
      }
      throw e;
    }
  }

  /**
   * RELEASE outstanding HOLD−RELEASE (как gift). Идемпотентно при net=0.
   * `opts.amount` — потолок (частичный refund); без него — весь net.
   * Seq key: spend_release:orderId, затем :2…
   * @returns фактически возвращённая сумма (0 если нечего).
   */
  async releaseSpendInTx(
    tx: TxClient,
    orderId: string,
    opts?: { note?: string; amount?: number },
  ): Promise<number> {
    const entries = await tx.referralWalletLedger.findMany({
      where: {
        orderId,
        status: ReferralLedgerStatus.POSTED,
        kind: {
          in: [ReferralLedgerKind.SPEND_HOLD, ReferralLedgerKind.SPEND_RELEASE],
        },
      },
      select: { userId: true, kind: true, amount: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!entries.length) return 0;

    let net = 0;
    let userId = '';
    let releaseCount = 0;
    for (const e of entries) {
      if (e.kind === ReferralLedgerKind.SPEND_HOLD) {
        net += Math.abs(e.amount);
        userId = e.userId;
      } else {
        net -= Math.max(0, e.amount);
        releaseCount += 1;
      }
    }
    const outstanding = Math.floor(net);
    if (outstanding < 1 || !userId) return 0;

    const cap =
      opts?.amount != null ? Math.max(0, Math.floor(opts.amount)) : outstanding;
    const restore = Math.min(outstanding, cap);
    if (restore < 1) return 0;

    await lockReferralWalletUser(tx, userId);
    const available = await this.sumPosted(tx, userId);
    const note = opts?.note?.trim() || 'Возврат реф. баланса при отмене заказа';
    const seq = releaseCount + 1;
    try {
      await tx.referralWalletLedger.create({
        data: {
          userId,
          kind: ReferralLedgerKind.SPEND_RELEASE,
          status: ReferralLedgerStatus.POSTED,
          amount: restore,
          balanceAfter: available + restore,
          orderId,
          idempotencyKey: SPEND_RELEASE_KEY(orderId, seq),
          note,
        },
      });
      // Доступный баланс вырос — погасить DEBT (не только из postEarn).
      await this.repayDebtFromAvailable(
        tx,
        userId,
        SPEND_RELEASE_KEY(orderId, seq),
      );
      return restore;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return 0;
      }
      throw e;
    }
  }

  /**
   * Clamp состава: RELEASE net + optional re-HOLD новой суммы (как gift).
   */
  async replaceSpendHoldInTx(
    tx: TxClient,
    opts: {
      userId: string;
      orderId: string;
      amount: number;
      note?: string;
    },
  ): Promise<void> {
    await this.releaseSpendInTx(tx, opts.orderId, {
      note: opts.note?.trim() || 'Пересчёт реф. баланса при изменении состава',
    });
    if (opts.amount >= 1) {
      await this.holdSpendInTx(tx, {
        userId: opts.userId,
        orderId: opts.orderId,
        amount: opts.amount,
        note: opts.note?.trim() || 'Резерв реф. баланса после пересчёта состава',
      });
    }
  }

  private computeEarnAmount(base: number, pct: number): number {
    if (base <= 0 || pct <= 0) return 0;
    return Math.max(0, Math.floor((base * pct) / 100));
  }

  private async hasPriorGoodsPurchaseExcluding(
    tx: TxClient,
    order: {
      id: string;
      email: string;
      phone: string;
      userId: string | null;
    },
  ): Promise<boolean> {
    const email = order.email.trim().toLowerCase();
    const phone = order.phone?.trim() || null;
    const userId = order.userId?.trim() || null;
    const or: Prisma.OrderWhereInput[] = [{ email }];
    if (phone) or.push({ phone });
    if (userId) or.push({ userId });

    const n = await tx.order.count({
      where: {
        OR: or,
        status: { in: PRIOR_PURCHASE_STATUSES },
        giftPurchaseDenominationId: null,
        NOT: { id: order.id },
      },
    });
    return n > 0;
  }

  /**
   * EVERY + окно: до maxOrders EARN с первой товарной покупки покупателя
   * в течение windowDays (0 = lifetime).
   */
  private async isWithinEarnWindow(
    tx: TxClient,
    order: {
      id: string;
      email: string;
      phone: string;
      userId: string | null;
      paidAt: Date | null;
    },
    opts: { maxOrders: number; windowDays: number },
  ): Promise<boolean> {
    const maxOrders = Math.max(1, Math.floor(opts.maxOrders));
    const windowDays = Math.max(0, Math.floor(opts.windowDays));
    const email = order.email.trim().toLowerCase();
    const phone = order.phone?.trim() || null;
    const userId = order.userId?.trim() || null;
    const or: Prisma.OrderWhereInput[] = [{ email }];
    if (phone) or.push({ phone });
    if (userId) or.push({ userId });

    const first = await tx.order.findFirst({
      where: {
        OR: or,
        status: { in: PRIOR_PURCHASE_STATUSES },
        giftPurchaseDenominationId: null,
        paidAt: { not: null },
      },
      orderBy: { paidAt: 'asc' },
      select: { paidAt: true },
    });
    const firstPaidAt = first?.paidAt ?? order.paidAt ?? new Date();
    if (windowDays > 0) {
      const anchor = order.paidAt ?? new Date();
      const ageMs = anchor.getTime() - firstPaidAt.getTime();
      if (ageMs > windowDays * 24 * 60 * 60_000) return false;
    }

    const priorEarns = await tx.referralWalletLedger.count({
      where: {
        kind: ReferralLedgerKind.EARN,
        status: {
          in: [ReferralLedgerStatus.PENDING, ReferralLedgerStatus.POSTED],
        },
        orderId: { not: order.id },
        order: {
          OR: or,
          giftPurchaseDenominationId: null,
        },
      },
    });
    return priorEarns < maxOrders;
  }

  /** Сколько ₽ ещё можно начислить рефереру в текущем UTC-месяце. */
  private async monthlyEarnRoom(
    tx: TxClient,
    referrerUserId: string,
    capRub: number,
  ): Promise<number> {
    const cap = Math.max(0, Math.floor(capRub));
    if (cap <= 0) return Number.MAX_SAFE_INTEGER;
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const agg = await tx.referralWalletLedger.aggregate({
      where: {
        userId: referrerUserId,
        kind: ReferralLedgerKind.EARN,
        status: {
          in: [ReferralLedgerStatus.PENDING, ReferralLedgerStatus.POSTED],
        },
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });
    return Math.max(0, cap - (agg._sum.amount ?? 0));
  }

  private async createPendingEarn(
    tx: TxClient,
    input: {
      referrerUserId: string;
      orderId: string;
      amount: number;
      paidAt: Date | null;
      meta: EarnMeta;
      /** addressMatchSuspect — не ставить availableAt до approve. */
      holdAvailableAt?: boolean;
    },
  ): Promise<void> {
    try {
      await tx.referralWalletLedger.create({
        data: {
          userId: input.referrerUserId,
          kind: ReferralLedgerKind.EARN,
          status: ReferralLedgerStatus.PENDING,
          amount: input.amount,
          orderId: input.orderId,
          idempotencyKey: EARN_KEY(input.orderId),
          note: encodeEarnMeta(input.meta),
          qMode: input.meta.qMode,
          qDays: input.meta.qDays,
          earnBase: input.meta.base,
          earnPct: input.meta.pct,
          availableAt: input.holdAvailableAt
            ? null
            : computeAvailableAt(
                input.meta.qMode,
                input.meta.qDays,
                input.paidAt,
              ),
        },
      });
      this.scheduleReferralMail('created', {
        userId: input.referrerUserId,
        amount: input.amount,
        orderId: input.orderId,
        kindLabel: 'реферальное начисление',
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
  }

  /**
   * Бонус приглашённому за первый qualifying заказ по ?mf=.
   * Политика: только auth (order.userId). Guest → 0, без отложенного credit при
   * позднем bind user (иначе PII/identity race). Snapshot quarantine как у EARN.
   */
  private async maybeCreditInviteeBonus(
    tx: TxClient,
    opts: {
      order: {
        id: string;
        email: string;
        phone: string;
        userId: string | null;
        status: OrderStatus;
        paidAt: Date | null;
      };
      settings: {
        inviteeBonusEnabled: boolean;
        inviteeBonusRub: number;
        minOrderRub: number;
        enabledAt: Date | null;
        quarantineMode: ReferralQuarantineMode;
        quarantineDays: number;
      };
      base: number;
      referrerUserId: string;
      attributionCreatedAt: Date;
      /** false → не создавать новый INVITEE_BONUS; post существующих — да. */
      programEnabled: boolean;
      /** true → не POSTED / не ставить availableAt до approve. */
      addressMatchSuspect?: boolean;
    },
  ): Promise<void> {
    const inviteeUserId = opts.order.userId?.trim() || '';
    if (!inviteeUserId) return;
    if (inviteeUserId === opts.referrerUserId) return;

    const existing = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: inviteeUserId,
          idempotencyKey: INVITEE_BONUS_KEY(opts.order.id),
        },
      },
    });

    if (!existing) {
      if (!opts.programEnabled) return;
      if (!opts.settings.inviteeBonusEnabled) return;
      const bonusRub = Math.max(0, Math.floor(opts.settings.inviteeBonusRub));
      if (bonusRub < 1) return;
      if (opts.base < opts.settings.minOrderRub) return;
      if (
        !opts.settings.enabledAt ||
        opts.attributionCreatedAt < opts.settings.enabledAt
      ) {
        return;
      }
      const priorPurchase = await this.hasPriorGoodsPurchaseExcluding(tx, opts.order);
      if (priorPurchase) return;

      // Lifetime: advisory lock + partial unique (userId) WHERE INVITEE_BONUS
      // PENDING|POSTED — count-only гоняется с параллельным touch.
      await lockReferralWalletUser(tx, inviteeUserId);
      const priorBonus = await tx.referralWalletLedger.count({
        where: {
          userId: inviteeUserId,
          kind: ReferralLedgerKind.INVITEE_BONUS,
          status: {
            in: [ReferralLedgerStatus.PENDING, ReferralLedgerStatus.POSTED],
          },
        },
      });
      if (priorBonus > 0) return;

      await this.createPendingInviteeBonus(tx, {
        inviteeUserId,
        orderId: opts.order.id,
        amount: bonusRub,
        paidAt: opts.order.paidAt,
        holdAvailableAt: opts.addressMatchSuspect === true,
        meta: {
          base: bonusRub,
          pct: 100,
          qMode: opts.settings.quarantineMode,
          qDays: Math.max(1, opts.settings.quarantineDays),
        },
      });
    }

    const row = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: inviteeUserId,
          idempotencyKey: INVITEE_BONUS_KEY(opts.order.id),
        },
      },
    });
    if (!row || row.status !== ReferralLedgerStatus.PENDING) return;

    const holdAddress = opts.addressMatchSuspect === true;
    if (holdAddress) return;

    const q = resolveQuarantine(earnMetaFromRow(row), opts.settings);
    if (
      q.qMode === ReferralQuarantineMode.DAYS_AFTER_PAID &&
      !row.availableAt
    ) {
      const at = computeAvailableAt(q.qMode, q.qDays, opts.order.paidAt);
      if (at) {
        await tx.referralWalletLedger.update({
          where: { id: row.id },
          data: { availableAt: at },
        });
        if (at.getTime() <= Date.now()) {
          await this.postEarn(tx, row.id, inviteeUserId, row.amount, {
            orderId: opts.order.id,
            kindLabel: 'бонус приглашённому',
          });
        }
      }
      return;
    }
    if (opts.order.status === OrderStatus.DELIVERED) {
      if (q.qMode === ReferralQuarantineMode.DELIVERED) {
        await this.postEarn(tx, row.id, inviteeUserId, row.amount, {
          orderId: opts.order.id,
          kindLabel: 'бонус приглашённому',
        });
      } else if (
        q.qMode === ReferralQuarantineMode.DELIVERED_PLUS_DAYS &&
        !row.availableAt
      ) {
        await tx.referralWalletLedger.update({
          where: { id: row.id },
          data: {
            availableAt: computeDeliveredPlusAvailableAt(q.qDays, new Date()),
          },
        });
      }
    }
  }

  private async createPendingInviteeBonus(
    tx: TxClient,
    input: {
      inviteeUserId: string;
      orderId: string;
      amount: number;
      paidAt: Date | null;
      meta: EarnMeta;
      holdAvailableAt?: boolean;
    },
  ): Promise<void> {
    try {
      await tx.referralWalletLedger.create({
        data: {
          userId: input.inviteeUserId,
          kind: ReferralLedgerKind.INVITEE_BONUS,
          status: ReferralLedgerStatus.PENDING,
          amount: input.amount,
          orderId: input.orderId,
          idempotencyKey: INVITEE_BONUS_KEY(input.orderId),
          note: encodeEarnMeta(input.meta),
          qMode: input.meta.qMode,
          qDays: input.meta.qDays,
          earnBase: input.meta.base,
          earnPct: input.meta.pct,
          availableAt: input.holdAvailableAt
            ? null
            : computeAvailableAt(
                input.meta.qMode,
                input.meta.qDays,
                input.paidAt,
              ),
        },
      });
      this.scheduleReferralMail('created', {
        userId: input.inviteeUserId,
        amount: input.amount,
        orderId: input.orderId,
        kindLabel: 'бонус приглашённому',
      });
    } catch (e) {
      // userId+idempotencyKey ИЛИ partial unique lifetime INVITEE_BONUS
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
  }

  private async handleInviteeBonusCancel(
    tx: TxClient,
    order: { id: string; userId: string | null },
  ): Promise<void> {
    const inviteeUserId = order.userId?.trim() || '';
    if (!inviteeUserId) return;
    const existing = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: inviteeUserId,
          idempotencyKey: INVITEE_BONUS_KEY(order.id),
        },
      },
    });
    if (!existing) return;
    if (existing.status === ReferralLedgerStatus.PENDING) {
      await tx.referralWalletLedger.update({
        where: { id: existing.id },
        data: { status: ReferralLedgerStatus.VOIDED, availableAt: null },
      });
      return;
    }
    if (existing.status === ReferralLedgerStatus.POSTED) {
      await this.clawbackIfNeeded(tx, {
        orderId: order.id,
        referrerUserId: inviteeUserId,
        existingEarn: existing,
        currentBase: 0,
        source: 'invitee',
      });
    }
  }

  private async postEarn(
    tx: TxClient,
    earnId: string,
    userId: string,
    amount: number,
    opts?: {
      orderId?: string | null;
      kindLabel?: string;
    },
  ): Promise<void> {
    await lockReferralWalletUser(tx, userId);
    const bal = await this.sumPosted(tx, userId);
    await tx.referralWalletLedger.update({
      where: { id: earnId },
      data: {
        status: ReferralLedgerStatus.POSTED,
        balanceAfter: bal + amount,
        availableAt: null,
      },
    });
    this.scheduleReferralMail('posted', {
      userId,
      amount,
      orderId: opts?.orderId,
      kindLabel: opts?.kindLabel || 'реферальное начисление',
    });
    // Погасить clawback-долг из только что доступных средств.
    await this.repayDebtFromAvailable(tx, userId, earnId);
  }

  /** Available POSTED без DEBT. */
  private async sumPosted(tx: TxClient, userId: string): Promise<number> {
    const agg = await tx.referralWalletLedger.aggregate({
      where: {
        userId,
        status: ReferralLedgerStatus.POSTED,
        kind: { not: ReferralLedgerKind.DEBT },
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  private async sumDebt(tx: TxClient, userId: string): Promise<number> {
    const agg = await tx.referralWalletLedger.aggregate({
      where: {
        userId,
        status: ReferralLedgerStatus.POSTED,
        kind: ReferralLedgerKind.DEBT,
      },
      _sum: { amount: true },
    });
    return Math.max(0, agg._sum.amount ?? 0);
  }

  /**
   * После любого положительного POSTED (EARN / RELEASE / ADJUST+):
   * списать min(debt, available) как CLAWBACK debt и уменьшить DEBT (FIFO).
   */
  private async repayDebtFromAvailable(
    tx: TxClient,
    userId: string,
    sourceKey: string,
  ): Promise<void> {
    const debt = await this.sumDebt(tx, userId);
    if (debt <= 0) return;
    const available = Math.max(0, await this.sumPosted(tx, userId));
    const repay = Math.min(debt, available);
    if (repay <= 0) return;

    const key = DEBT_REPAY_KEY(sourceKey);
    try {
      await tx.referralWalletLedger.create({
        data: {
          userId,
          kind: ReferralLedgerKind.CLAWBACK,
          status: ReferralLedgerStatus.POSTED,
          amount: -repay,
          balanceAfter: available - repay,
          idempotencyKey: key,
          source: 'debt',
          note: `clawback debt; repay=${repay}; from=${sourceKey}`,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return;
      }
      throw e;
    }

    let left = repay;
    const debts = await tx.referralWalletLedger.findMany({
      where: {
        userId,
        kind: ReferralLedgerKind.DEBT,
        status: ReferralLedgerStatus.POSTED,
        amount: { gt: 0 },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, amount: true },
    });
    for (const row of debts) {
      if (left <= 0) break;
      const take = Math.min(row.amount, left);
      const next = row.amount - take;
      if (next <= 0) {
        await tx.referralWalletLedger.update({
          where: { id: row.id },
          data: {
            amount: 0,
            status: ReferralLedgerStatus.VOIDED,
            note: `debt repaid; was=${row.amount}`,
          },
        });
      } else {
        await tx.referralWalletLedger.update({
          where: { id: row.id },
          data: {
            amount: next,
            note: `debt partial; was=${row.amount}; left=${next}`,
          },
        });
      }
      left -= take;
    }
  }

  /** Upsert DEBT (положительная сумма долга; не в available). shortfall≤0 → void. */
  private async upsertDebt(
    tx: TxClient,
    input: {
      userId: string;
      orderId: string;
      source: 'earn' | 'invitee';
      shortfall: number;
      owed: number;
    },
  ): Promise<void> {
    const key = DEBT_KEY(input.orderId, input.source);
    const shortfall = Math.max(0, Math.floor(input.shortfall));
    const existing = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: { userId: input.userId, idempotencyKey: key },
      },
      select: { id: true, status: true },
    });

    if (shortfall <= 0) {
      if (existing && existing.status === ReferralLedgerStatus.POSTED) {
        await tx.referralWalletLedger.update({
          where: { id: existing.id },
          data: {
            amount: 0,
            status: ReferralLedgerStatus.VOIDED,
            note: `debt cleared; owed=${input.owed}`,
          },
        });
      }
      return;
    }

    const notePrefix =
      input.source === 'invitee' ? 'debt invitee' : 'debt earn';
    if (!existing) {
      try {
        await tx.referralWalletLedger.create({
          data: {
            userId: input.userId,
            kind: ReferralLedgerKind.DEBT,
            status: ReferralLedgerStatus.POSTED,
            amount: shortfall,
            balanceAfter: null,
            orderId: input.orderId,
            idempotencyKey: key,
            source: input.source,
            note: `${notePrefix}; owed=${input.owed}; shortfall=${shortfall}`,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return;
        }
        throw e;
      }
      return;
    }

    await tx.referralWalletLedger.update({
      where: { id: existing.id },
      data: {
        kind: ReferralLedgerKind.DEBT,
        status: ReferralLedgerStatus.POSTED,
        amount: shortfall,
        source: input.source,
        note: `${notePrefix}; owed=${input.owed}; shortfall=${shortfall}`,
      },
    });
  }

  private async handleCancelOrFullRefund(
    tx: TxClient,
    input: {
      orderId: string;
      referrerUserId: string;
      existingEarn: {
        id: string;
        status: ReferralLedgerStatus;
        amount: number;
        note: string | null;
      } | null;
    },
  ): Promise<void> {
    if (!input.existingEarn) return;
    if (input.existingEarn.status === ReferralLedgerStatus.PENDING) {
      await tx.referralWalletLedger.update({
        where: { id: input.existingEarn.id },
        data: { status: ReferralLedgerStatus.VOIDED, availableAt: null },
      });
      return;
    }
    if (input.existingEarn.status === ReferralLedgerStatus.POSTED) {
      await this.clawbackIfNeeded(tx, {
        orderId: input.orderId,
        referrerUserId: input.referrerUserId,
        existingEarn: input.existingEarn,
        currentBase: 0,
      });
    }
  }

  /**
   * Clawback до target (snapshot pct).
   * source=earn|invitee — раздельные note/seq-учёт, чтобы earnedNet не мешал invitee.
   * Advisory lock → re-read balance → seq key (не early-return по refundedAmount).
   */
  private async clawbackIfNeeded(
    tx: TxClient,
    input: {
      orderId: string;
      referrerUserId: string;
      existingEarn: {
        id: string;
        amount: number;
        note: string | null;
        status: ReferralLedgerStatus;
        earnPct?: number | null;
        earnBase?: number | null;
        qMode?: ReferralQuarantineMode | null;
        qDays?: number | null;
      };
      currentBase: number;
      /** Default earn (реферер). invitee — clawback INVITEE_BONUS. */
      source?: 'earn' | 'invitee';
    },
  ): Promise<void> {
    if (input.existingEarn.status !== ReferralLedgerStatus.POSTED) return;

    const source = input.source ?? 'earn';
    const notePrefix =
      source === 'invitee' ? 'clawback invitee' : 'clawback earn';

    const meta = earnMetaFromRow(input.existingEarn);
    const pct = meta?.pct ?? 0;
    const target =
      input.currentBase <= 0 || pct <= 0
        ? 0
        : this.computeEarnAmount(input.currentBase, pct);
    const original = input.existingEarn.amount;
    const needed = Math.max(0, original - target);
    if (needed <= 0) return;

    await lockReferralWalletUser(tx, input.referrerUserId);

    const priorClawbacks = await tx.referralWalletLedger.findMany({
      where: {
        userId: input.referrerUserId,
        orderId: input.orderId,
        kind: ReferralLedgerKind.CLAWBACK,
        status: ReferralLedgerStatus.POSTED,
        // Колонка source; legacy note prefix — OR для старых строк.
        OR: [{ source }, { source: null, note: { startsWith: notePrefix } }],
      },
      select: { amount: true },
      orderBy: { createdAt: 'asc' },
    });
    const alreadyClawed = priorClawbacks.reduce(
      (s, r) => s + Math.abs(r.amount),
      0,
    );
    // DEBT.amount — остаток после погашений из будущих EARN (clawback debt).
    // Иначе repay уменьшил DEBT, а needed−alreadyClawed снова завысит shortfall.
    const debtKey = DEBT_KEY(input.orderId, source);
    const debtRow = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: input.referrerUserId,
          idempotencyKey: debtKey,
        },
      },
      select: { amount: true, status: true },
    });
    const remainingFromClawbacks = Math.max(0, needed - alreadyClawed);
    // DEBT VOIDED (погашен из будущих EARN) — долг закрыт; needed−clawback(earn)
    // не включает repay(source=debt) и иначе снимет available повторно.
    let remaining: number;
    if (debtRow && debtRow.status !== ReferralLedgerStatus.POSTED) {
      remaining = 0;
    } else if (
      debtRow?.status === ReferralLedgerStatus.POSTED &&
      debtRow.amount > 0
    ) {
      remaining = Math.min(remainingFromClawbacks, debtRow.amount);
    } else {
      remaining = remainingFromClawbacks;
    }
    if (remaining <= 0) {
      if (debtRow?.status === ReferralLedgerStatus.POSTED) {
        await this.upsertDebt(tx, {
          userId: input.referrerUserId,
          orderId: input.orderId,
          source,
          shortfall: 0,
          owed: needed,
        });
      }
      return;
    }

    // Re-read under lock — не TOCTOU с параллельным spend/clawback.
    const available = Math.max(0, await this.sumPosted(tx, input.referrerUserId));
    const take = Math.min(remaining, available);

    if (take > 0) {
      const seq = priorClawbacks.length + 1;
      const key =
        source === 'invitee'
          ? `clawback_invitee:${input.orderId}:${seq}`
          : CLAWBACK_SEQ_KEY(input.orderId, seq);
      const balAfter = available - take;
      try {
        await tx.referralWalletLedger.create({
          data: {
            userId: input.referrerUserId,
            kind: ReferralLedgerKind.CLAWBACK,
            status: ReferralLedgerStatus.POSTED,
            amount: -take,
            balanceAfter: balAfter,
            orderId: input.orderId,
            idempotencyKey: key,
            source,
            note: `${notePrefix}; target=${target}; original=${original}; owed=${needed}; seq=${seq}`,
          },
        });
        this.scheduleReferralMail('clawback', {
          userId: input.referrerUserId,
          amount: take,
          orderId: input.orderId,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return;
        }
        throw e;
      }
    }

    const shortfall = remaining - take;
    if (shortfall > 0) {
      this.logger.warn(
        `referral clawback debt order=${input.orderId} needed=${remaining} took=${take} debt=${shortfall}`,
      );
    }
    await this.upsertDebt(tx, {
      userId: input.referrerUserId,
      orderId: input.orderId,
      source,
      shortfall,
      owed: needed,
    });
  }

  // ─── Admin (Phase 5) ─────────────────────────────────────────────

  /**
   * Список рефереров: code, available, pending,
   * earnedGross/Net, invitees (# attributions), gmv (Σ goods paid-like).
   * sort: id | earned | invitees | gmv (default earned desc).
   */
  async listReferrers(opts?: {
    q?: string | null;
    limit?: number;
    /** Offset-пагинация (для sort ≠ id и единообразия). */
    offset?: number | null;
    /** @deprecated keyset по id; игнорируется если sort ≠ id. */
    cursor?: string | null;
    sort?: 'id' | 'earned' | 'invitees' | 'gmv' | null;
    dir?: 'asc' | 'desc' | null;
  }): Promise<{
    items: Array<{
      userId: string;
      email: string;
      displayName: string | null;
      referralCode: string;
      referralCodeActive: boolean;
      available: number;
      pending: number;
      /** Σ EARN PENDING|POSTED (без вычета clawback). */
      earnedGross: number;
      /** max(0, earnedGross − |CLAWBACK earn| − |CLAWBACK debt|). */
      earnedNet: number;
      /** |CLAWBACK invitee| — не входит в earnedNet. */
      inviteeClawback: number;
      /** Число заказов с attribution (приглашённые заказы). */
      invitees: number;
      /** Σ (subtotal − discount) по paid-like attributed заказам. */
      gmv: number;
    }>;
    nextCursor: string | null;
    nextOffset: number | null;
    sort: 'id' | 'earned' | 'invitees' | 'gmv';
    dir: 'asc' | 'desc';
  }> {
    const take = Math.min(50, Math.max(1, Math.floor(opts?.limit ?? 20)));
    const q = opts?.q?.trim() || '';
    const sortRaw = (opts?.sort ?? 'earned').trim().toLowerCase();
    const sort: 'id' | 'earned' | 'invitees' | 'gmv' =
      sortRaw === 'id' ||
      sortRaw === 'invitees' ||
      sortRaw === 'gmv' ||
      sortRaw === 'earned'
        ? sortRaw
        : 'earned';
    const dir: 'asc' | 'desc' =
      (opts?.dir ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
    const cursorId =
      sort === 'id' ? opts?.cursor?.trim() || null : null;

    const SCAN_CAP = 2000;
    const users = await this.prisma.user.findMany({
      where: {
        referralCode: { not: null },
        ...(cursorId ? { id: { lt: cursorId } } : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { referralCode: { contains: q, mode: 'insensitive' } },
                { displayName: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: sort === 'id' && cursorId ? take + 1 : SCAN_CAP,
      select: {
        id: true,
        email: true,
        displayName: true,
        referralCode: true,
        referralCodeActive: true,
      },
    });

    const ids = users.map((u) => u.id);
    if (!ids.length) {
      return {
        items: [],
        nextCursor: null,
        nextOffset: null,
        sort,
        dir,
      };
    }

    const [posted, pendingRows, earnedRows, earnClawbackRows, inviteeClawbackRows, gmvRows] =
      await Promise.all([
        this.prisma.referralWalletLedger.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            status: ReferralLedgerStatus.POSTED,
            kind: { not: ReferralLedgerKind.DEBT },
          },
          _sum: { amount: true },
        }),
        this.prisma.referralWalletLedger.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            status: ReferralLedgerStatus.PENDING,
            kind: {
              in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
            },
          },
          _sum: { amount: true },
        }),
        this.prisma.referralWalletLedger.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            kind: ReferralLedgerKind.EARN,
            status: {
              in: [ReferralLedgerStatus.PENDING, ReferralLedgerStatus.POSTED],
            },
          },
          _sum: { amount: true },
        }),
        this.prisma.referralWalletLedger.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            kind: ReferralLedgerKind.CLAWBACK,
            status: ReferralLedgerStatus.POSTED,
            OR: [
              { source: 'earn' },
              { source: 'debt' },
              { source: null, note: { startsWith: 'clawback earn' } },
              { source: null, note: { startsWith: 'clawback debt' } },
            ],
          },
          _sum: { amount: true },
        }),
        this.prisma.referralWalletLedger.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            kind: ReferralLedgerKind.CLAWBACK,
            status: ReferralLedgerStatus.POSTED,
            OR: [
              { source: 'invitee' },
              { source: null, note: { startsWith: 'clawback invitee' } },
            ],
          },
          _sum: { amount: true },
        }),
        this.prisma.$queryRaw<
          Array<{ referrerUserId: string; invitees: bigint; gmv: bigint }>
        >(Prisma.sql`
          SELECT a."referrerUserId" AS "referrerUserId",
                 COUNT(*)::bigint AS invitees,
                 COALESCE(SUM(
                   CASE
                     WHEN o.status::text IN ('PAID','PACKING','SHIPPED','DELIVERED')
                     THEN GREATEST(0, o.subtotal - o."discountTotal")
                     ELSE 0
                   END
                 ), 0)::bigint AS gmv
          FROM "OrderReferralAttribution" a
          JOIN "Order" o ON o.id = a."orderId"
          WHERE a."referrerUserId" IN (${Prisma.join(ids)})
          GROUP BY a."referrerUserId"
        `),
      ]);

    const postedMap = new Map(
      posted.map((r) => [r.userId, r._sum.amount ?? 0]),
    );
    const pendingMap = new Map(
      pendingRows.map((r) => [r.userId, r._sum.amount ?? 0]),
    );
    const earnedMap = new Map(
      earnedRows.map((r) => [r.userId, r._sum.amount ?? 0]),
    );
    const earnClawbackMap = new Map(
      earnClawbackRows.map((r) => [r.userId, Math.abs(r._sum.amount ?? 0)]),
    );
    const inviteeClawbackMap = new Map(
      inviteeClawbackRows.map((r) => [r.userId, Math.abs(r._sum.amount ?? 0)]),
    );
    const inviteesMap = new Map(
      gmvRows.map((r) => [r.referrerUserId, Number(r.invitees)]),
    );
    const gmvMap = new Map(
      gmvRows.map((r) => [r.referrerUserId, Number(r.gmv)]),
    );

    const enriched = users.map((u) => {
      const earnedGross = Math.max(0, earnedMap.get(u.id) ?? 0);
      const earnClawed = earnClawbackMap.get(u.id) ?? 0;
      return {
        userId: u.id,
        email: u.email,
        displayName: u.displayName,
        referralCode: u.referralCode!,
        referralCodeActive: u.referralCodeActive,
        available: Math.max(0, postedMap.get(u.id) ?? 0),
        pending: Math.max(0, pendingMap.get(u.id) ?? 0),
        earnedGross,
        earnedNet: Math.max(0, earnedGross - earnClawed),
        inviteeClawback: inviteeClawbackMap.get(u.id) ?? 0,
        invitees: inviteesMap.get(u.id) ?? 0,
        gmv: gmvMap.get(u.id) ?? 0,
      };
    });

    const mul = dir === 'asc' ? 1 : -1;
    enriched.sort((a, b) => {
      let cmp = 0;
      if (sort === 'earned') cmp = a.earnedGross - b.earnedGross;
      else if (sort === 'invitees') cmp = a.invitees - b.invitees;
      else if (sort === 'gmv') cmp = a.gmv - b.gmv;
      else cmp = a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
      if (cmp !== 0) return cmp * mul;
      // tie-break: id desc
      return a.userId < b.userId ? 1 : a.userId > b.userId ? -1 : 0;
    });

    if (sort === 'id' && cursorId) {
      const page = enriched.slice(0, take);
      const last = page[page.length - 1];
      return {
        items: page,
        nextCursor: enriched.length > take && last ? last.userId : null,
        nextOffset: null,
        sort,
        dir,
      };
    }

    const page = enriched.slice(offset, offset + take);
    const nextOff = offset + take;
    return {
      items: page,
      nextCursor: null,
      nextOffset: nextOff < enriched.length ? nextOff : null,
      sort,
      dir,
    };
  }

  /**
   * Сводка обязательств: Σ available (POSTED без DEBT) + Σ pending EARN|INVITEE.
   */
  async getLiability(): Promise<{
    available: number;
    pending: number;
    liability: number;
    debt: number;
  }> {
    const [posted, pending, debt] = await Promise.all([
      this.prisma.referralWalletLedger.aggregate({
        where: {
          status: ReferralLedgerStatus.POSTED,
          kind: { not: ReferralLedgerKind.DEBT },
        },
        _sum: { amount: true },
      }),
      this.prisma.referralWalletLedger.aggregate({
        where: {
          status: ReferralLedgerStatus.PENDING,
          kind: {
            in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.referralWalletLedger.aggregate({
        where: {
          status: ReferralLedgerStatus.POSTED,
          kind: ReferralLedgerKind.DEBT,
        },
        _sum: { amount: true },
      }),
    ]);
    const available = Math.max(0, posted._sum.amount ?? 0);
    const pendingSum = Math.max(0, pending._sum.amount ?? 0);
    return {
      available,
      pending: pendingSum,
      liability: available + pendingSum,
      debt: Math.max(0, debt._sum.amount ?? 0),
    };
  }

  /**
   * Ручная корректировка баланса (ADJUST). amount ±₽; available не уходит в минус.
   * Idempotency: client Idempotency-Key или hash(actor+user+amount+note+60s bucket).
   */
  async adminAdjust(opts: {
    userId: string;
    amount: number;
    note?: string | null;
    actorUserId: string;
    clientIdempotencyKey?: string | null;
  }): Promise<{ available: number; amount: number; replayed: boolean }> {
    const amount = Math.trunc(opts.amount);
    if (amount === 0) {
      throw new BadRequestException('Сумма корректировки не может быть 0');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: opts.userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    const note =
      opts.note?.trim() ||
      (amount > 0 ? 'Ручное начисление' : 'Ручное списание');
    const idempotencyKey = buildAdjustIdempotencyKey({
      userId: opts.userId,
      actorUserId: opts.actorUserId,
      amount,
      note,
      clientKey: opts.clientIdempotencyKey,
    });

    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const tx = this.prisma as unknown as TxClient;
      await lockReferralWalletUser(tx, opts.userId);

      const existing = await tx.referralWalletLedger.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: opts.userId,
            idempotencyKey,
          },
        },
        select: { amount: true, kind: true },
      });
      if (existing) {
        if (
          existing.kind !== ReferralLedgerKind.ADJUST ||
          existing.amount !== amount
        ) {
          throw new BadRequestException(
            'Конфликт Idempotency-Key: сумма/тип не совпадает с уже записанным ADJUST',
          );
        }
        const available = Math.max(0, await this.sumPosted(tx, opts.userId));
        return { available, amount, replayed: true };
      }

      const available = Math.max(0, await this.sumPosted(tx, opts.userId));
      if (amount < 0 && available + amount < 0) {
        throw new BadRequestException(
          `Недостаточно баланса для списания (доступно ${available} ₽)`,
        );
      }
      const balAfter = available + amount;
      try {
        await tx.referralWalletLedger.create({
          data: {
            userId: opts.userId,
            kind: ReferralLedgerKind.ADJUST,
            status: ReferralLedgerStatus.POSTED,
            amount,
            balanceAfter: balAfter,
            idempotencyKey,
            actorUserId: opts.actorUserId,
            note,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          const again = await tx.referralWalletLedger.findUnique({
            where: {
              userId_idempotencyKey: {
                userId: opts.userId,
                idempotencyKey,
              },
            },
            select: { amount: true, kind: true },
          });
          if (
            again &&
            again.kind === ReferralLedgerKind.ADJUST &&
            again.amount === amount
          ) {
            const bal = Math.max(0, await this.sumPosted(tx, opts.userId));
            return { available: bal, amount, replayed: true };
          }
          throw new BadRequestException(
            'Конфликт Idempotency-Key при записи ADJUST',
          );
        }
        throw e;
      }
      if (amount > 0) {
        await this.repayDebtFromAvailable(tx, opts.userId, idempotencyKey);
      }
      const availableAfter = Math.max(0, await this.sumPosted(tx, opts.userId));
      return { available: availableAfter, amount, replayed: false };
    });
  }

  /**
   * Админ: снять addressMatchSuspect и довести PENDING → POSTED (touch).
   */
  async approveAddressMatch(orderId: string): Promise<{ ok: true }> {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const tx = this.prisma as unknown as TxClient;
      const attr = await tx.orderReferralAttribution.findUnique({
        where: { orderId },
        select: { id: true, addressMatchSuspect: true },
      });
      if (!attr) throw new NotFoundException('Атрибуция не найдена');
      if (attr.addressMatchSuspect) {
        await tx.orderReferralAttribution.update({
          where: { id: attr.id },
          data: {
            addressMatchSuspect: false,
            addressMatchReason: null,
          },
        });
      }
      await this.enqueueTouchInTx(tx, orderId, { reviveDead: true });
    });
    await this.runScheduledTouch(orderId);
    return { ok: true };
  }

  /**
   * Очередь address-match hold: PENDING earn/invitee не POSTED до approve/reject.
   */
  async listAddressMatchSuspects(opts?: { limit?: number }): Promise<{
    count: number;
    items: Array<{
      orderId: string;
      orderNumber: string | null;
      orderStatus: OrderStatus;
      code: string;
      referrerUserId: string;
      referrerEmail: string | null;
      addressMatchReason: string | null;
      pendingEarn: number;
      pendingInviteeBonus: number;
      createdAt: string;
    }>;
  }> {
    const take = Math.min(50, Math.max(1, Math.floor(opts?.limit ?? 20)));
    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const where = { addressMatchSuspect: true } as const;
      const [count, rows] = await Promise.all([
        this.prisma.orderReferralAttribution.count({ where }),
        this.prisma.orderReferralAttribution.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            orderId: true,
            code: true,
            referrerUserId: true,
            addressMatchReason: true,
            createdAt: true,
            order: { select: { number: true, status: true } },
            referrer: { select: { email: true } },
          },
        }),
      ]);
      const orderIds = rows.map((r) => r.orderId);
      const pendingByOrder = new Map<
        string,
        { earn: number; invitee: number }
      >();
      if (orderIds.length > 0) {
        const pending = await this.prisma.referralWalletLedger.findMany({
          where: {
            orderId: { in: orderIds },
            status: ReferralLedgerStatus.PENDING,
            kind: {
              in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
            },
          },
          select: { orderId: true, kind: true, amount: true },
        });
        for (const p of pending) {
          if (!p.orderId) continue;
          const cur = pendingByOrder.get(p.orderId) ?? {
            earn: 0,
            invitee: 0,
          };
          if (p.kind === ReferralLedgerKind.INVITEE_BONUS) {
            cur.invitee += p.amount;
          } else {
            cur.earn += p.amount;
          }
          pendingByOrder.set(p.orderId, cur);
        }
      }
      return {
        count,
        items: rows.map((r) => {
          const pend = pendingByOrder.get(r.orderId) ?? {
            earn: 0,
            invitee: 0,
          };
          return {
            orderId: r.orderId,
            orderNumber: r.order?.number ?? null,
            orderStatus: r.order?.status ?? OrderStatus.NEW,
            code: r.code,
            referrerUserId: r.referrerUserId,
            referrerEmail: r.referrer?.email ?? null,
            addressMatchReason: r.addressMatchReason,
            pendingEarn: pend.earn,
            pendingInviteeBonus: pend.invitee,
            createdAt: r.createdAt.toISOString(),
          };
        }),
      };
    });
  }

  /**
   * Админ: отклонить self-ref — VOID PENDING earn + invitee, снять hold.
   * Idempotency-key остаётся (VOIDED) — повторный touch не пересоздаст начисление.
   */
  async rejectAddressMatch(orderId: string): Promise<{ ok: true }> {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const tx = this.prisma as unknown as TxClient;
      const attr = await tx.orderReferralAttribution.findUnique({
        where: { orderId },
        select: { id: true, addressMatchSuspect: true },
      });
      if (!attr) throw new NotFoundException('Атрибуция не найдена');
      if (!attr.addressMatchSuspect) {
        throw new BadRequestException('Заказ не в очереди подозрений');
      }

      await tx.referralWalletLedger.updateMany({
        where: {
          orderId,
          status: ReferralLedgerStatus.PENDING,
          kind: {
            in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
          },
        },
        data: {
          status: ReferralLedgerStatus.VOIDED,
          availableAt: null,
        },
      });

      await tx.orderReferralAttribution.update({
        where: { id: attr.id },
        data: {
          addressMatchSuspect: false,
          addressMatchReason: 'rejected',
        },
      });
    });
    return { ok: true };
  }

  /** Сводка MF referral по заказу (отдельно от YouRich). */
  async getOrderReferralSummary(orderId: string): Promise<{
    attribution: {
      code: string;
      referrerUserId: string;
      referrerEmail: string | null;
      referrerCode: string | null;
      createdAt: string;
      addressMatchSuspect: boolean;
      addressMatchReason: string | null;
    } | null;
    walletSpent: number;
    /** Referrer EARN POSTED (без INVITEE_BONUS). */
    earned: number;
    /** Referrer EARN PENDING. */
    pending: number;
    /** INVITEE_BONUS POSTED. */
    inviteeBonus: number;
    /** INVITEE_BONUS PENDING. */
    inviteeBonusPending: number;
    /** |CLAWBACK| по EARN (note clawback earn). */
    clawback: number;
    /** |CLAWBACK| по INVITEE_BONUS (note clawback invitee). */
    inviteeBonusClawback: number;
    spentHold: number;
    entries: Array<{
      id: string;
      kind: ReferralLedgerKind;
      status: ReferralLedgerStatus;
      amount: number;
      userId: string;
      userEmail: string | null;
      userDisplayName: string | null;
      /** referrer_earn | buyer_spend | invitee_bonus | other */
      walletRole: string;
      createdAt: string;
    }>;
  }> {
    const [order, attribution, entries] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id: orderId },
        select: { referralWalletAmount: true },
      }),
      this.prisma.orderReferralAttribution.findUnique({
        where: { orderId },
        select: {
          code: true,
          referrerUserId: true,
          createdAt: true,
          addressMatchSuspect: true,
          addressMatchReason: true,
          referrer: {
            select: { email: true, referralCode: true },
          },
        },
      }),
      this.prisma.referralWalletLedger.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          status: true,
          amount: true,
          userId: true,
          note: true,
          source: true,
          createdAt: true,
          user: { select: { email: true, displayName: true } },
        },
      }),
    ]);

    let earned = 0;
    let pending = 0;
    let inviteeBonus = 0;
    let inviteeBonusPending = 0;
    let clawback = 0;
    let inviteeBonusClawback = 0;
    let spentHold = 0;
    for (const e of entries) {
      if (e.kind === ReferralLedgerKind.EARN) {
        if (e.status === ReferralLedgerStatus.POSTED) earned += e.amount;
        if (e.status === ReferralLedgerStatus.PENDING) pending += e.amount;
      } else if (e.kind === ReferralLedgerKind.INVITEE_BONUS) {
        if (e.status === ReferralLedgerStatus.POSTED) inviteeBonus += e.amount;
        if (e.status === ReferralLedgerStatus.PENDING) {
          inviteeBonusPending += e.amount;
        }
      } else if (
        e.kind === ReferralLedgerKind.CLAWBACK &&
        e.status === ReferralLedgerStatus.POSTED
      ) {
        const src = resolveLedgerSource(e.source, e.note);
        if (src === 'invitee') {
          inviteeBonusClawback += Math.abs(e.amount);
        } else if (src !== 'debt') {
          // clawback earn + legacy без префикса invitee
          clawback += Math.abs(e.amount);
        }
      } else if (
        e.kind === ReferralLedgerKind.SPEND_HOLD &&
        e.status === ReferralLedgerStatus.POSTED
      ) {
        spentHold += Math.abs(e.amount);
      } else if (
        e.kind === ReferralLedgerKind.SPEND_RELEASE &&
        e.status === ReferralLedgerStatus.POSTED
      ) {
        spentHold = Math.max(0, spentHold - Math.max(0, e.amount));
      }
    }

    return {
      attribution: attribution
        ? {
            code: attribution.code,
            referrerUserId: attribution.referrerUserId,
            referrerEmail: attribution.referrer.email,
            referrerCode: attribution.referrer.referralCode,
            createdAt: attribution.createdAt.toISOString(),
            addressMatchSuspect: attribution.addressMatchSuspect,
            addressMatchReason: attribution.addressMatchReason,
          }
        : null,
      walletSpent: order?.referralWalletAmount ?? 0,
      earned,
      pending,
      inviteeBonus,
      inviteeBonusPending,
      clawback,
      inviteeBonusClawback,
      spentHold,
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        status: e.status,
        amount: e.amount,
        userId: e.userId,
        userEmail: e.user.email,
        userDisplayName: e.user.displayName,
        walletRole: orderLedgerWalletRole(e.kind, e.note, e.source),
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}

/**
 * Роль владельца кошелька в ledger заказа (для админки).
 * CLAWBACK/DEBT: колонка `source`, legacy — note prefix.
 */
export function orderLedgerWalletRole(
  kind: ReferralLedgerKind,
  note?: string | null,
  source?: string | null,
): 'referrer_earn' | 'buyer_spend' | 'invitee_bonus' | 'other' {
  switch (kind) {
    case ReferralLedgerKind.EARN:
      return 'referrer_earn';
    case ReferralLedgerKind.CLAWBACK: {
      const src = resolveLedgerSource(source, note);
      if (src === 'invitee') return 'invitee_bonus';
      if (src === 'debt') return 'other';
      return 'referrer_earn';
    }
    case ReferralLedgerKind.DEBT: {
      const src = resolveLedgerSource(source, note);
      if (src === 'invitee') return 'invitee_bonus';
      return 'referrer_earn';
    }
    case ReferralLedgerKind.SPEND_HOLD:
    case ReferralLedgerKind.SPEND_RELEASE:
      return 'buyer_spend';
    case ReferralLedgerKind.INVITEE_BONUS:
      return 'invitee_bonus';
    default:
      return 'other';
  }
}
