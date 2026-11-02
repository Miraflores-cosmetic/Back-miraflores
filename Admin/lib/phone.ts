/**
 * Нормализация и маска телефона (RU + E.164).
 * UX: +7 (999) 123-45-67; 8… и 9XX → +7.
 */

export function ruPhoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Нормализация цифр: 8 → 7; мобильный 9XX без кода страны → 7…
 * Не режем 998 (UZ), 375 (BY), 996 (KG).
 */
export function normalizeRuPhoneDigits(digits: string): string {
  if (!digits) return '';
  if (digits.startsWith('998')) return digits.slice(0, 12);
  if (digits.startsWith('375')) return digits.slice(0, 12);
  if (digits.startsWith('996')) return digits.slice(0, 12);

  let d = digits;
  if (d[0] === '8') {
    d = `7${d.slice(1)}`;
  }
  if (d.length > 0 && !d.startsWith('7') && d[0] === '9') {
    d = `7${d}`;
  }
  if (d.startsWith('7')) {
    return d.slice(0, 11);
  }
  return d.slice(0, 15);
}

/** Совместимость со старым API. */
export function normalizePhoneDigits(raw: string): string {
  return normalizeRuPhoneDigits(ruPhoneDigits(raw));
}

/** Маска +7 (XXX) XXX-XX-XX; также BY/KG/UZ. */
export function formatRuPhoneDisplay(digitsAfterNormalize: string): string {
  const d = digitsAfterNormalize;
  if (!d) return '';
  if (d.startsWith('998')) {
    const u = d.slice(0, 12);
    if (u.length <= 3) return '+998';
    if (u.length <= 5) return `+998(${u.slice(3)})`;
    if (u.length <= 8) return `+998(${u.slice(3, 5)}) ${u.slice(5)}`;
    if (u.length <= 10) {
      return `+998(${u.slice(3, 5)}) ${u.slice(5, 8)}-${u.slice(8)}`;
    }
    return `+998(${u.slice(3, 5)}) ${u.slice(5, 8)}-${u.slice(8, 10)}-${u.slice(10, 12)}`;
  }
  if (d.startsWith('375')) {
    const u = d.slice(0, 12);
    if (u.length <= 3) return '+375';
    if (u.length <= 5) return `+375 (${u.slice(3)}`;
    if (u.length <= 8) return `+375 (${u.slice(3, 5)}) ${u.slice(5)}`;
    if (u.length <= 10) {
      return `+375 (${u.slice(3, 5)}) ${u.slice(5, 8)}-${u.slice(8)}`;
    }
    return `+375 (${u.slice(3, 5)}) ${u.slice(5, 8)}-${u.slice(8, 10)}-${u.slice(10, 12)}`;
  }
  if (d.startsWith('996')) {
    const u = d.slice(0, 12);
    if (u.length <= 3) return '+996';
    if (u.length <= 6) return `+996 ${u.slice(3)}`;
    if (u.length <= 9) return `+996 ${u.slice(3, 6)} ${u.slice(6)}`;
    return `+996 ${u.slice(3, 6)} ${u.slice(6, 9)}-${u.slice(9, 12)}`;
  }

  if (!d.startsWith('7')) {
    return d.length > 0 ? `+${d}` : '';
  }

  const full = d.slice(0, 11);
  const rest = full.slice(1);
  if (rest.length === 0) return '+7';
  if (rest.length <= 3) {
    return `+7 (${rest}${rest.length === 3 ? ')' : ''}`;
  }
  const area = rest.slice(0, 3);
  const tail = rest.slice(3);
  if (tail.length <= 3) {
    return `+7 (${area}) ${tail}`;
  }
  if (tail.length <= 5) {
    return `+7 (${area}) ${tail.slice(0, 3)}-${tail.slice(3)}`;
  }
  return `+7 (${area}) ${tail.slice(0, 3)}-${tail.slice(3, 5)}-${tail.slice(5, 7)}`;
}

/** Ввод → отображаемая маска. */
export function formatPhoneInputValue(rawInput: string): string {
  return formatRuPhoneDisplay(normalizeRuPhoneDigits(ruPhoneDigits(rawInput)));
}

/** РФ/KZ +7; BY +375; KG +996; UZ +998; иначе 10–15 цифр. */
/** Простая проверка формата email (до class-validator IsEmail на BE). */
export function isValidEmail(raw: string): boolean {
  const e = raw.trim();
  if (!e || e.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function isValidPhone(raw: string): boolean {
  const d = normalizePhoneDigits(raw);
  if (!d) return false;
  if (d.startsWith('998') || d.startsWith('375') || d.startsWith('996')) {
    return d.length === 12;
  }
  if (d.length === 11 && d.startsWith('7')) return true;
  if (d.length === 10) return true;
  return d.length >= 10 && d.length <= 15;
}

/** Для API: +79991234567 */
export function formatPhoneE164(raw: string): string {
  const d = normalizePhoneDigits(raw);
  if (!d) return '';
  if (d.startsWith('7') && d.length === 11) return `+${d}`;
  if (d.length >= 10) return `+${d}`;
  return d;
}
