import { describe, expect, it } from 'vitest';
import { formatAdminChatListTime } from './adminFormat';

describe('formatAdminChatListTime', () => {
  const now = new Date(2026, 8, 24, 22, 30);

  it('shows time for today', () => {
    expect(formatAdminChatListTime(new Date(2026, 8, 24, 9, 5).toISOString(), now)).toBe('09:05');
  });

  it('shows «вчера» for the previous calendar day', () => {
    expect(formatAdminChatListTime(new Date(2026, 8, 23, 23, 59).toISOString(), now)).toBe('вчера');
  });

  it('shows day and short month within the current year', () => {
    expect(formatAdminChatListTime(new Date(2026, 2, 3, 12).toISOString(), now)).toMatch(/^3 мар/);
  });

  it('shows full date for previous years', () => {
    expect(formatAdminChatListTime(new Date(2025, 1, 3, 12).toISOString(), now)).toBe('03.02.2025');
  });

  it('returns empty string for invalid input', () => {
    expect(formatAdminChatListTime('nope', now)).toBe('');
  });
});
