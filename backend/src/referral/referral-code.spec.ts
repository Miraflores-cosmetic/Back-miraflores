import { describe, expect, it } from 'vitest';
import { generateReferralCode, normalizeReferralCode } from './referral-code';

describe('normalizeReferralCode', () => {
  it('upper + trim', () => {
    expect(normalizeReferralCode('  anna1 ')).toBe('ANNA1');
  });

  it('отклоняет мусор', () => {
    expect(normalizeReferralCode('ab')).toBeNull();
    expect(normalizeReferralCode('bad-code')).toBeNull();
    expect(normalizeReferralCode('')).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });
});

describe('generateReferralCode', () => {
  it('длина и charset', () => {
    const c = generateReferralCode(8);
    expect(c).toMatch(/^[A-Z0-9]{8}$/);
    expect(c).not.toMatch(/[IO01]/);
  });
});
