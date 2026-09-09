import { describe, expect, it } from 'vitest';
import { filterSettingsHubLinks, SETTINGS_HUB_LINKS } from './settingsHub';
import type { StaffContext } from './adminStaffTypes';

describe('filterSettingsHubLinks', () => {
  const superAdmin: StaffContext = {
    isSuperAdmin: true,
    sections: ['dashboard', 'settings'],
    staffDisplayName: null,
    staffAvatarUrl: null,
  };

  const moderatorSettings: StaffContext = {
    isSuperAdmin: false,
    sections: ['settings'],
    staffDisplayName: null,
    staffAvatarUrl: null,
  };

  it('суперадмин видит все hub-ссылки включая staff', () => {
    const links = filterSettingsHubLinks(superAdmin);
    expect(links.map((l) => l.href)).toEqual(SETTINGS_HUB_LINKS.map((l) => l.href));
  });

  it('модератор с settings — deep links, без staff CRUD', () => {
    const links = filterSettingsHubLinks(moderatorSettings);
    expect(links.some((l) => l.href === '/admin/settings/staff')).toBe(false);
    expect(links.some((l) => l.href === '/admin/settings/seo')).toBe(true);
  });

  it('модератор с users — без карточки групп на hub', () => {
    const usersOnly: StaffContext = {
      isSuperAdmin: false,
      sections: ['users'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    const links = filterSettingsHubLinks(usersOnly);
    expect(links.some((l) => l.href === '/admin/settings/user-groups')).toBe(false);
  });

  it('суперадмин — карточка групп на hub', () => {
    const links = filterSettingsHubLinks(superAdmin);
    expect(links.some((l) => l.href === '/admin/settings/user-groups')).toBe(true);
  });
});
