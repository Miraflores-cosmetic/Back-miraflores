import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type YourichCrmLeadBody = {
  leadCrmId: string;
  leadSum: number;
  event: 'NEW' | 'DEAL' | 'CANCEL';
  yrRefLinkHash?: string;
  leadPromocode?: string;
  lead_ext_id?: string;
  offerId?: number;
  /** JSON-строка: [{"id":"name","value":"..."}] */
  leadFieldValues?: string;
};

export type YourichCrmLeadResult = {
  ok: boolean;
  httpStatus: number;
  leadId: number | null;
  body: unknown;
  errorMessage: string | null;
};

export type YourichPromoRow = {
  id: number;
  promoCode: string;
  offerId?: number | null;
  active?: boolean | null;
};

@Injectable()
export class YourichClient {
  private readonly logger = new Logger(YourichClient.name);

  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    const v = (this.config.get<string>('YOURICH_ENABLED') ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  apiKey(): string | null {
    const k = this.config.get<string>('YOURICH_API_KEY')?.trim();
    return k || null;
  }

  baseUrl(): string {
    return (
      this.config.get<string>('YOURICH_API_URL')?.trim().replace(/\/$/, '') ||
      'https://api.prmbusiness.ru'
    );
  }

  fallbackOfferId(): number | null {
    const raw = this.config.get<string>('YOURICH_FALLBACK_OFFER_ID')?.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /** YouRich ждёт заголовок `Bearer: <key>`, не Authorization. */
  private headers(): Record<string, string> {
    const key = this.apiKey();
    if (!key) throw new Error('YOURICH_API_KEY не задан');
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Bearer: key,
    };
  }

  async upsertCrmLead(body: YourichCrmLeadBody): Promise<YourichCrmLeadResult> {
    const url = `${this.baseUrl()}/api/v1/lead/crm`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 500) };
      }
      const leadId = extractLeadId(json);
      if (res.ok) {
        return { ok: true, httpStatus: res.status, leadId, body: json, errorMessage: null };
      }
      const errMsg = extractErrorMessage(json) || `HTTP ${res.status}`;
      this.logger.warn(`yourich lead/crm ${res.status}: ${errMsg}`);
      return { ok: false, httpStatus: res.status, leadId, body: json, errorMessage: errMsg };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`yourich lead/crm network: ${msg}`);
      return { ok: false, httpStatus: 0, leadId: null, body: null, errorMessage: msg };
    }
  }

  async listOfferPromos(page = 1, pageSize = 100): Promise<{
    ok: boolean;
    httpStatus: number;
    items: YourichPromoRow[];
    errorMessage: string | null;
  }> {
    const sp = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    const url = `${this.baseUrl()}/api/v1/referral/offer/promo?${sp}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        return {
          ok: false,
          httpStatus: res.status,
          items: [],
          errorMessage: extractErrorMessage(json) || `HTTP ${res.status}`,
        };
      }
      return { ok: true, httpStatus: res.status, items: parsePromoList(json), errorMessage: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, httpStatus: 0, items: [], errorMessage: msg };
    }
  }
}

function extractLeadId(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const result = o.result;
  const candidates = [
    o.id,
    o.leadId,
    result && typeof result === 'object' ? (result as Record<string, unknown>).id : null,
    result && typeof result === 'object' ? (result as Record<string, unknown>).leadId : null,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

function extractErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
  if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.code === 'number') return `code ${e.code}`;
  }
  return null;
}

function parsePromoList(json: unknown): YourichPromoRow[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  const result = o.result;
  const list =
    (result && typeof result === 'object' && Array.isArray((result as { list?: unknown }).list)
      ? (result as { list: unknown[] }).list
      : null) ??
    (Array.isArray(o.list) ? o.list : null) ??
    (Array.isArray(json) ? json : null);
  if (!list) return [];
  const out: YourichPromoRow[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = Number(r.id);
    const promoCode = String(r.promoCode ?? r.code ?? '').trim();
    if (!Number.isInteger(id) || id <= 0 || !promoCode) continue;
    out.push({
      id,
      promoCode,
      offerId: r.offerId != null ? Number(r.offerId) : null,
      active: r.active == null ? true : Boolean(r.active),
    });
  }
  return out;
}
