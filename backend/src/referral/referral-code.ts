import { randomInt } from 'crypto';

/** Нормализация кода ссылки (?mf=): upper, A-Z0-9, 3–16 символов. */
const CODE_RE = /^[A-Z0-9]{3,16}$/;

/** Без I/O/0/1 — меньше путаницы при шаринге. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeReferralCode(
  raw: string | null | undefined,
): string | null {
  const c = (raw ?? '').trim().toUpperCase();
  if (!c || !CODE_RE.test(c)) return null;
  return c;
}

/** Генерация короткого кода (crypto RNG, не Math.random). */
export function generateReferralCode(length = 8): string {
  const n = Math.max(3, Math.min(16, length));
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)]!;
  }
  return out;
}
