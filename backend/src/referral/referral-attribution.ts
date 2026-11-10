import { normalizeReferralCode } from './referral-code';

export type ReferralAttributionLookup = {
  code: string;
  referrerUserId: string;
  addressMatchSuspect: boolean;
  addressMatchReason: string | null;
};

type UserLookup = {
  id: string;
  email: string;
  referralCode: string | null;
  referralCodeActive: boolean;
  isActive: boolean;
  /** Найден по ReferralCodeAlias (grace после regenerate), не по live code. */
  matchedByCodeAlias?: boolean;
};

export type ShippingFingerprintInput = {
  city?: string | null;
  address?: string | null;
  postalCode?: string | null;
  pvzCode?: string | null;
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

function normPart(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/\s+/g, ' ');
}

function normPvz(s: string | null | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

/** Доставка из Order.shippingAddress JSON. */
export function shippingFingerprintFromJson(
  raw: unknown,
): ShippingFingerprintInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const city = typeof o.city === 'string' ? o.city : null;
  const address = typeof o.address === 'string' ? o.address : null;
  const postalCode = typeof o.postalCode === 'string' ? o.postalCode : null;
  const pvzCode = typeof o.pvzCode === 'string' ? o.pvzCode : null;
  if (!city && !address && !postalCode && !pvzCode) return null;
  return { city, address, postalCode, pvzCode };
}

/**
 * Совпадение доставки/ПВЗ покупателя с адресами/заказами реферера.
 * Не блокирует attribution — флаг; POSTED только после approve в админке.
 */
export function detectShippingOverlap(
  buyer: ShippingFingerprintInput,
  referrerAddresses: ShippingFingerprintInput[],
): { suspect: boolean; reason: string | null } {
  const buyerPvz = normPvz(buyer.pvzCode);
  const buyerCity = normPart(buyer.city);
  const buyerAddr = normPart(buyer.address);
  const buyerPostal = normPart(buyer.postalCode);

  for (const r of referrerAddresses) {
    const rPvz = normPvz(r.pvzCode);
    if (buyerPvz && rPvz && buyerPvz === rPvz) {
      return { suspect: true, reason: `pvz:${buyerPvz}` };
    }
    const rCity = normPart(r.city);
    const rAddr = normPart(r.address);
    if (buyerCity && buyerAddr && rCity && rAddr && buyerCity === rCity && buyerAddr === rAddr) {
      return { suspect: true, reason: `city+address:${buyerCity}` };
    }
    const rPostal = normPart(r.postalCode);
    if (
      buyerPostal &&
      buyerAddr &&
      rPostal &&
      rAddr &&
      buyerPostal === rPostal &&
      buyerAddr === rAddr
    ) {
      return { suspect: true, reason: `postal+address:${buyerPostal}` };
    }
  }
  return { suspect: false, reason: null };
}

/**
 * Резолв ?mf=code → реферер. Self-referral (userId / email / любой phone ≥10) → null.
 * Совпадение адреса/ПВЗ (профиль + прошлые заказы реферера) → addressMatch* флаг;
 * earn остаётся PENDING до approve в админке.
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
  buyerShipping?: ShippingFingerprintInput | null;
  referrerShipments?: ShippingFingerprintInput[];
}): ReferralAttributionLookup | null {
  const code = normalizeReferralCode(opts.codeRaw);
  if (!code) return null;
  const u = opts.referrer;
  if (!u || !u.isActive || !u.referralCodeActive) return null;
  const live = normalizeReferralCode(u.referralCode);
  if (live !== code && !u.matchedByCodeAlias) return null;

  const buyerId = opts.buyerUserId?.trim() || null;
  if (buyerId && buyerId === u.id) return null;

  const email = opts.buyerEmail.trim().toLowerCase();
  if (email && u.email.trim().toLowerCase() === email) return null;

  if (phonesOverlap(opts.buyerPhones, opts.referrerPhones)) return null;

  const overlap = detectShippingOverlap(
    opts.buyerShipping ?? {},
    opts.referrerShipments ?? [],
  );

  return {
    code,
    referrerUserId: u.id,
    addressMatchSuspect: overlap.suspect,
    addressMatchReason: overlap.reason,
  };
}
