/** Синхронно с backend sample-variant.util (подсказки в админке, без автозаписи). */

const SAMPLE_NAME_TOKEN =
  /(?:^|[^a-zа-яё0-9])пробник(?:$|[^a-zа-яё0-9])/i;

export function isSampleVariantName(name: string | null | undefined): boolean {
  const raw = (name ?? '').trim();
  if (!raw) return false;
  const n = raw.toLowerCase();
  if (n === 'пробник') return true;
  return SAMPLE_NAME_TOKEN.test(raw);
}
