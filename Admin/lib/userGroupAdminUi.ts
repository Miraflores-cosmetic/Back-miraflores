import type { AdminUserGroup } from '@/lib/adminUserGroupTypes';

export type UserGroupKind = 'guest' | 'retail' | 'custom';

export const USER_GROUP_KIND_LABELS: Record<UserGroupKind, string> = {
  guest: 'Гости',
  retail: 'Розница',
  custom: 'Кастомная',
};

export function getUserGroupKind(
  group: Pick<AdminUserGroup, 'isDefaultGuest' | 'isDefaultRegistered'>,
): UserGroupKind {
  if (group.isDefaultGuest) return 'guest';
  if (group.isDefaultRegistered) return 'retail';
  return 'custom';
}

/** Текст для колонки «Участники» / сводки на карточке. */
/** Стек расчёта групповой цены на витрине (см. CommerceContextService). */
export const USER_GROUP_PRICE_STACK_HINT =
  'Как считается: цена SKU (если задана) → ближайшее правило категории вверх по дереву → базовая цена варианта; итог округляется по настройке группы.';

export function formatUserGroupMembersLabel(
  group: Pick<AdminUserGroup, 'isDefaultGuest' | 'isDefaultRegistered' | 'assignable' | 'counts'>,
): string {
  if (group.isDefaultGuest) return 'Авто · все гости';
  if (group.isDefaultRegistered) return 'Авто · все зарег. без группы';
  return String(group.counts.users);
}
