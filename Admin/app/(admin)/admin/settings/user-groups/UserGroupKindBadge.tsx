'use client';

import {
  USER_GROUP_KIND_LABELS,
  getUserGroupKind,
  type UserGroupKind,
} from '@/lib/userGroupAdminUi';
import type { AdminUserGroup } from '@/lib/adminUserGroupTypes';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

const KIND_BADGE_CLASS: Record<UserGroupKind, string> = {
  guest: catalogStyles.badgeOrderShipped,
  retail: catalogStyles.badgeOn,
  custom: catalogStyles.badgeOrderPacking,
};

export function UserGroupKindBadge({
  group,
}: {
  group: Pick<AdminUserGroup, 'isDefaultGuest' | 'isDefaultRegistered'>;
}) {
  const kind = getUserGroupKind(group);
  return (
    <span className={`${catalogStyles.badge} ${KIND_BADGE_CLASS[kind]}`}>
      {USER_GROUP_KIND_LABELS[kind]}
    </span>
  );
}
