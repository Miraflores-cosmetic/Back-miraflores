import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutCarrier } from './order-shipping.resolve';
import { isPvzShippingComment } from './order-shipping.resolve';

type EstimateLine = { variantId: string; qty: number };

type EstimateAddress = {
  city: string;
  address: string;
  postalCode?: string | null;
  comment?: string | null;
  pvzCode?: string | null;
};

type CdekTariffRow = {
  tariff_code?: number;
  delivery_sum?: number;
  total_sum?: number;
  delivery_mode?: number;
  tariff_name?: string;
};

const CDEK_MODE_WAREHOUSE_DOOR = 3;
const CDEK_MODE_WAREHOUSE_WAREHOUSE = 4;
/** Фулфилмент СДЭК — не для отправлений с MSK12. */
const CDEK_EXCLUDED_TARIFF_CODES = new Set<number>([358]);

function parseVspMeta(comment?: string | null): {
  carrier?: string;
  cid?: string;
  dropoff?: string;
  pvz?: string;
} {
  const s = (comment ?? '').trim();
  const m = s.match(/__VSP:carrier=(\w+)([^_]*)__/i);
  if (!m) return {};
  const tail = m[2] || '';
  const pick = (key: string) => {
    const r = tail.match(new RegExp(`(?:^|\\|)${key}=([^|&]*)`, 'i'));
    let v = r?.[1] || '';
    if (v.endsWith('__')) v = v.slice(0, -2);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* noop */
    }
    return v.trim();
  };
  return {
    carrier: m[1]?.toLowerCase(),
    cid: pick('cid'),
    dropoff: pick('dropoff'),
    pvz: pick('pvz'),
  };
}

