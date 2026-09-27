import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptOzonSecret,
  encryptOzonSecret,
  signOzonOAuthState,
  verifyOzonOAuthState,
} from './ozon-crypto';

const DEFAULT_AUTHORIZE_URL = 'https://seller.ozon.ru/app/appstore/oauth/authorize';
const DEFAULT_TOKEN_URL = 'https://xapi.ozon.ru/oauth/token';
const DEFAULT_API_URL = 'https://api-seller.ozon.ru';
const DEFAULT_SCOPE = 'seller-api.ozon-logistics';
const SINGLETON_ID = 'default';
const CONNECTED_CACHE_TTL_MS = 30_000;

export const OZON_UNAVAILABLE_MESSAGE =
  'Ozon Доставка временно недоступна. Выберите другую службу доставки.';

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  message?: string;
};

export type OzonAuthMode = 'oauth' | 'api-key' | 'none';

export type OzonIntegrationStatus = {
  mode: OzonAuthMode;
  /** OZON_CLIENT_ID + OZON_CLIENT_SECRET заданы */
  appConfigured: boolean;
  /** Есть сохранённый refresh token (OAuth) или ключ API */
  connected: boolean;
  redirectUri: string | null;
  scope: string;
  connectedAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
};

@Injectable()
export class OzonAuthService {
  private readonly logger = new Logger(OzonAuthService.name);
  private accessToken: string | null = null;
  private accessTokenExpiry = 0;
  private refreshInFlight: Promise<string> | null = null;
  private connectedCache: { at: number; value: boolean } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private env(key: string): string {
    return this.config.get<string>(key)?.trim() || '';
  }

  apiBase(): string {
    return (this.env('OZON_API_URL') || DEFAULT_API_URL).replace(/\/$/, '');
  }

  scope(): string {
    return this.env('OZON_OAUTH_SCOPE') || DEFAULT_SCOPE;
  }

  redirectUri(): string | null {
    const explicit = this.env('OZON_OAUTH_REDIRECT_URI');
    if (explicit) return explicit;
    const site = this.env('FRONTEND_PUBLIC_URL');
    return site ? `${site.replace(/\/$/, '')}/api/v1/delivery/ozon/oauth/callback` : null;
  }

  private appCredentials(): { clientId: string; clientSecret: string } | null {
    const clientId = this.env('OZON_CLIENT_ID');
    const clientSecret = this.env('OZON_CLIENT_SECRET');
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  private apiKeyCredentials(): { sellerId: string; apiKey: string } | null {
    const sellerId = this.env('OZON_SELLER_ID');
    const apiKey = this.env('OZON_API_KEY');
    return sellerId && apiKey ? { sellerId, apiKey } : null;
  }

  private stateSecret(): string {
    const s = this.env('JWT_SECRET');
    if (!s) throw new ServiceUnavailableException('JWT_SECRET не задан');
    return s;
  }

  /** Все операции с таблицей — вне request-tx (эндпоинты Ozon с @SkipRlsTransaction). */
  private withBypass<T>(fn: () => Promise<T>): Promise<T> {
    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, fn);
  }

  private readRow() {
    return this.withBypass(() =>
      this.prisma.ozonIntegration.findUnique({ where: { id: SINGLETON_ID } }),
    );
  }

