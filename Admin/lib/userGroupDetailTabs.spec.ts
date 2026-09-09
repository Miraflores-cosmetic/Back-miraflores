import { describe, expect, it } from 'vitest';
import { parseUserGroupTab, resolveUserGroupTab } from './userGroupDetailTabs';

describe('resolveUserGroupTab', () => {
  it('members на не-assignable группе → general', () => {
    expect(resolveUserGroupTab('members', { assignable: false })).toBe('general');
  });

  it('members на assignable группе сохраняется', () => {
    expect(resolveUserGroupTab('members', { assignable: true })).toBe('members');
  });

  it('parseUserGroupTab без изменений для остальных вкладок', () => {
    expect(parseUserGroupTab('prices')).toBe('prices');
    expect(resolveUserGroupTab('prices', { assignable: false })).toBe('prices');
  });
});
