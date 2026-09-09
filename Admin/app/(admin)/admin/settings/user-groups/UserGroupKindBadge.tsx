'use client';

import { AdminPillBadge } from '@/components/AdminPillChip/AdminPillChip';
import {
  USER_GROUP_KIND_LABELS,
  getUserGroupKind,
} from '@/lib/userGroupAdminUi';
import type { AdminUserGroup } from '@/lib/adminUserGroupTypes';
import settingsStyles from '@/app/(admin)/admin/settings/Settings.module.css';

const KIND_CLASS: Record<ReturnType<typeof getUserGroupKind>, string> = {
  guest: settingsStyles.groupKindGuest,
  retail: settingsStyles.groupKindRetail,
  custom: settingsStyles.groupKindCustom,
};

export function UserGroupKindBadge({
  group,
}: {
  group: Pick<AdminUserGroup, 'isDefaultGuest' | 'isDefaultRegistered'>;
}) {
  const kind = getUserGroupKind(group);
  return (
    <AdminPillBadge className={KIND_CLASS[kind]}>{USER_GROUP_KIND_LABELS[kind]}</AdminPillBadge>
  );
}
