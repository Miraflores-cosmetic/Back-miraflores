import type { OrderChatVariant } from './constants';
import { isOrderChatMessageWithinDeleteWindow } from './constants';

export function computeOrderChatMessageDeletableInUi(opts: {
  variant: OrderChatVariant;
  viewerUserId: string | null;
  deleted: boolean;
  authorUserId: string | null;
  authorRole: 'CUSTOMER' | 'STAFF';
  createdAtIso: string;
}): boolean {
  const { variant, viewerUserId, deleted, authorUserId, authorRole, createdAtIso } = opts;
  if (deleted) return false;
  const isStaffAuthor = authorRole === 'STAFF';
  const isMineCustomer =
    variant === 'account' && !isStaffAuthor && viewerUserId != null && viewerUserId === authorUserId;
  const mayDeleteByRole = variant === 'admin' || (variant === 'account' && isMineCustomer);
  return mayDeleteByRole && isOrderChatMessageWithinDeleteWindow(createdAtIso);
}
