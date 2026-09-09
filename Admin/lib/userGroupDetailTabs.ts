export const USER_GROUP_TAB_IDS = [
  'general',
  'members',
  'prices',
  'visibility',
] as const;

export type UserGroupTabId = (typeof USER_GROUP_TAB_IDS)[number];

export function parseUserGroupTab(raw: string | null | undefined): UserGroupTabId {
  const t = raw?.trim();
  if (t === 'categories') return 'prices';
  if (t && (USER_GROUP_TAB_IDS as readonly string[]).includes(t)) {
    return t as UserGroupTabId;
  }
  return 'general';
}

/** URL tab с учётом assignable: members на системной группе → general. */
export function resolveUserGroupTab(
  raw: string | null | undefined,
  group: { assignable: boolean },
): UserGroupTabId {
  const parsed = parseUserGroupTab(raw);
  if (parsed === 'members' && !group.assignable) return 'general';
  return parsed;
}
