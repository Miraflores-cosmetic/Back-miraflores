/** Страны СДЭК (отправление с MSK12 / Москвы). ISO-2 как в API CDEK. */

export type CdekCountryCode = 'RU' | 'KZ' | 'BY' | 'KG';

export type CdekCountryDef = {
  code: CdekCountryCode;
  label: string;
  /** Города в начале списка и дефолт при смене страны */
  priorityCities: readonly string[];
  defaultCity: string;
  /** Центр карты, если у города нет координат */
  mapCenter: readonly [number, number];
};

export const CDEK_COUNTRIES: readonly CdekCountryDef[] = [
  {
    code: 'RU',
    label: 'Россия',
    priorityCities: [
      'Москва',
      'Санкт-Петербург',
      'Новосибирск',
      'Екатеринбург',
      'Казань',
    ],
    defaultCity: 'Москва',
    mapCenter: [55.75, 37.62],
  },
  {
    code: 'KZ',
    label: 'Казахстан',
    priorityCities: ['Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актобе'],
    defaultCity: 'Алматы',
    mapCenter: [43.24, 76.95],
  },
  {
    code: 'BY',
    label: 'Беларусь',
    priorityCities: ['Минск', 'Гомель', 'Могилёв', 'Витебск', 'Гродно', 'Брест'],
    defaultCity: 'Минск',
    mapCenter: [53.9, 27.57],
  },
  {
    code: 'KG',
    label: 'Кыргызстан',
    priorityCities: ['Бишкек', 'Ош', 'Джалал-Абад'],
    defaultCity: 'Бишкек',
    mapCenter: [42.87, 74.59],
  },
] as const;

const CODE_SET = new Set<string>(CDEK_COUNTRIES.map((c) => c.code));

export function isCdekCountryCode(raw: string | null | undefined): raw is CdekCountryCode {
  return Boolean(raw && CODE_SET.has(raw.toUpperCase()));
}

export function normalizeCdekCountryCode(
  raw: string | null | undefined,
  fallback: CdekCountryCode = 'RU',
): CdekCountryCode {
  const u = (raw || '').trim().toUpperCase();
  return isCdekCountryCode(u) ? u : fallback;
}

export function cdekCountryDef(code: CdekCountryCode): CdekCountryDef {
  return CDEK_COUNTRIES.find((c) => c.code === code) || CDEK_COUNTRIES[0];
}
