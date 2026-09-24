import type { OrderChatVariant } from './constants';
import type { OrderChatApiMessage, OrderChatUiMessage } from './types';
import { computeOrderChatMessageDeletableInUi } from './orderChatDeletionUi';

export type MapOrderChatUiLabels = {
  you: string;
  manager: string;
  customer: string;
  brand?: string;
};

export type MapOrderChatUiContext = {
  variant: OrderChatVariant;
  viewerUserId: string | null;
  timeLocale: string;
  labels: MapOrderChatUiLabels;
  resolveFileUrl: (fileUrl: string) => string | undefined;
  resolveOptionalUrl: (url: string | null | undefined) => string | undefined;
  staffAvatarPlaceholder: string;
  /** Аватар зрителя (staff в админке / customer в ЛК) для «Вы». */
  viewerAvatarUrl?: string | null;
};

export function mapOrderChatApiMessageToUi(
  m: OrderChatApiMessage,
  ctx: MapOrderChatUiContext,
): OrderChatUiMessage {
  const deleted = !!m.deletedAt;
  const isStaff = m.authorRole === 'STAFF';
  const authorId = m.authorUserId;
  const isMine =
    ctx.viewerUserId != null && authorId != null && ctx.viewerUserId === authorId;

  let senderName = m.authorLabel?.trim() || '';
  if (ctx.variant === 'admin') {
    if (isStaff && isMine) senderName = ctx.labels.you;
    else if (!isStaff) senderName = senderName || ctx.labels.customer;
  } else {
    if (!isStaff && isMine) senderName = ctx.labels.you;
    else if (isStaff) senderName = senderName || ctx.labels.manager;
    else senderName = senderName || ctx.labels.brand || ctx.labels.customer;
  }

  const timeLabel = new Date(m.createdAt).toLocaleTimeString(ctx.timeLocale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const docs = !deleted
    ? m.attachments
        .filter((a) => a.kind === 'FILE')
        .map((a) => ({
          id: a.id,
          filename: a.filename,
          url: ctx.resolveFileUrl(a.fileUrl),
        }))
    : undefined;
  const imgs = !deleted
    ? m.attachments
        .filter((a) => a.kind === 'IMAGE')
        .map((a) => ({
          id: a.id,
          src: ctx.resolveFileUrl(a.fileUrl) ?? a.fileUrl,
          alt: '',
        }))
    : undefined;

  const deletable = computeOrderChatMessageDeletableInUi({
    variant: ctx.variant,
    viewerUserId: ctx.viewerUserId,
    deleted,
    authorUserId: authorId,
    authorRole: m.authorRole,
    createdAtIso: m.createdAt,
  });

  const avatarRaw = ctx.resolveOptionalUrl(m.authorAvatarUrl);
  let senderAvatarUrl: string | undefined;
  if (ctx.variant === 'admin') {
    if (isStaff) {
      senderAvatarUrl =
        avatarRaw && avatarRaw.length > 0 ? avatarRaw : ctx.staffAvatarPlaceholder;
      if (isMine) {
        const mine = ctx.viewerAvatarUrl?.trim() || avatarRaw;
        senderAvatarUrl = mine && mine.length > 0 ? mine : ctx.staffAvatarPlaceholder;
      }
    } else if (avatarRaw && avatarRaw.length > 0) {
      senderAvatarUrl = avatarRaw;
    }
  } else {
    if (isStaff) {
      senderAvatarUrl =
        avatarRaw && avatarRaw.length > 0 ? avatarRaw : ctx.staffAvatarPlaceholder;
    } else if (!isStaff && isMine) {
      const mine = ctx.viewerAvatarUrl?.trim();
      senderAvatarUrl =
        mine && mine.length > 0 ? mine : avatarRaw && avatarRaw.length > 0 ? avatarRaw : undefined;
    } else if (avatarRaw && avatarRaw.length > 0) {
      senderAvatarUrl = avatarRaw;
    }
  }

  return {
    id: m.id,
    senderName,
    senderAvatarUrl,
    timeLabel,
    content: deleted ? undefined : m.body.trim() || undefined,
    isDeleted: deleted,
    documents: docs?.length ? docs : undefined,
    images: imgs?.length ? imgs : undefined,
    deletable,
    ocAuthorUserId: authorId ?? undefined,
    ocAuthorRole: m.authorRole,
    ocCreatedAtIso: m.createdAt,
  };
}