function normalizePostalRu(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

function packageDimsForQuantity(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  quantity: number,
): { length: number; width: number; height: number } {
  const q = Math.max(1, Math.floor(quantity) || 1);
  const l = Math.max(1, Math.round(lengthCm));
  const w = Math.max(1, Math.round(widthCm));
  const h = Math.max(1, Math.round(heightCm));
  if (q <= 1) return { length: l, width: w, height: h };
  const scale = Math.cbrt(q);
  return {
    length: Math.max(1, Math.round(l * scale)),
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function tariffMatchesModes(t: CdekTariffRow, modes: number[]): boolean {
  if (typeof t.delivery_mode === 'number' && modes.includes(t.delivery_mode)) {
    return true;
  }
  const name = (t.tariff_name || '').toLowerCase();
  if (!name) return false;
  const wantPvz = modes.includes(CDEK_MODE_WAREHOUSE_WAREHOUSE);
  const wantDoor = modes.includes(CDEK_MODE_WAREHOUSE_DOOR);
  if (wantPvz && /склад\s*[-–—]?\s*склад/.test(name)) return true;
  if (wantDoor && /склад\s*[-–—]?\s*дверь/.test(name)) return true;
  return false;
}

function pickCheapestTariff(
  data: unknown,
  modes: number[],
): number | null {
  if (!data || typeof data !== 'object') return null;
  const list = (data as { tariff_codes?: CdekTariffRow[] }).tariff_codes;
  if (!Array.isArray(list) || list.length === 0) return null;

  const eligible = list.filter(
    (t) =>
      typeof t.tariff_code !== 'number' ||
      !CDEK_EXCLUDED_TARIFF_CODES.has(t.tariff_code),
  );
  if (eligible.length === 0) return null;

  const filtered = eligible.filter((t) => tariffMatchesModes(t, modes));
  const anyTyped = eligible.some(
    (t) =>
      typeof t.delivery_mode === 'number' ||
      /склад\s*[-–—]?\s*(склад|дверь)/i.test(t.tariff_name || ''),
  );
  const pool = filtered.length > 0 ? filtered : anyTyped ? [] : eligible;
  if (pool.length === 0) return null;

  let min = Infinity;
  for (const t of pool) {
    const sum = t?.delivery_sum ?? t?.total_sum;
    if (typeof sum === 'number' && sum >= 0 && sum < min) min = sum;
  }
  return min === Infinity ? null : Math.round(min);
}

@Injectable()
export class ShippingServerEstimateService {
  private readonly logger = new Logger(ShippingServerEstimateService.name);
  private cdekToken: string | null = null;
  private cdekTokenExpiry = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isCdekConfigured(): boolean {
    return Boolean(
      this.config.get<string>('CDEK_ACCOUNT')?.trim() &&
        this.config.get<string>('CDEK_SECURE')?.trim(),
    );
  }

  requireServerReprice(): boolean {
    return this.config.get<string>('SHIPPING_REQUIRE_SERVER_REPRICE') !== 'false';
  }

  /**
   * Серверный пересчёт доставки (СДЭК). Яндекс — пока null (BFF-only).
   * Возвращает null, если перевозчик не поддержан или нет credentials.
   */
  async estimate(opts: {
    method: CheckoutCarrier;
    shippingAddress: EstimateAddress;
    lines: EstimateLine[];
  }): Promise<number | null> {
    if (opts.method === 'CDEK') {
      if (!this.isCdekConfigured()) return null;
      return this.estimateCdek(opts.shippingAddress, opts.lines);
    }
    return null;
  }

  private async getCdekToken(): Promise<string> {
    const account = this.config.get<string>('CDEK_ACCOUNT')?.trim();
    const secure = this.config.get<string>('CDEK_SECURE')?.trim();
    if (!account || !secure) {
      throw new BadRequestException('CDEK credentials are not configured');
    }
    if (this.cdekToken && Date.now() < this.cdekTokenExpiry - 60_000) {
      return this.cdekToken;
    }
    const res = await fetch('https://api.cdek.ru/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: account,
        client_secret: secure,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new BadRequestException(
        json.error_description || json.error || `СДЭК OAuth ${res.status}`,
      );
    }
    this.cdekToken = json.access_token;
    this.cdekTokenExpiry =
      Date.now() + Math.max(60, Number(json.expires_in || 3600)) * 1000;
    return this.cdekToken;
  }

  private async estimateCdek(
    address: EstimateAddress,
    lines: EstimateLine[],
  ): Promise<number | null> {
    const comment = address.comment ?? '';
    const meta = parseVspMeta(comment);
    const usePvz =
      isPvzShippingComment(comment) ||
      (meta.dropoff === 'pvz' && Boolean((meta.pvz || address.pvzCode)?.trim()));
    const postal = normalizePostalRu(address.postalCode);
    const cityCodeRaw = meta.cid || '';
    const cityCode = cityCodeRaw ? Number(cityCodeRaw) : NaN;
    if (!postal && !(Number.isFinite(cityCode) && cityCode > 0)) {
      return null;
    }

    const variantIds = [...new Set(lines.map((l) => l.variantId))];
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, active: true },
      select: {
        id: true,
        weightGrams: true,
        lengthMm: true,
        widthMm: true,
        heightMm: true,
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    const packages: Array<{
      weight: number;
      length: number;
      width: number;
      height: number;
    }> = [];
    for (const line of lines) {
      const row = byId.get(line.variantId);
      const q = Math.max(1, Math.floor(line.qty || 1));
      const weightG = (row?.weightGrams ?? 300) * q;
      const lCm = Math.max(1, Math.round((row?.lengthMm ?? 200) / 10));
      const wCm = Math.max(1, Math.round((row?.widthMm ?? 150) / 10));
      const hCm = Math.max(1, Math.round((row?.heightMm ?? 100) / 10));
      packages.push({
        weight: Math.max(1, Math.round(weightG)),
        ...packageDimsForQuantity(lCm, wCm, hCm, q),
      });
    }
    if (!packages.length) return null;

    const fromCode = Number.parseInt(
      this.config.get<string>('CDEK_FROM_CITY_CODE') ||
        this.config.get<string>('CDEK_SHIP_FROM_CITY_CODE') ||
        '44',
      10,
    );
    const toLocation: Record<string, string | number> = { country_code: 'RU' };
    if (Number.isFinite(cityCode) && cityCode > 0) toLocation.code = cityCode;
    if (postal) toLocation.postal_code = postal;

    const body = {
      type: 1,
      currency: 1,
      lang: 'rus',
      from_location: { code: Number.isFinite(fromCode) ? fromCode : 44 },
      to_location: toLocation,
      packages,
    };

    try {
      const token = await this.getCdekToken();
      const res = await fetch('https://api.cdek.ru/v2/calculator/tarifflist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.warn(`CDEK tarifflist ${res.status}: ${JSON.stringify(json)}`);
        return null;
      }
      const modes = usePvz
        ? [CDEK_MODE_WAREHOUSE_WAREHOUSE]
        : [CDEK_MODE_WAREHOUSE_DOOR];
      return pickCheapestTariff(json, modes);
    } catch (e) {
      this.logger.warn(
        `CDEK server estimate failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
