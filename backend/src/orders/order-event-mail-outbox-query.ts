import { OrderStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type MailOutboxFlushRow = {
  eventId: string;
  orderId: string;
  meta: unknown;
  number: string;
  email: string;
  status: OrderStatus;
};

/** SQL aligned with OrderEvent_tracking_mail_outbox_flush_idx. */
export async function fetchTrackingMailOutboxFlushRows(
  prisma: PrismaService,
  staleBefore: Date,
  take: number,
  now: Date = new Date(),
): Promise<MailOutboxFlushRow[]> {
  const limit = Math.max(1, Math.min(take, 200));
  const rows = await prisma.runInRlsTransaction(
    { userId: '', bypass: true },
    () =>
      prisma.$queryRaw<
        Array<{
          eventId: string;
          orderId: string;
          meta: unknown;
          number: string;
          email: string;
          status: string;
        }>
      >`
        SELECT
          e.id AS "eventId",
          e."orderId" AS "orderId",
          e.meta AS meta,
          o.number AS number,
          o.email AS email,
          o.status::text AS status
        FROM "OrderEvent" e
        INNER JOIN "Order" o ON o.id = e."orderId"
        WHERE e.type = 'TRACKING_SENT'
          AND e."createdAt" < ${staleBefore}
          AND e.meta->>'mailStatus' IN ('pending', 'failed')
          AND (
            e.meta->>'nextRetryAt' IS NULL
            OR BTRIM(e.meta->>'nextRetryAt') = ''
            OR (e.meta->>'nextRetryAt')::timestamptz <= ${now}
          )
        ORDER BY e."createdAt" ASC
        LIMIT ${limit}
      `,
  );

  return rows.map((r) => ({
    ...r,
    status: r.status as OrderStatus,
  }));
}

/** SQL aligned with OrderEvent_delivered_mail_outbox_flush_idx. */
export async function fetchDeliveredMailOutboxFlushRows(
  prisma: PrismaService,
  staleBefore: Date,
  take: number,
  now: Date = new Date(),
): Promise<MailOutboxFlushRow[]> {
  const limit = Math.max(1, Math.min(take, 200));
  const rows = await prisma.runInRlsTransaction(
    { userId: '', bypass: true },
    () =>
      prisma.$queryRaw<
        Array<{
          eventId: string;
          orderId: string;
          meta: unknown;
          number: string;
          email: string;
          status: string;
        }>
      >`
        SELECT
          e.id AS "eventId",
          e."orderId" AS "orderId",
          e.meta AS meta,
          o.number AS number,
          o.email AS email,
          o.status::text AS status
        FROM "OrderEvent" e
        INNER JOIN "Order" o ON o.id = e."orderId"
        WHERE e.type = 'DELIVERED'
          AND e."createdAt" < ${staleBefore}
          AND e.meta->>'source' IN ('cdek_sync', 'admin_manual')
          AND e.meta->>'mailStatus' IN ('pending', 'failed')
          AND (
            e.meta->>'nextRetryAt' IS NULL
            OR BTRIM(e.meta->>'nextRetryAt') = ''
            OR (e.meta->>'nextRetryAt')::timestamptz <= ${now}
          )
        ORDER BY e."createdAt" ASC
        LIMIT ${limit}
      `,
  );

  return rows.map((r) => ({
    ...r,
    status: r.status as OrderStatus,
  }));
}