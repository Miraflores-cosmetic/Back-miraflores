import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  ONEC_SESSION_COOKIE,
  assertOnecCredentials,
  parseBasicAuth,
  parseCookieValue,
} from './onec-auth';
import { isOffersFilename, parseOffersXml } from './onec-offers.parser';
import { buildOrdersCommerceMl } from './onec-orders.xml';
import { OnecSessionStore } from './onec-session';
import { OrderStatus } from '@prisma/client';

/** Заказы, которые отдаём 1С (site → 1C). Отмены — только если ONEC_EXPORT_CANCELLED=1. */
const DEFAULT_EXPORT_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

@Injectable()
export class OnecService {
  private readonly logger = new Logger(OnecService.name);
  private readonly exchangeDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sessions: OnecSessionStore,
  ) {
    const root = process.cwd().replace(/\/+$/, '');
    const backendRoot = root.endsWith('/backend') ? root : join(root, 'backend');
    this.exchangeDir =
      this.config.get<string>('ONEC_EXCHANGE_DIR')?.trim() ||
      join(backendRoot, '.data', '1c-exchange');
    mkdirSync(this.exchangeDir, { recursive: true });
  }

  private login() {
    return this.config.get<string>('ONEC_LOGIN');
  }

  private password() {
    return this.config.get<string>('ONEC_PASSWORD');
  }

  /** Импорт offers.xml (цены/остатки 1С → сайт). По умолчанию выкл — только заказы на сайт. */
  catalogImportEnabled(): boolean {
    const raw = this.config.get<string>('ONEC_CATALOG_IMPORT')?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  exportStatuses(): OrderStatus[] {
    const raw = this.config.get<string>('ONEC_EXPORT_CANCELLED')?.trim().toLowerCase();
    const includeCancelled =
      raw === '1' || raw === 'true' || raw === 'yes';
    if (includeCancelled) {
      return [...DEFAULT_EXPORT_STATUSES, OrderStatus.CANCELLED, OrderStatus.REFUNDED];
    }
    return DEFAULT_EXPORT_STATUSES;
  }

  /** checkauth / любая mode: Basic обязателен. */
  requireBasicAuth(authorization: string | undefined): void {
    assertOnecCredentials({
      loginConfigured: this.login(),
      passwordConfigured: this.password(),
      authorization,
    });
  }

  /**
   * После checkauth — cookie-сессия или стабильная сессия по Basic
   * (чтобы file → import работали без cookie).
   */
  requireExchangeAuth(opts: {
    authorization: string | undefined;
    cookie: string | undefined;
  }): string {
    this.requireBasicAuth(opts.authorization);
    const fromCookie = parseCookieValue(opts.cookie, ONEC_SESSION_COOKIE);
    if (fromCookie && this.sessions.get(fromCookie)) {
      return fromCookie;
    }
    const basic = parseBasicAuth(opts.authorization)!;
    return this.sessions.getOrCreateBasicSession(basic.login, basic.password)
      .token;
  }

  checkAuth(authorization: string | undefined): {
    body: string;
    sessionToken: string;
  } {
    try {
      this.requireBasicAuth(authorization);
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        return { body: 'failure\nInvalid login or password', sessionToken: '' };
      }
      throw e;
    }
    const session = this.sessions.create();
    return {
      body: `success\n${ONEC_SESSION_COOKIE}\n${session.token}`,
      sessionToken: session.token,
    };
  }

  init(): string {
    // zip=no — 1С шлёт XML как есть (проще и надёжнее)
    return 'zip=no\nfile_limit=52428800';
  }

  saveFile(sessionToken: string, filename: string, data: Buffer): string {
    const safe = this.safeFilename(filename);
    const dir = join(this.exchangeDir, sessionToken);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, safe), data);
    this.logger.log(`1C file saved: ${safe} (${data.length} bytes)`);
    return 'success';
  }

  async importFile(sessionToken: string, filename: string): Promise<string> {
    if (!this.catalogImportEnabled()) {
      this.logger.log('1C catalog import disabled (ONEC_CATALOG_IMPORT) — skip');
      return 'success';
    }

    const safe = this.safeFilename(filename);
    const path = join(this.exchangeDir, sessionToken, safe);
    if (!existsSync(path)) {
      return `failure\nFile not found: ${safe}`;
    }
    const xml = readFileSync(path, 'utf8');

    if (!isOffersFilename(safe) && !xml.includes('ПакетПредложений')) {
      // import.xml / catalog — карточки ведём в админке, пропускаем
      this.logger.log(`1C import skip (not offers): ${safe}`);
      return 'success';
    }

    const offers = parseOffersXml(xml);
    if (!offers.length) {
      return 'failure\nNo offers found in file';
    }

    let updated = 0;
    let missing = 0;
    for (const offer of offers) {
      if (offer.price == null && offer.quantity == null) {
        missing += 1;
        continue;
      }
      const data: { price?: number; stock?: number } = {};
      if (offer.price != null) data.price = offer.price;
      if (offer.quantity != null) data.stock = offer.quantity;

      const result = await this.prisma.productVariant.updateMany({
        where: { onecId: offer.onecId },
        data,
      });
      if (result.count === 0) {
        missing += 1;
        this.logger.warn(
          `1C offer not matched onecId=${offer.onecId} sku=${offer.sku ?? '-'}`,
        );
      } else {
        updated += result.count;
      }
    }

    this.logger.log(
      `1C offers import: total=${offers.length} updated=${updated} unmatched=${missing}`,
    );
    return 'success';
  }

  async queryOrders(sessionToken: string): Promise<string> {
    const orders = await this.prisma.order.findMany({
      where: {
        onecExportedAt: null,
        status: { in: this.exportStatuses() },
      },
      include: {
        items: { include: { variant: { select: { onecId: true } } } },
        payments: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    this.sessions.setPendingOrders(
      sessionToken,
      orders.map((o) => o.id),
    );

    return buildOrdersCommerceMl(orders);
  }

  async markOrdersExported(sessionToken: string): Promise<string> {
    const ids = this.sessions.takePendingOrders(sessionToken);
    if (ids.length) {
      await this.prisma.order.updateMany({
        where: { id: { in: ids }, onecExportedAt: null },
        data: { onecExportedAt: new Date() },
      });
      this.logger.log(`1C sale success: marked ${ids.length} orders exported`);
    }
    return 'success';
  }

  private safeFilename(filename: string): string {
    const base = filename.replace(/\\/g, '/').split('/').pop() || 'upload.xml';
    const cleaned = base.replace(/[^a-zA-Z0-9._\-\u0400-\u04FF]/g, '_');
    return cleaned || 'upload.xml';
  }
}
