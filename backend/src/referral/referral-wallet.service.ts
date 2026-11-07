import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
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
import { computeCommissionBase } from '../orders/commission-base';
import { PrismaService } from '../prisma/prisma.service';
import { PRIOR_PURCHASE_STATUSES } from '../yourich/yourich-lead';
import { lockReferralWalletUser } from './referral-wallet-lock';
import { ReferralSettingsService } from './referral-settings.service';

const EARN_KEY = (orderId: string) => `earn:${orderId}`;
/** Бонус приглашённому (buyer) за первый qualifying заказ по ?mf=. */
const INVITEE_BONUS_KEY = (orderId: string) => `invitee_bonus:${orderId}`;
/** Seq-based: повтор при том же owed после частичного take (мало баланса) — новый seq. */
const CLAWBACK_SEQ_KEY = (orderId: string, seq: number) =>
  `clawback:${orderId}:${seq}`;
const SPEND_HOLD_KEY = (orderId: string, seq = 1) =>
  seq <= 1 ? `spend_hold:${orderId}` : `spend_hold:${orderId}:${seq}`;
const SPEND_RELEASE_KEY = (orderId: string, seq = 1) =>
  seq <= 1 ? `spend_release:${orderId}` : `spend_release:${orderId}:${seq}`;

export type ReferralLedgerHistoryItem = {
  id: string;
  createdAt: string;
  kind: ReferralLedgerKind;
  status: ReferralLedgerStatus;
  amount: number;
  /** Номер заказа (AA-…); без PII приглашённого. */
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

const Q_MODE_RE = /qMode=(DELIVERED|DAYS_AFTER_PAID)/;
const Q_DAYS_RE = /qDays=(\d+)/;

export function encodeEarnMeta(meta: EarnMeta): string {
  return `base=${meta.base};pct=${meta.pct};qMode=${meta.qMode};qDays=${meta.qDays}`;
}

/**
 * Snapshot из note. Legacy `base=;pct=` без q* → null quarantine fields
 * (resolveQuarantine → live fallback; см. docs/referral-wallet.md).
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

/** Live fallback только для legacy note без q* (не для новых snapshot-строк). */
function resolveQuarantine(
  meta: ReturnType<typeof parseEarnMeta>,
  live: { quarantineMode: ReferralQuarantineMode; quarantineDays: number },
): { qMode: ReferralQuarantineMode; qDays: number } {
  return {
    qMode: meta?.qMode ?? live.quarantineMode,
    qDays: Math.max(1, meta?.qDays ?? live.quarantineDays),
  };
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
  ) {}

  /** Available ₽ (POSTED sum, floored at 0). */
  async availableBalance(userId: string): Promise<number> {
    const agg = await this.prisma.referralWalletLedger.aggregate({
      where: { userId, status: ReferralLedgerStatus.POSTED },
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
   * История ЛК: дата, kind, status, сумма, номер заказа — без ФИО/телефона invitee.
   * Cursor = createdAt ISO + id.
   */
  async listLedgerHistory(
    userId: string,
    opts?: { limit?: number; cursor?: string | null },
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

    const rows = await this.prisma.referralWalletLedger.findMany({
      where: {
        userId,
        kind: { not: ReferralLedgerKind.SPEND_CAPTURE },
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
      items: page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        kind: r.kind,
        status: r.status,
        amount: r.amount,
        orderNumber: r.order?.number ?? null,
      })),
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

  async touchInTx(tx: TxClient, orderId: string): Promise<void> {
    const settings = await this.settings.ensureDefaults();
    if (!settings.enabled) return;

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
        refundedAmount: true,
        giftPurchaseDenominationId: true,
        referralAttribution: {
          select: {
            code: true,
            referrerUserId: true,
            createdAt: true,
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
      // Earn-skip (enabledAt / minOrder / % / FIRST_GOODS) ≠ skip invitee bonus —
      // maybeCreditInviteeBonus ниже со своими гейтами. Не return до него.
      let createEarn = true;
      if (
        !settings.enabledAt ||
        order.referralAttribution.createdAt < settings.enabledAt
      ) {
        createEarn = false;
      }
      const targetAmount = this.computeEarnAmount(base, settings.earnPercent);
      if (base < settings.minOrderRub || targetAmount <= 0) {
        createEarn = false;
      }
      if (createEarn && settings.earnMode === ReferralEarnMode.FIRST_GOODS_ORDER) {
        const prior = await this.hasPriorGoodsPurchaseExcluding(tx, order);
        if (prior) createEarn = false;
      }
      if (createEarn) {
        await this.createPendingEarn(tx, {
          referrerUserId,
          orderId: order.id,
          amount: targetAmount,
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
      const meta = parseEarnMeta(existingEarn.note);
      if (!meta) {
        this.logger.warn(
          `referral earn missing snapshot meta order=${order.id} earn=${existingEarn.id}`,
        );
      } else {
        const targetAmount = this.computeEarnAmount(base, meta.pct);
        if (targetAmount <= 0) {
          await tx.referralWalletLedger.update({
            where: { id: existingEarn.id },
            data: { status: ReferralLedgerStatus.VOIDED, amount: 0 },
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
      const q = resolveQuarantine(parseEarnMeta(earn.note), settings);
      const shouldRelease =
        q.qMode === ReferralQuarantineMode.DELIVERED &&
        order.status === OrderStatus.DELIVERED;
      if (shouldRelease) {
        await this.postEarn(tx, earn.id, referrerUserId, earn.amount);
      }
    }

    await this.maybeCreditInviteeBonus(tx, {
      order,
      settings,
      base,
      referrerUserId,
      attributionCreatedAt: order.referralAttribution.createdAt,
    });
  }

  /**
   * Worker: snapshot qMode=DAYS_AFTER_PAID → POSTED через qDays после Order.paidAt.
   * Live quarantineMode/Days не управляют уже созданными earn.
   */
  async processDueQuarantine(limit = 50): Promise<number> {
    const settings = await this.settings.ensureDefaults();
    if (!settings.enabled) return 0;

    const now = Date.now();
    // Широкий prefilter: paidAt ≤ now − 1д; точный qDays — из note.
    const looseCutoff = new Date(now - 24 * 60 * 60_000);

    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const tx = this.prisma as unknown as TxClient;
      const candidates = await tx.referralWalletLedger.findMany({
        where: {
          kind: {
            in: [ReferralLedgerKind.EARN, ReferralLedgerKind.INVITEE_BONUS],
          },
          status: ReferralLedgerStatus.PENDING,
          order: {
            paidAt: { lte: looseCutoff },
          },
        },
        take: Math.max(limit * 4, 50),
        orderBy: { order: { paidAt: 'asc' } },
        select: {
          id: true,
          userId: true,
          amount: true,
          orderId: true,
          note: true,
          order: { select: { status: true, paidAt: true } },
        },
      });

      let n = 0;
      for (const row of candidates) {
        if (n >= limit) break;
        const order = row.order;
        if (
          !order ||
          order.status === OrderStatus.CANCELLED ||
          order.status === OrderStatus.REFUNDED
        ) {
          await tx.referralWalletLedger.update({
            where: { id: row.id },
            data: { status: ReferralLedgerStatus.VOIDED },
          });
          n += 1;
          continue;
        }
        if (!PAID_LIKE.includes(order.status) || !order.paidAt) continue;

        const q = resolveQuarantine(parseEarnMeta(row.note), settings);
        if (q.qMode !== ReferralQuarantineMode.DAYS_AFTER_PAID) continue;

        const readyAt =
          order.paidAt.getTime() + q.qDays * 24 * 60 * 60_000;
        if (readyAt > now) continue;

        await this.postEarn(tx, row.id, row.userId, row.amount);
        n += 1;
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
  }> {
    const settings = await this.settings.ensureDefaults();
    return {
      enabled: settings.enabled,
      spendCapPercent: settings.spendCapPercent,
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

  /** Preview / createOrder: сколько можно списать с учётом settings + balance. */
  async quoteSpend(
    userId: string,
    payableRub: number,
  ): Promise<{
    enabled: boolean;
    available: number;
    spendCapPercent: number;
    amount: number;
  }> {
    const settings = await this.settings.ensureDefaults();
    const available = await this.availableBalance(userId);
    if (!settings.enabled) {
      return {
        enabled: false,
        available,
        spendCapPercent: settings.spendCapPercent,
        amount: 0,
      };
    }
    return {
      enabled: true,
      available,
      spendCapPercent: settings.spendCapPercent,
      amount: this.computeSpendAmount({
        available,
        payableRub,
        spendCapPercent: settings.spendCapPercent,
      }),
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
   * RELEASE net outstanding HOLD−RELEASE (как gift). Идемпотентно при net=0.
   * Seq key: spend_release:orderId, затем :2…
   */
  async releaseSpendInTx(
    tx: TxClient,
    orderId: string,
    opts?: { note?: string },
  ): Promise<boolean> {
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
    if (!entries.length) return false;

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
    const restore = Math.floor(net);
    if (restore < 1 || !userId) return false;

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
      return true;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return false;
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

  private async createPendingEarn(
    tx: TxClient,
    input: {
      referrerUserId: string;
      orderId: string;
      amount: number;
      meta: EarnMeta;
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
    },
  ): Promise<void> {
    const inviteeUserId = opts.order.userId?.trim() || '';
    if (!inviteeUserId) return;
    if (inviteeUserId === opts.referrerUserId) return;
    if (!opts.settings.inviteeBonusEnabled) return;
    const bonusRub = Math.max(0, Math.floor(opts.settings.inviteeBonusRub));
    if (bonusRub < 1) return;
    if (opts.base < opts.settings.minOrderRub) return;

    const existing = await tx.referralWalletLedger.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: inviteeUserId,
          idempotencyKey: INVITEE_BONUS_KEY(opts.order.id),
        },
      },
    });

    if (!existing) {
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

    const q = resolveQuarantine(parseEarnMeta(row.note), opts.settings);
    if (
      q.qMode === ReferralQuarantineMode.DELIVERED &&
      opts.order.status === OrderStatus.DELIVERED
    ) {
      await this.postEarn(tx, row.id, inviteeUserId, row.amount);
    }
  }

  private async createPendingInviteeBonus(
    tx: TxClient,
    input: {
      inviteeUserId: string;
      orderId: string;
      amount: number;
      meta: EarnMeta;
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
        },
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
        data: { status: ReferralLedgerStatus.VOIDED },
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
  ): Promise<void> {
    await lockReferralWalletUser(tx, userId);
    const bal = await this.sumPosted(tx, userId);
    await tx.referralWalletLedger.update({
      where: { id: earnId },
      data: {
        status: ReferralLedgerStatus.POSTED,
        balanceAfter: bal + amount,
      },
    });
  }

  private async sumPosted(tx: TxClient, userId: string): Promise<number> {
    const agg = await tx.referralWalletLedger.aggregate({
      where: { userId, status: ReferralLedgerStatus.POSTED },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
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
        data: { status: ReferralLedgerStatus.VOIDED },
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

    const meta = parseEarnMeta(input.existingEarn.note);
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
        // Не смешивать earn/invitee clawback одного orderId (разные wallet owners обычно,
        // но seq/alreadyClawed должны быть per-source).
        note: { startsWith: notePrefix },
      },
      select: { amount: true },
      orderBy: { createdAt: 'asc' },
    });
    const alreadyClawed = priorClawbacks.reduce(
      (s, r) => s + Math.abs(r.amount),
      0,
    );
    const remaining = Math.max(0, needed - alreadyClawed);
    if (remaining <= 0) return;

    // Re-read under lock — не TOCTOU с параллельным spend/clawback.
    const available = Math.max(0, await this.sumPosted(tx, input.referrerUserId));
    const take = Math.min(remaining, available);
    if (take <= 0) {
      this.logger.warn(
        `referral clawback skipped (no balance) order=${input.orderId} needed=${remaining}`,
      );
      return;
    }

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
          note: `${notePrefix}; target=${target}; original=${original}; owed=${needed}; seq=${seq}`,
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
  }

  // ─── Admin (Phase 5) ─────────────────────────────────────────────

  /**
   * Список рефереров: code, available, pending,
   * earnedGross (EARN) + earnedNet (EARN − |earn CLAWBACK|).
   * inviteeClawback — отдельно (не в Net).
   */
  async listReferrers(opts?: {
    q?: string | null;
    limit?: number;
    cursor?: string | null;
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
      /** max(0, earnedGross − |CLAWBACK note clawback earn|). */
      earnedNet: number;
      /** |CLAWBACK note clawback invitee| — не входит в earnedNet. */
      inviteeClawback: number;
    }>;
    nextCursor: string | null;
  }> {
    const take = Math.min(50, Math.max(1, Math.floor(opts?.limit ?? 20)));
    const q = opts?.q?.trim() || '';
    const cursorId = opts?.cursor?.trim() || null;

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
      take: take + 1,
      select: {
        id: true,
        email: true,
        displayName: true,
        referralCode: true,
        referralCodeActive: true,
      },
    });

    const page = users.slice(0, take);
    const ids = page.map((u) => u.id);
    const [posted, pendingRows, earnedRows, earnClawbackRows, inviteeClawbackRows] =
      await Promise.all([
        this.prisma.referralWalletLedger.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            status: ReferralLedgerStatus.POSTED,
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
            note: { startsWith: 'clawback earn' },
          },
          _sum: { amount: true },
        }),
        this.prisma.referralWalletLedger.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            kind: ReferralLedgerKind.CLAWBACK,
            status: ReferralLedgerStatus.POSTED,
            note: { startsWith: 'clawback invitee' },
          },
          _sum: { amount: true },
        }),
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

    const last = page[page.length - 1];
    return {
      items: page.map((u) => {
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
        };
      }),
      nextCursor: users.length > take && last ? last.id : null,
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
      return { available: Math.max(0, balAfter), amount, replayed: false };
    });
  }

  /** Сводка MF referral по заказу (отдельно от YouRich). */
  async getOrderReferralSummary(orderId: string): Promise<{
    attribution: {
      code: string;
      referrerUserId: string;
      referrerEmail: string | null;
      referrerCode: string | null;
      createdAt: string;
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
          referrer: {
            select: { email: true, referralCode: true },
          },
        },
      }),
      this.prisma.referralWalletLedger.findMany({
        where: { orderId, kind: { not: ReferralLedgerKind.SPEND_CAPTURE } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          status: true,
          amount: true,
          userId: true,
          note: true,
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
        const note = e.note ?? '';
        if (note.startsWith('clawback invitee')) {
          inviteeBonusClawback += Math.abs(e.amount);
        } else {
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
        walletRole: orderLedgerWalletRole(e.kind, e.note),
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}

/**
 * Роль владельца кошелька в ledger заказа (для админки).
 * CLAWBACK: по note (`clawback earn` / `clawback invitee`), не всегда referrer.
 */
export function orderLedgerWalletRole(
  kind: ReferralLedgerKind,
  note?: string | null,
): 'referrer_earn' | 'buyer_spend' | 'invitee_bonus' | 'other' {
  switch (kind) {
    case ReferralLedgerKind.EARN:
      return 'referrer_earn';
    case ReferralLedgerKind.CLAWBACK:
      if ((note ?? '').startsWith('clawback invitee')) {
        return 'invitee_bonus';
      }
      return 'referrer_earn';
    case ReferralLedgerKind.SPEND_HOLD:
    case ReferralLedgerKind.SPEND_RELEASE:
      return 'buyer_spend';
    case ReferralLedgerKind.INVITEE_BONUS:
      return 'invitee_bonus';
    default:
      return 'other';
  }
}
