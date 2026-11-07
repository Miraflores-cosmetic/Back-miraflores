import { normalizeReferralCode } from './referral-code';

export type ReferralAttributionLookup = {
  code: string;
  referrerUserId: string;
};

type UserLookup = {
  id: string;
  email: string;
  referralCode: string | null;
  referralCodeActive: boolean;
  isActive: boolean;
};

/** Last-10 digits fingerprint; только номера с ≥10 цифрами. */
export function phoneFingerprints(
  phones: Array<string | null | undefined>,
): Set<string> {
  const out = new Set<string>();
  for (const p of phones) {
    const digits = (p ?? '').replace(/\D/g, '');
    if (digits.length >= 10) out.add(digits.slice(-10));
  }
  return out;
}

/** Self-ref: любой phone покупателя совпал с любым phone реферера. */
export function phonesOverlap(
  buyerPhones: Array<string | null | undefined>,
  referrerPhones: Array<string | null | undefined>,
): boolean {
  const a = phoneFingerprints(buyerPhones);
  if (a.size === 0) return false;
  const b = phoneFingerprints(referrerPhones);
  for (const fp of a) {
    if (b.has(fp)) return true;
  }
  return false;
}

/**
 * Резолв ?mf=code → реферер. Self-referral (userId / email / любой phone ≥10) → null.
 * Gift-only / пустой код — снаружи.
 */
export function resolveReferralAttribution(opts: {
  codeRaw: string | null | undefined;
  referrer: UserLookup | null;
  buyerUserId: string | null | undefined;
  buyerEmail: string;
  /** Все известные телефоны покупателя: checkout, shipping, профиль, адреса. */
  buyerPhones: Array<string | null | undefined>;
  /** Телефоны реферера: профиль + адреса. */
  referrerPhones: Array<string | null | undefined>;
}): ReferralAttributionLookup | null {
  const code = normalizeReferralCode(opts.codeRaw);
  if (!code) return null;
  const u = opts.referrer;
  if (!u || !u.isActive || !u.referralCodeActive) return null;
  if (normalizeReferralCode(u.referralCode) !== code) return null;

  const buyerId = opts.buyerUserId?.trim() || null;
  if (buyerId && buyerId === u.id) return null;

  const email = opts.buyerEmail.trim().toLowerCase();
  if (email && u.email.trim().toLowerCase() === email) return null;

  if (phonesOverlap(opts.buyerPhones, opts.referrerPhones)) return null;

  return { code, referrerUserId: u.id };
}
