/**
 * Служебная строка в начале комментария / streetAddress2:
 * перевозчик, dropoff, координаты, id ПВЗ.
 * Пользовательский комментарий — со второй строки (или пусто).
 *
 * Форматы (эквивалентны по полям):
 * - `__JCOS:carrier=cdek|dropoff=pvz|lon=…|lat=…|pvz=…__` (пишем так)
 * - `__VSP:carrier=cdek|…__` (legacy с витрины — только читаем)
 */

export type JcosShippingCarrier = 'cdek' | 'yandex';
export type JcosShippingDropoff = 'pvz' | 'courier';

export type JcosAddressMeta = {
  carrier: JcosShippingCarrier;
  dropoff?: JcosShippingDropoff;
  lon?: number;
  lat?: number;
  /** id пункта (CDEK code или Yandex pickup point id) */
  pvzId?: string;
};

function parseMetaFirstLine(first: string): JcosAddressMeta | null {
  const m = first.match(/^__(?:JCOS|VSP):carrier=(cdek|yandex)(.*)__$/i);
  if (!m) return null;
  const carrier = m[1].toLowerCase() as JcosShippingCarrier;
  const tail = m[2] || '';
  const meta: JcosAddressMeta = { carrier };
  if (!tail) return meta;
  for (const seg of tail.split('|')) {
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const key = seg.slice(0, eq);
    const val = seg.slice(eq + 1);
    if (key === 'lon') {
      const n = Number(val);
      if (Number.isFinite(n)) meta.lon = n;
    } else if (key === 'lat') {
      const n = Number(val);
      if (Number.isFinite(n)) meta.lat = n;
    } else if (key === 'pvz' && val) {
      meta.pvzId = val;
    } else if (key === 'dropoff' && (val === 'pvz' || val === 'courier')) {
      meta.dropoff = val;
    }
  }
  return meta;
}

export function parseJcosAddressMeta(streetAddress2: string): {
  meta: JcosAddressMeta | null;
  comment: string;
} {
  const s = streetAddress2?.trim() ?? '';
  if (!s) return { meta: null, comment: '' };

  const nl = s.indexOf('\n');
  const first = nl === -1 ? s : s.slice(0, nl);
  const rest = nl === -1 ? '' : s.slice(nl + 1).trimEnd();

  const meta = parseMetaFirstLine(first);
  if (!meta) return { meta: null, comment: s };

  return { meta, comment: rest };
}

export function buildJcosAddress2WithMeta(
  meta: JcosAddressMeta,
  userComment: string,
): string {
  let line = `__JCOS:carrier=${meta.carrier}`;
  if (meta.dropoff) {
    line += `|dropoff=${meta.dropoff}`;
  }
  if (
    meta.lon != null &&
    meta.lat != null &&
    Number.isFinite(meta.lon) &&
    Number.isFinite(meta.lat)
  ) {
    line += `|lon=${meta.lon}|lat=${meta.lat}`;
  }
  const pvz = meta.pvzId?.trim();
  if (pvz) {
    line += `|pvz=${pvz}`;
  }
  line += `__`;
  const c = (userComment || '').trim();
  return c ? `${line}\n${c}` : line;
}

/** Для отображения пользователю (профиль, checkout) */
export function displayJcosAddressComment(
  streetAddress2: string | undefined | null,
): string {
  return parseJcosAddressMeta(streetAddress2 || '').comment;
}

export function getJcosShippingCarrier(
  streetAddress2: string | undefined | null,
): JcosShippingCarrier {
  return parseJcosAddressMeta(streetAddress2 || '').meta?.carrier ?? 'cdek';
}

/** Режим доставки для отображения (ПВЗ / курьер) по метаданным. */
export function getJcosDeliveryDisplayMode(
  streetAddress2: string | undefined | null,
): { carrier: JcosShippingCarrier; mode: JcosShippingDropoff } {
  const { meta } = parseJcosAddressMeta(streetAddress2 || '');
  const carrier = meta?.carrier ?? 'cdek';
  if (!meta) return { carrier: 'cdek', mode: 'pvz' };
  if (meta.dropoff === 'courier') return { carrier, mode: 'courier' };
  if (meta.dropoff === 'pvz') return { carrier, mode: 'pvz' };
  if (meta.pvzId?.trim()) return { carrier, mode: 'pvz' };
  if (
    meta.lon != null &&
    meta.lat != null &&
    Number.isFinite(meta.lon) &&
    Number.isFinite(meta.lat)
  ) {
    return { carrier, mode: 'courier' };
  }
  return { carrier, mode: 'pvz' };
}

/**
 * Одна строка: «Яндекс Доставка, ПВЗ: Город, адрес».
 */
export function formatJcosDeliveryAddressSummary(address: {
  streetAddress2?: string | null;
  city?: string | null;
  streetAddress1?: string | null;
}): string {
  const { carrier, mode } = getJcosDeliveryDisplayMode(address.streetAddress2);
  const carrierLabel = carrier === 'yandex' ? 'Яндекс Доставка' : 'СДЭК';
  const modeLabel = mode === 'pvz' ? 'ПВЗ' : 'Курьер';
  const city = (address.city || '').trim();
  const street = (address.streetAddress1 || '').trim();
  const loc = [city, street].filter(Boolean).join(', ');
  return loc
    ? `${carrierLabel}, ${modeLabel}: ${loc}`
    : `${carrierLabel}, ${modeLabel}`;
}
