import { describe, expect, it } from 'vitest';
import { parseUserGroupTab, resolveUserGroupTab } from './userGroupDetailTabs';
import { parseUserGroupPricingSection } from './userGroupPricing';

describe('resolveUserGroupTab', () => {
  it('members на не-assignable группе → general', () => {
    expect(resolveUserGroupTab('members', { assignable: false })).toBe('general');
  });

  it('members на assignable группе сохраняется', () => {
    expect(resolveUserGroupTab('members', { assignable: true })).toBe('members');
  });

  it('categories → prices (legacy)', () => {
    expect(parseUserGroupTab('categories')).toBe('prices');
    expect(resolveUserGroupTab('categories', { assignable: false })).toBe('prices');
  });

  it('parseUserGroupTab без изменений для остальных вкладок', () => {
    expect(parseUserGroupTab('prices')).toBe('prices');
    expect(resolveUserGroupTab('prices', { assignable: false })).toBe('prices');
  });
});

describe('parseUserGroupPricingSection', () => {
  it('по умолчанию categories', () => {
    expect(parseUserGroupPricingSection(null)).toBe('categories');
    expect(parseUserGroupPricingSection(undefined)).toBe('categories');
  });

  it('products и categories', () => {
    expect(parseUserGroupPricingSection('products')).toBe('products');
    expect(parseUserGroupPricingSection('categories')).toBe('categories');
  });
});
