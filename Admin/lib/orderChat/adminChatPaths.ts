import { adminBackendPath } from '@/lib/adminBackendFetch';

export type AdminOrderChatTarget =
  | { kind: 'order'; orderId: string }
  | { kind: 'support'; userId: string };

function entityKey(target: AdminOrderChatTarget): string {
  return target.kind === 'order' ? target.orderId : target.userId;
}

export function adminChatMessagesPath(target: AdminOrderChatTarget): string {
  if (target.kind === 'order') {
    return adminBackendPath(`orders/admin/${encodeURIComponent(target.orderId)}/chat/messages`);
  }
  return adminBackendPath(
    `orders/admin/chat/users/${encodeURIComponent(target.userId)}/messages`,
  );
}

export function adminChatMessagesListUrl(
  target: AdminOrderChatTarget,
  opts?: { limit?: number; before?: string; after?: string },
): string {
  const base = adminChatMessagesPath(target);
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const before = opts?.before?.trim();
  if (before) params.set('before', before);
  const after = opts?.after?.trim();
  if (after) params.set('after', after);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function adminChatReadPath(target: AdminOrderChatTarget): string {
  if (target.kind === 'order') {
    return adminBackendPath(`orders/admin/${encodeURIComponent(target.orderId)}/chat/read`);
  }
  return adminBackendPath(`orders/admin/chat/users/${encodeURIComponent(target.userId)}/read`);
}

export function adminChatUploadPath(target: AdminOrderChatTarget): string {
  if (target.kind === 'order') {
    return adminBackendPath(`orders/admin/${encodeURIComponent(target.orderId)}/chat/upload`);
  }
  return adminBackendPath(`orders/admin/chat/users/${encodeURIComponent(target.userId)}/upload`);
}

export function adminChatUploadRevokePath(target: AdminOrderChatTarget): string {
  if (target.kind === 'order') {
    return adminBackendPath(
      `orders/admin/${encodeURIComponent(target.orderId)}/chat/upload/revoke`,
    );
  }
  return adminBackendPath(
    `orders/admin/chat/users/${encodeURIComponent(target.userId)}/upload/revoke`,
  );
}

export function adminChatDeletePath(target: AdminOrderChatTarget, messageId: string): string {
  if (target.kind === 'order') {
    return adminBackendPath(
      `orders/admin/${encodeURIComponent(target.orderId)}/chat/messages/${encodeURIComponent(messageId)}`,
    );
  }
  return adminBackendPath(
    `orders/admin/chat/users/${encodeURIComponent(target.userId)}/messages/${encodeURIComponent(messageId)}`,
  );
}

export function adminChatSocketJoinPayload(target: AdminOrderChatTarget): Record<string, string> {
  if (target.kind === 'order') return { orderId: target.orderId };
  return { userId: target.userId };
}

export function adminChatSocketLeavePayload(target: AdminOrderChatTarget): Record<string, string> {
  return adminChatSocketJoinPayload(target);
}

export function adminChatTargetKey(target: AdminOrderChatTarget): string {
  return `${target.kind}:${entityKey(target)}`;
}
