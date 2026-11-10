import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import {
  moscowDateString,
  resolveDashboardPeriod,
  shiftYmd,
} from '../dashboard/dashboard-period.util';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeReferralCode } from './referral-code';
import { ReferralCodeService } from './referral-code.service';

const PAID_LIKE: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

/** Prisma @db.Date: полдень UTC по YMD — без сдвига календарного дня. */
function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`);
}

function pct(num: number, den: number): number | null {
  if (den < 1) return null;
  return Math.round((1000 * num) / den) / 10;
}

@Injectable()
export class ReferralVisitService {
  private readonly logger = new Logger(ReferralVisitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: ReferralCodeService,
  ) {}

  /**
   * Инкремент визита ?mf= за сегодняшний день (Москва).
   * Только resolved live/alias коды — мусорный A-Z0-9 не пишет строки.
   * Невалидный / неизвестный / ошибки — silent ok (beacon).
   */
  async trackVisit(codeRaw: string | null | undefined): Promise<{ ok: true }> {
    const code = normalizeReferralCode(codeRaw);
    if (!code) return { ok: true };

    try {
      await this.prisma.runInRlsTransaction(
        { userId: '', bypass: true },
        async () => {
          const resolved = await this.codes.resolveByCode(code);
          if (!resolved) return;

          const day = dateOnly(moscowDateString());
          await this.prisma.referralMfVisitDaily.upsert({
            where: { day_code: { day, code: resolved.code } },
            create: {
              day,
              code: resolved.code,
              referrerUserId: resolved.userId,
              visits: 1,
            },
            update: {
              visits: { increment: 1 },
              referrerUserId: resolved.userId,
            },
          });
        },
      );
    } catch (e) {
      this.logger.warn(
        `mf visit track failed code=${code}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return { ok: true };
  }

  /**
   * Воронка: клик → sticky/регистрация → заказ с attribution → оплата.
   * period: today|last_7|month|custom (+ from/to YYYY-MM-DD).
   */
  async getFunnel(opts: {
    period?: string;
    from?: string;
    to?: string;
    topLimit?: number;
  }): Promise<{
    period: {
      kind: string;
      fromDate: string;
      toDate: string;
    };
    totals: {
      visits: number;
      sticky: number;
      orders: number;
      paid: number;
    };
    rates: {
      visitToSticky: number | null;
      stickyToOrder: number | null;
      orderToPaid: number | null;
      visitToPaid: number | null;
    };
    topCodes: Array<{
      code: string;
      referrerUserId: string | null;
      referrerEmail: string | null;
      visits: number;
      sticky: number;
      orders: number;
      paid: number;
    }>;
    series: Array<{
      day: string;
      visits: number;
      sticky: number;
      orders: number;
      paid: number;
    }>;
  }> {
    const range = resolveDashboardPeriod({
      period: opts.period ?? 'last_7',
      from: opts.from,
      to: opts.to,
    });
    const topLimit = Math.min(
      50,
      Math.max(1, Math.floor(opts.topLimit ?? 20)),
    );
    const dayFrom = dateOnly(range.fromDate);
    const dayTo = dateOnly(range.toDate);

    return this.prisma.runInRlsTransaction(
      { userId: '', bypass: true },
      async () => {
        const [visitAgg, stickyCount, orderCount, paidCount, topVisitRows] =
          await Promise.all([
            this.prisma.referralMfVisitDaily.aggregate({
              where: { day: { gte: dayFrom, lte: dayTo } },
              _sum: { visits: true },
            }),
            this.prisma.user.count({
              where: {
                referredByUserId: { not: null },
                referredByAt: { gte: range.from, lt: range.to },
              },
            }),
            this.prisma.orderReferralAttribution.count({
              where: { createdAt: { gte: range.from, lt: range.to } },
            }),
            this.prisma.orderReferralAttribution.count({
              where: {
                createdAt: { gte: range.from, lt: range.to },
                order: { status: { in: PAID_LIKE } },
              },
            }),
            this.prisma.referralMfVisitDaily.groupBy({
              by: ['code'],
              where: { day: { gte: dayFrom, lte: dayTo } },
              _sum: { visits: true },
              orderBy: { _sum: { visits: 'desc' } },
              take: topLimit,
            }),
          ]);

        const visits = visitAgg._sum.visits ?? 0;
        const sticky = stickyCount;
        const orders = orderCount;
        const paid = paidCount;

        const topCodes = await this.enrichTopCodes(
          topVisitRows.map((r) => ({
            code: r.code,
            visits: r._sum.visits ?? 0,
          })),
          range.from,
          range.to,
        );

        const series = await this.buildSeries(
          range.fromDate,
          range.toDate,
          range.from,
          range.to,
        );

        return {
          period: {
            kind: range.kind,
            fromDate: range.fromDate,
            toDate: range.toDate,
          },
          totals: { visits, sticky, orders, paid },
          rates: {
            visitToSticky: pct(sticky, visits),
            stickyToOrder: pct(orders, sticky),
            orderToPaid: pct(paid, orders),
            visitToPaid: pct(paid, visits),
          },
          topCodes,
          series,
        };
      },
    );
  }

  private async enrichTopCodes(
    rows: Array<{ code: string; visits: number }>,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      code: string;
      referrerUserId: string | null;
      referrerEmail: string | null;
      visits: number;
      sticky: number;
      orders: number;
      paid: number;
    }>
  > {
    if (!rows.length) return [];

    const codes = rows.map((r) => r.code);
    const [liveUsers, aliases, attrRows] = await Promise.all([
      this.prisma.user.findMany({
        where: { referralCode: { in: codes } },
        select: { id: true, email: true, referralCode: true },
      }),
      this.prisma.referralCodeAlias.findMany({
        where: { code: { in: codes }, expiresAt: { gt: new Date() } },
        select: {
          code: true,
          userId: true,
          user: { select: { email: true } },
        },
      }),
      this.prisma.orderReferralAttribution.findMany({
        where: {
          code: { in: codes },
          createdAt: { gte: from, lt: to },
        },
        select: {
          code: true,
          order: { select: { status: true } },
        },
      }),
    ]);

    const byCode = new Map<
      string,
      { userId: string | null; email: string | null }
    >();
    for (const u of liveUsers) {
      if (u.referralCode) {
        byCode.set(u.referralCode, { userId: u.id, email: u.email });
      }
    }
    for (const a of aliases) {
      if (!byCode.has(a.code)) {
        byCode.set(a.code, {
          userId: a.userId,
          email: a.user.email,
        });
      }
    }

    const userIds = [
      ...new Set(
        [...byCode.values()]
          .map((v) => v.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const stickyByUser = new Map<string, number>();
    if (userIds.length) {
      const stickyGroups = await this.prisma.user.groupBy({
        by: ['referredByUserId'],
        where: {
          referredByUserId: { in: userIds },
          referredByAt: { gte: from, lt: to },
        },
        _count: { _all: true },
      });
      for (const g of stickyGroups) {
        if (g.referredByUserId) {
          stickyByUser.set(g.referredByUserId, g._count._all);
        }
      }
    }

    const ordersByCode = new Map<string, { orders: number; paid: number }>();
    for (const a of attrRows) {
      const cur = ordersByCode.get(a.code) ?? { orders: 0, paid: 0 };
      cur.orders += 1;
      if (PAID_LIKE.includes(a.order.status)) cur.paid += 1;
      ordersByCode.set(a.code, cur);
    }

    return rows.map((r) => {
      const ref = byCode.get(r.code);
      const oid = ref?.userId ?? null;
      const o = ordersByCode.get(r.code) ?? { orders: 0, paid: 0 };
      return {
        code: r.code,
        referrerUserId: oid,
        referrerEmail: ref?.email ?? null,
        visits: r.visits,
        sticky: oid ? stickyByUser.get(oid) ?? 0 : 0,
        orders: o.orders,
        paid: o.paid,
      };
    });
  }

  private async buildSeries(
    fromDate: string,
    toDate: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      day: string;
      visits: number;
      sticky: number;
      orders: number;
      paid: number;
    }>
  > {
    const days: string[] = [];
    let cur = fromDate;
    for (let i = 0; i < 400; i++) {
      days.push(cur);
      if (cur === toDate) break;
      const next = shiftYmd(cur, 1);
      if (!next) break;
      cur = next;
    }

    const dayFrom = dateOnly(fromDate);
    const dayTo = dateOnly(toDate);

    const [visitRows, stickyRows, orderRows] = await Promise.all([
      this.prisma.referralMfVisitDaily.groupBy({
        by: ['day'],
        where: { day: { gte: dayFrom, lte: dayTo } },
        _sum: { visits: true },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; n: bigint }>>(Prisma.sql`
        SELECT (timezone('Europe/Moscow', "referredByAt"))::date AS day,
               COUNT(*)::bigint AS n
        FROM "User"
        WHERE "referredByUserId" IS NOT NULL
          AND "referredByAt" >= ${from}
          AND "referredByAt" < ${to}
        GROUP BY 1
      `),
      this.prisma.$queryRaw<
        Array<{ day: Date; orders: bigint; paid: bigint }>
      >(Prisma.sql`
        SELECT (timezone('Europe/Moscow', a."createdAt"))::date AS day,
               COUNT(*)::bigint AS orders,
               COUNT(*) FILTER (
                 WHERE o.status::text IN ('PAID','PACKING','SHIPPED','DELIVERED')
               )::bigint AS paid
        FROM "OrderReferralAttribution" a
        JOIN "Order" o ON o.id = a."orderId"
        WHERE a."createdAt" >= ${from}
          AND a."createdAt" < ${to}
        GROUP BY 1
      `),
    ]);

    const visitsMap = new Map<string, number>();
    for (const r of visitRows) {
      const ymd =
        r.day instanceof Date
          ? r.day.toISOString().slice(0, 10)
          : String(r.day).slice(0, 10);
      visitsMap.set(ymd, r._sum.visits ?? 0);
    }
    const stickyMap = new Map<string, number>();
    for (const r of stickyRows) {
      const ymd =
        r.day instanceof Date
          ? r.day.toISOString().slice(0, 10)
          : String(r.day).slice(0, 10);
      stickyMap.set(ymd, Number(r.n));
    }
    const orderMap = new Map<string, { orders: number; paid: number }>();
    for (const r of orderRows) {
      const ymd =
        r.day instanceof Date
          ? r.day.toISOString().slice(0, 10)
          : String(r.day).slice(0, 10);
      orderMap.set(ymd, {
        orders: Number(r.orders),
        paid: Number(r.paid),
      });
    }

    return days.map((day) => {
      const o = orderMap.get(day) ?? { orders: 0, paid: 0 };
      return {
        day,
        visits: visitsMap.get(day) ?? 0,
        sticky: stickyMap.get(day) ?? 0,
        orders: o.orders,
        paid: o.paid,
      };
    });
  }
}
