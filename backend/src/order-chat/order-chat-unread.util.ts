import { ChatMessageAuthorRole, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export async function batchUnreadCounts(
  prisma: PrismaService,
  conversationIds: string[],
  readerUserId: string,
  oppositeRole: ChatMessageAuthorRole,
): Promise<Map<string, number>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<string, number>();
  if (!ids.length) return out;

  const rows = await prisma.$queryRaw<Array<{ conversationId: string; count: bigint }>>`
    SELECT m."conversationId", COUNT(*)::bigint AS count
    FROM "ChatMessage" m
    LEFT JOIN "ChatReadState" rs
      ON rs."conversationId" = m."conversationId"
      AND rs."userId" = ${readerUserId}
    WHERE m."conversationId" IN (${Prisma.join(ids)})
      AND m."authorRole" = ${oppositeRole}::"ChatMessageAuthorRole"
      AND m."deletedAt" IS NULL
      AND m."createdAt" > COALESCE(rs."lastReadAt", to_timestamp(0))
    GROUP BY m."conversationId"
  `;
  for (const id of ids) out.set(id, 0);
  for (const row of rows) {
    out.set(row.conversationId, Number(row.count));
  }
  return out;
}

/** Суммарный unread staff по всем беседам (без IN по всем conversationId). */
export async function staffTotalUnreadCount(
  prisma: PrismaService,
  staffUserId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "ChatMessage" m
    INNER JOIN "ChatConversation" c ON c.id = m."conversationId"
    LEFT JOIN "ChatReadState" rs
      ON rs."conversationId" = m."conversationId"
      AND rs."userId" = ${staffUserId}
    WHERE (c."retentionPurgesAt" IS NULL OR c."retentionPurgesAt" > NOW())
      AND m."authorRole" = ${ChatMessageAuthorRole.CUSTOMER}::"ChatMessageAuthorRole"
      AND m."deletedAt" IS NULL
      AND m."createdAt" > COALESCE(rs."lastReadAt", to_timestamp(0))
  `;
  return Number(rows[0]?.count ?? 0n);
}

/** Keyset-курсор инбокса поддержки: (есть unread, время последней активности, id). */
export type SupportThreadCursor = { u: 0 | 1; t: string; id: string };

export function encodeSupportThreadCursor(c: SupportThreadCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeSupportThreadCursor(raw: string | undefined | null): SupportThreadCursor | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Partial<SupportThreadCursor>;
    if ((v.u !== 0 && v.u !== 1) || typeof v.t !== 'string' || typeof v.id !== 'string') return null;
    if (Number.isNaN(Date.parse(v.t))) return null;
    return { u: v.u, t: v.t, id: v.id };
  } catch {
    return null;
  }
}

function ilikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export type SupportThreadRow = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  sortAt: Date;
  unread: bigint;
};

/**
 * Страница инбокса поддержки: сначала диалоги с непрочитанными сообщениями клиента,
 * затем по последней активности. Возвращает до `limit + 1` строк (лишняя — признак следующей страницы).
 */
export async function querySupportThreadsPage(
  prisma: PrismaService,
  opts: {
    staffUserId: string;
    q?: string;
    unreadOnly?: boolean;
    cursor?: SupportThreadCursor | null;
    limit: number;
  },
): Promise<SupportThreadRow[]> {
  const q = opts.q?.trim();
  const pat = q ? ilikePattern(q) : null;
  const qFilter = pat
    ? Prisma.sql`AND (
        u.email ILIKE ${pat}
        OR u."displayName" ILIKE ${pat}
        OR u.phone ILIKE ${pat}
        OR EXISTS (
          SELECT 1 FROM "ChatMessage" mb
          WHERE mb."conversationId" = c.id AND mb."deletedAt" IS NULL AND mb.body ILIKE ${pat}
        )
      )`
    : Prisma.empty;
  const unreadFilter = opts.unreadOnly ? Prisma.sql`AND t.unread > 0` : Prisma.empty;
  const cursorFilter = opts.cursor
    ? Prisma.sql`AND ((CASE WHEN t.unread > 0 THEN 1 ELSE 0 END), t."sortAt", t.id)
        < (${opts.cursor.u}::int, ${opts.cursor.t}::timestamp, ${opts.cursor.id})`
    : Prisma.empty;

  return prisma.$queryRaw<SupportThreadRow[]>`
    SELECT * FROM (
      SELECT
        c.id,
        c."userId",
        u.email,
        u."displayName",
        COALESCE(lm."createdAt", c."createdAt") AS "sortAt",
        (
          SELECT COUNT(*)::bigint FROM "ChatMessage" m
          WHERE m."conversationId" = c.id
            AND m."authorRole" = ${ChatMessageAuthorRole.CUSTOMER}::"ChatMessageAuthorRole"
            AND m."deletedAt" IS NULL
            AND m."createdAt" > COALESCE(rs."lastReadAt", to_timestamp(0))
        ) AS unread
      FROM "ChatConversation" c
      INNER JOIN "User" u ON u.id = c."userId"
      LEFT JOIN "ChatReadState" rs
        ON rs."conversationId" = c.id AND rs."userId" = ${opts.staffUserId}
      LEFT JOIN LATERAL (
        SELECT m2."createdAt" FROM "ChatMessage" m2
        WHERE m2."conversationId" = c.id AND m2."deletedAt" IS NULL
        ORDER BY m2."createdAt" DESC
        LIMIT 1
      ) lm ON TRUE
      WHERE c.kind = 'SUPPORT'::"ChatConversationKind"
        AND (c."retentionPurgesAt" IS NULL OR c."retentionPurgesAt" > NOW())
        ${qFilter}
    ) t
    WHERE TRUE ${unreadFilter} ${cursorFilter}
    ORDER BY (t.unread > 0) DESC, t."sortAt" DESC, t.id DESC
    LIMIT ${opts.limit + 1}
  `;
}

/** Сколько диалогов поддержки содержат непрочитанные staff'ом сообщения клиента. */
export async function countSupportThreadsWithUnread(
  prisma: PrismaService,
  staffUserId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "ChatConversation" c
    LEFT JOIN "ChatReadState" rs
      ON rs."conversationId" = c.id AND rs."userId" = ${staffUserId}
    WHERE c.kind = 'SUPPORT'::"ChatConversationKind"
      AND (c."retentionPurgesAt" IS NULL OR c."retentionPurgesAt" > NOW())
      AND EXISTS (
        SELECT 1 FROM "ChatMessage" m
        WHERE m."conversationId" = c.id
          AND m."authorRole" = ${ChatMessageAuthorRole.CUSTOMER}::"ChatMessageAuthorRole"
          AND m."deletedAt" IS NULL
          AND m."createdAt" > COALESCE(rs."lastReadAt", to_timestamp(0))
      )
  `;
  return Number(rows[0]?.count ?? 0n);
}

export async function batchLastMessagePreviews(
  prisma: PrismaService,
  conversationIds: string[],
): Promise<Map<string, { preview: string | null; at: Date | null }>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<string, { preview: string | null; at: Date | null }>();
  if (!ids.length) return out;

  const rows = await prisma.$queryRaw<
    Array<{ conversationId: string; body: string; createdAt: Date; attCount: bigint }>
  >`
    SELECT DISTINCT ON (m."conversationId")
      m."conversationId",
      m."body",
      m."createdAt",
      (
        SELECT COUNT(*)::bigint FROM "ChatAttachment" a WHERE a."messageId" = m."id"
      ) AS "attCount"
    FROM "ChatMessage" m
    WHERE m."conversationId" IN (${Prisma.join(ids)})
      AND m."deletedAt" IS NULL
    ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
  `;

  for (const id of ids) out.set(id, { preview: null, at: null });
  for (const row of rows) {
    const preview =
      row.body.trim() || (Number(row.attCount) > 0 ? '📎 Вложение' : null);
    out.set(row.conversationId, { preview, at: row.createdAt });
  }
  return out;
}
