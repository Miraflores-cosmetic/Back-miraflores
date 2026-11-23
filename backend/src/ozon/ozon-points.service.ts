import {
  BadGatewayException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { OzonAuthService } from './ozon-auth.service';
import {
  nearestPointIds,
  normalizeOzonPointInfo,
  type OzonPickupPoint,
  type OzonPointListItem,
} from './ozon-points.util';

const POINT_LIST_PAGE_SIZE = 2000;
const POINT_LIST_MAX_PAGES = 80;

const POINT_LIST_TTL_MS = 60 * 60 * 1000;
const POINT_INFO_TTL_MS = 6 * 60 * 60 * 1000;
const POINT_INFO_BATCH = 100;
const POINT_INFO_CACHE_MAX = 20_000;

@Injectable()
export class OzonPointsService {
  private readonly logger = new Logger(OzonPointsService.name);
  private pointList: { at: number; items: OzonPointListItem[] } | null = null;
  private pointListInFlight: Promise<OzonPointListItem[]> | null = null;
  private lastListError: { at: number; message: string } | null = null;
  private readonly infoCache = new Map<string, { at: number; point: OzonPickupPoint | null }>();

  constructor(private readonly auth: OzonAuthService) {}

  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    const send = async () => {
      const headers = await this.auth.authHeaders();
      return fetch(`${this.auth.apiBase()}${path}`, {
        method: 'POST',
        headers: {
          ...headers,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    };
    let res = await send();
    if (res.status === 401) {
      this.auth.invalidateAccessToken();
      res = await send();
    }
    const json = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) {
      this.logger.warn(`Ozon ${path} ${res.status}: ${json?.message ?? ''}`);
      throw new BadGatewayException(
        res.status === 403
          ? 'Ozon: нет доступа к API доставки (проверьте scope приложения)'
          : 'Ozon: не удалось получить пункты выдачи',
      );
    }
    return json;
  }

  private appendPointListChunk(
    merged: Map<string, OzonPointListItem>,
    chunk: OzonPointListItem[],
  ): void {
    for (const row of chunk) {
      if (row.map_point_id == null) continue;
      merged.set(String(row.map_point_id), row);
    }
  }

  /** Справочник ПВЗ: Ozon отдаёт страницами (limit/offset + has_next). */
  private async fetchPointListFromApi(): Promise<OzonPointListItem[]> {
    type ListJson = {
      points?: OzonPointListItem[];
      has_next?: boolean;
      last_map_point_id?: number | string;
    };

    const merged = new Map<string, OzonPointListItem>();
    let offset = 0;

    for (let page = 0; page < POINT_LIST_MAX_PAGES; page++) {
      const body: Record<string, unknown> = {
        limit: POINT_LIST_PAGE_SIZE,
        offset,
      };
      const json = await this.post<ListJson>(
        '/v1/delivery/point/list',
        body,
        120_000,
      );
      const chunk = Array.isArray(json.points) ? json.points : [];
      if (!chunk.length) {
        if (page === 0) {
          const legacy = await this.post<ListJson>(
            '/v1/delivery/point/list',
            {},
            120_000,
          );
          const all = Array.isArray(legacy.points) ? legacy.points : [];
          return all;
        }
        break;
      }
      const sizeBefore = merged.size;
      this.appendPointListChunk(merged, chunk);
      if (page > 0 && merged.size === sizeBefore) break;
      if (json.has_next === false || chunk.length < POINT_LIST_PAGE_SIZE) break;
      offset += chunk.length;
    }

    return [...merged.values()];
  }

  private async allPoints(): Promise<OzonPointListItem[]> {
    if (this.pointList && Date.now() - this.pointList.at < POINT_LIST_TTL_MS) {
      return this.pointList.items;
    }
    if (!this.pointListInFlight) {
      this.pointListInFlight = this.fetchPointListFromApi()
        .then((items) => {
          this.pointList = { at: Date.now(), items };
          this.lastListError = null;
          this.logger.log(
            `Ozon point/list cached ${items.length} пунктов`,
          );
          return items;
        })
        .catch((e) => {
          this.lastListError = {
            at: Date.now(),
            message: (e instanceof Error ? e.message : String(e)).slice(0, 300),
          };
          if (this.pointList) return this.pointList.items;
          throw e;
        })
        .finally(() => {
          this.pointListInFlight = null;
        });
    }
    return this.pointListInFlight;
  }

  private async pointInfo(ids: string[]): Promise<Map<string, OzonPickupPoint | null>> {
    const out = new Map<string, OzonPickupPoint | null>();
    const now = Date.now();
    const missing: string[] = [];
    for (const id of ids) {
      const hit = this.infoCache.get(id);
      if (hit && now - hit.at < POINT_INFO_TTL_MS) out.set(id, hit.point);
      else missing.push(id);
    }
    for (let i = 0; i < missing.length; i += POINT_INFO_BATCH) {
      const batch = missing.slice(i, i + POINT_INFO_BATCH);
      const json = await this.post<{ points?: unknown[] }>(
        '/v1/delivery/point/info',
        { map_point_ids: batch.map(Number).filter(Number.isFinite) },
        30_000,
      );
      const got = new Map<string, OzonPickupPoint>();
      for (const row of Array.isArray(json.points) ? json.points : []) {
        const p = normalizeOzonPointInfo(row);
        if (p) got.set(p.id, p);
      }
      for (const id of batch) {
        const p = got.get(id) ?? null;
        out.set(id, p);
        this.infoCache.set(id, { at: now, point: p });
      }
    }
    if (this.infoCache.size > POINT_INFO_CACHE_MAX) {
      const drop = this.infoCache.size - POINT_INFO_CACHE_MAX;
      let n = 0;
      for (const key of this.infoCache.keys()) {
        if (n++ >= drop) break;
        this.infoCache.delete(key);
      }
    }
    return out;
  }

  /** ПВЗ Ozon вокруг центра города, ближайшие первыми. */
  async nearby(opts: {
    lat: number;
    lon: number;
    radiusKm?: number;
    limit?: number;
  }): Promise<OzonPickupPoint[]> {
    const radiusKm = Math.min(60, Math.max(1, opts.radiusKm ?? 40));
    const limit = Math.min(500, Math.max(1, opts.limit ?? 400));
    const items = await this.allPoints();
    const ids = nearestPointIds(items, { lat: opts.lat, lon: opts.lon }, radiusKm, limit);
    if (!ids.length) return [];
    const info = await this.pointInfo(ids);
    return ids.map((id) => info.get(id)).filter((p): p is OzonPickupPoint => Boolean(p));
  }

  /** Проверка подключения из админки: число точек в справочнике. */
  async pointCount(): Promise<number> {
    return (await this.allPoints()).length;
  }

  /**
   * Для мониторинга: справочник (из кэша ≤ 1 ч) + была ли ошибка свежее кэша
   * (тогда отдаётся устаревший список, а Ozon фактически недоступен).
   */
  async pointListHealth(): Promise<{ count: number; fetchedAt: string | null; staleError: string | null }> {
    const count = (await this.allPoints()).length;
    const fetchedAt = this.pointList?.at ?? null;
    const err = this.lastListError;
    return {
      count,
      fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
      staleError: err && (!fetchedAt || err.at > fetchedAt) ? err.message : null,
    };
  }
}
