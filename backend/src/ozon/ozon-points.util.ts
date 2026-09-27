export type OzonPointListItem = {
  map_point_id?: number | string;
  coordinate?: { lat?: number; long?: number };
};

export type OzonPickupPoint = {
  id: string;
  name: string;
  /** PickPoint / Postamat / … из delivery_type.name */
  type: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  lat: number;
  lon: number;
  workingHours: string | null;
};

const EARTH_KM = 6371;

export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ближайшие к центру точки в радиусе (id сортированы по расстоянию). */
export function nearestPointIds(
  items: OzonPointListItem[],
  center: { lat: number; lon: number },
  radiusKm: number,
  limit: number,
): string[] {
  const hits: Array<{ id: string; d: number }> = [];
  for (const item of items) {
    const lat = item.coordinate?.lat;
    const lon = item.coordinate?.long;
    const id = item.map_point_id;
    if (typeof lat !== 'number' || typeof lon !== 'number' || id == null) continue;
    // Грубый bbox до haversine — список Ozon на десятки тысяч точек.
    if (Math.abs(lat - center.lat) > radiusKm / 111) continue;
    const d = distanceKm(center, { lat, lon });
    if (d <= radiusKm) hits.push({ id: String(id), d });
  }
  hits.sort((x, y) => x.d - y.d);
  return hits.slice(0, limit).map((h) => h.id);
}

function hhmm(t: unknown): string {
  if (!t || typeof t !== 'object') return '';
  const r = t as { hours?: number; minutes?: number };
  const h = Number(r.hours ?? 0);
  const m = Number(r.minutes ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** working_hours: [{date, periods:[{min:{hours,minutes}, max:{…}}]}] → краткая строка. */
export function formatOzonWorkingHours(raw: unknown): string | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const perDay: string[] = [];
  for (const day of raw) {
    if (!day || typeof day !== 'object') continue;
    const periods = Array.isArray((day as { periods?: unknown[] }).periods)
      ? ((day as { periods: unknown[] }).periods)
      : [];
    const slots = periods
      .map((p) => {
        const pr = (p ?? {}) as { min?: unknown; max?: unknown };
        const from = hhmm(pr.min);
        const to = hhmm(pr.max);
        return from && to ? `${from}–${to}` : '';
      })
      .filter(Boolean);
    if (slots.length) perDay.push(slots.join(', '));
  }
  if (!perDay.length) return null;
  const unique = [...new Set(perDay)];
  if (unique.length === 1) return `Ежедневно ${unique[0]}`;
  return `Сегодня ${perDay[0]}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function postalFrom(...candidates: string[]): string {
  for (const c of candidates) {
    const m = c.match(/(?:^|\D)(\d{6})(?:\D|$)/);
    if (m) return m[1];
  }
  return '';
}

/** Элемент ответа /v1/delivery/point/info → ПВЗ; null если выключен / без координат. */
export function normalizeOzonPointInfo(row: unknown): OzonPickupPoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { enabled?: boolean; delivery_method?: Record<string, unknown> };
  if (r.enabled === false) return null;
  const m = r.delivery_method;
  if (!m || m.map_point_id == null) return null;

  const coords = (m.coordinates ?? {}) as { lat?: number; long?: number };
  const lat = coords.lat;
  const lon = coords.long;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const d = (m.address_details ?? {}) as Record<string, unknown>;
  const city = str(d.city);
  const region = str(d.region);
  const street = str(d.street);
  const house = str(d.house);
  const fullAddress = str(m.address) || [city, street, house].filter(Boolean).join(', ');
  const streetLine = [street, house].filter(Boolean).join(', ');
  const type = str((m.delivery_type as { name?: unknown } | undefined)?.name) || 'PickPoint';

  return {
    id: String(m.map_point_id),
    name: str(m.name) || (type === 'Postamat' ? 'Постамат Ozon' : 'Пункт выдачи Ozon'),
    type,
    address: streetLine || fullAddress,
    city,
    region,
    postalCode: postalFrom(str(d.postal_code), str(d.zip_code), fullAddress),
    lat,
    lon,
    workingHours: formatOzonWorkingHours(m.working_hours),
  };
}