  private async saveRow(data: {
    refreshTokenEnc?: string | null;
    connectedAt?: Date | null;
    connectedByUserId?: string | null;
    lastRefreshAt?: Date | null;
    lastError?: string | null;
  }): Promise<void> {
    this.connectedCache = null;
    await this.withBypass(() =>
      this.prisma.ozonIntegration.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, ...data },
        update: data,
      }),
    );
  }

  async status(): Promise<OzonIntegrationStatus> {
    const app = this.appCredentials();
    const row = await this.readRow().catch(() => null);
    const hasRefresh = Boolean(row?.refreshTokenEnc);
    const apiKey = this.apiKeyCredentials();
    const mode: OzonAuthMode = app && hasRefresh ? 'oauth' : apiKey ? 'api-key' : 'none';
    return {
      mode,
      appConfigured: Boolean(app),
      connected: mode !== 'none',
      redirectUri: this.redirectUri(),
      scope: this.scope(),
      connectedAt: row?.connectedAt?.toISOString() ?? null,
      lastRefreshAt: row?.lastRefreshAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  /**
   * Витрина/checkout: Ozon можно предлагать покупателю (есть refresh token или API-ключ).
   * Кэш 30 с — вызывается на каждый запрос ПВЗ/квоты.
   */
  async isConnected(): Promise<boolean> {
    const hit = this.connectedCache;
    if (hit && Date.now() - hit.at < CONNECTED_CACHE_TTL_MS) return hit.value;
    const value = (await this.status().catch(() => null))?.connected ?? false;
    this.connectedCache = { at: Date.now(), value };
    return value;
  }

  buildAuthorizeUrl(staffUserId: string): string {
    const app = this.appCredentials();
    if (!app) {
      throw new BadRequestException('Не заданы OZON_CLIENT_ID / OZON_CLIENT_SECRET в backend/.env');
    }
    const redirectUri = this.redirectUri();
    if (!redirectUri) {
      throw new BadRequestException('Не задан OZON_OAUTH_REDIRECT_URI (или FRONTEND_PUBLIC_URL)');
    }
    const url = new URL(this.env('OZON_OAUTH_AUTHORIZE_URL') || DEFAULT_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', this.scope());
    url.searchParams.set('state', signOzonOAuthState(staffUserId, this.stateSecret()));
    url.searchParams.set('prompt', 'select_company');
    return url.toString();
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    const app = this.appCredentials();
    if (!app) throw new BadRequestException('Не заданы OZON_CLIENT_ID / OZON_CLIENT_SECRET');
    const res = await fetch(this.env('OZON_OAUTH_TOKEN_URL') || DEFAULT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        ...body,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !json.access_token) {
      const reason = json.error_description || json.message || json.error || `HTTP ${res.status}`;
      const err = new BadRequestException(`Ozon OAuth: ${reason}`);
      (err as { ozonError?: string }).ozonError = json.error;
      throw err;
    }
    return json;
  }

  private rememberAccess(json: TokenResponse): string {
    this.accessToken = json.access_token!;
    this.accessTokenExpiry = Date.now() + Math.max(60, Number(json.expires_in || 3600)) * 1000;
    return this.accessToken;
  }

  /** OAuth callback: code → токены; refresh token шифруется в БД. */
  async completeAuthorization(code: string, state: string): Promise<void> {
    const staffUserId = verifyOzonOAuthState(state, this.stateSecret());
    if (!staffUserId) {
      throw new BadRequestException('Ссылка авторизации устарела. Запустите подключение заново из админки.');
    }
    const redirectUri = this.redirectUri();
    if (!redirectUri) throw new BadRequestException('Не задан OZON_OAUTH_REDIRECT_URI');
    const json = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    if (!json.refresh_token) {
      throw new BadRequestException('Ozon не вернул refresh_token (нужен access_type=offline)');
    }
    const app = this.appCredentials()!;
    await this.saveRow({
      refreshTokenEnc: encryptOzonSecret(json.refresh_token, app.clientSecret),
      connectedAt: new Date(),
      connectedByUserId: staffUserId,
      lastRefreshAt: new Date(),
      lastError: null,
    });
    this.rememberAccess(json);
    this.logger.log('Ozon OAuth connected');
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiry = 0;
    await this.saveRow({
      refreshTokenEnc: null,
      connectedAt: null,
      connectedByUserId: null,
      lastError: null,
    });
  }

  private async refreshAccessToken(): Promise<string> {
    const app = this.appCredentials();
    if (!app) throw new ServiceUnavailableException('Ozon не настроен');
    const row = await this.readRow();
    const refresh = row?.refreshTokenEnc
      ? decryptOzonSecret(row.refreshTokenEnc, app.clientSecret)
      : null;
    if (!refresh) {
      throw new ServiceUnavailableException('Ozon Доставка не подключена. Подключите в админке.');
    }
    try {
      const json = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refresh,
      });
      await this.saveRow({
        ...(json.refresh_token && json.refresh_token !== refresh
          ? { refreshTokenEnc: encryptOzonSecret(json.refresh_token, app.clientSecret) }
          : {}),
        lastRefreshAt: new Date(),
        lastError: null,
      });
      return this.rememberAccess(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { ozonError?: string }).ozonError;
      await this.saveRow({
        lastError: msg.slice(0, 500),
        ...(code === 'invalid_refresh_token' || code === 'invalid_grant'
          ? { refreshTokenEnc: null }
          : {}),
      }).catch(() => undefined);
      throw new ServiceUnavailableException('Ozon Доставка временно недоступна');
    }
  }

  /** Заголовки для api-seller.ozon.ru: Bearer (OAuth) или Client-Id + Api-Key. */
  async authHeaders(): Promise<Record<string, string>> {
    const app = this.appCredentials();
    if (app) {
      if (this.accessToken && Date.now() < this.accessTokenExpiry - 60_000) {
        return { Authorization: `Bearer ${this.accessToken}` };
      }
      const row = await this.readRow().catch(() => null);
      if (row?.refreshTokenEnc) {
        if (!this.refreshInFlight) {
          this.refreshInFlight = this.refreshAccessToken().finally(() => {
            this.refreshInFlight = null;
          });
        }
        const token = await this.refreshInFlight;
        return { Authorization: `Bearer ${token}` };
      }
    }
    const key = this.apiKeyCredentials();
    if (key) return { 'Client-Id': key.sellerId, 'Api-Key': key.apiKey };
    throw new ServiceUnavailableException('Ozon Доставка не подключена');
  }

  /** Сброс access token после 401 от Seller API. */
  invalidateAccessToken(): void {
    this.accessToken = null;
    this.accessTokenExpiry = 0;
  }
}
