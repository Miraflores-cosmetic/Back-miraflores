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
