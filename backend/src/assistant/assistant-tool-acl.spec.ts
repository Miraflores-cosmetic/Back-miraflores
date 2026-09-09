import { describe, expect, it } from 'vitest';
import {
  contentGapScopesForStaff,
  filterAssistantToolNames,
  staffCanUseAssistantTool,
} from './assistant-tool-acl';

describe('assistant-tool-acl', () => {
  it('superadmin проходит любой tool', () => {
    expect(staffCanUseAssistantTool('list_orders', [], true)).toBe(true);
  });

  it('orders tool требует section orders', () => {
    expect(staffCanUseAssistantTool('list_orders', ['assistant', 'dashboard'], false)).toBe(
      false,
    );
    expect(
      staffCanUseAssistantTool('list_orders', ['assistant', 'dashboard', 'orders'], false),
    ).toBe(true);
  });

  it('content_gaps — blog OR settings', () => {
    expect(staffCanUseAssistantTool('content_gaps', ['dashboard'], false)).toBe(false);
    expect(staffCanUseAssistantTool('content_gaps', ['blog'], false)).toBe(true);
    expect(staffCanUseAssistantTool('content_gaps', ['settings'], false)).toBe(true);
  });

  it('contentGapScopesForStaff режет области', () => {
    expect(contentGapScopesForStaff(['blog'], false)).toEqual(['blog']);
    expect(contentGapScopesForStaff(['settings'], false)).toEqual([
      'faq',
      'pages',
      'hero',
    ]);
    expect(contentGapScopesForStaff(['blog', 'settings'], false)).toEqual([
      'faq',
      'pages',
      'hero',
      'blog',
    ]);
    expect(contentGapScopesForStaff([], true)).toEqual([
      'faq',
      'pages',
      'blog',
      'hero',
    ]);
  });

  it('compare_periods требует dashboard', () => {
    expect(staffCanUseAssistantTool('compare_periods', ['catalog'], false)).toBe(
      false,
    );
    expect(
      staffCanUseAssistantTool('compare_periods', ['dashboard'], false),
    ).toBe(true);
  });

  it('user groups tools требуют section users', () => {
    expect(staffCanUseAssistantTool('list_user_groups', ['dashboard'], false)).toBe(
      false,
    );
    expect(staffCanUseAssistantTool('get_user_group', ['users'], false)).toBe(true);
  });

  it('discount / promo tools требуют section discounts', () => {
    expect(staffCanUseAssistantTool('list_discounts', ['catalog'], false)).toBe(false);
    expect(staffCanUseAssistantTool('get_promo_code', ['discounts'], false)).toBe(true);
  });

  it('visibility tool — users OR catalog', () => {
    expect(staffCanUseAssistantTool('list_catalog_visibility', ['dashboard'], false)).toBe(
      false,
    );
    expect(staffCanUseAssistantTool('list_catalog_visibility', ['users'], false)).toBe(
      true,
    );
    expect(staffCanUseAssistantTool('list_catalog_visibility', ['catalog'], false)).toBe(
      true,
    );
  });

  it('filterAssistantToolNames отсекает лишнее', () => {
    const names = [
      'get_dashboard_overview',
      'list_orders',
      'search_products',
      'content_gaps',
    ];
    expect(filterAssistantToolNames(names, ['dashboard', 'assistant'], false)).toEqual([
      'get_dashboard_overview',
    ]);
    expect(
      filterAssistantToolNames(names, ['dashboard', 'catalog', 'orders'], false),
    ).toEqual(['get_dashboard_overview', 'list_orders', 'search_products']);
  });
});
