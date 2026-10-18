import { Injectable, Logger } from '@nestjs/common';
import { PromoCodeType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { YourichClient } from './yourich.client';

/** Партнёрские промо из YouRich → локальные PromoCode (5%, firstOrderOnly, affiliate). */
@Injectable()
export class YourichPromoSyncService {
  private readonly logger = new Logger(YourichPromoSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: YourichClient,
  ) {}

  async syncOnce(): Promise<{ upserted: number; skipped: number }> {
    if (!this.client.enabled() || !this.client.apiKey()) {
      return { upserted: 0, skipped: 0 };
    }
    if (this.running) return { upserted: 0, skipped: 0 };
    this.running = true;
    try {
      const res = await this.client.listOfferPromos(1, 100);
      if (!res.ok) {
        this.logger.warn(`promo sync failed http=${res.httpStatus}: ${res.errorMessage}`);
        return { upserted: 0, skipped: 0 };
      }

      let upserted = 0;
      let skipped = 0;
      await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
        for (const p of res.items) {
          const codeRaw = p.promoCode.trim();
          if (!codeRaw) {
            skipped += 1;
            continue;
          }
          const code = codeRaw.toUpperCase();
          const active = p.active !== false;
          const existingByYr = await this.prisma.promoCode.findUnique({
            where: { yourichPromoId: p.id },
          });
          if (existingByYr) {
            await this.prisma.promoCode.update({
              where: { id: existingByYr.id },
              data: {
                code,
                codeRaw,
                active,
                affiliate: true,
                firstOrderOnly: true,
                type: PromoCodeType.PERCENT,
                value: 5,
              },
            });
            upserted += 1;
            continue;
          }
          const byCode = await this.prisma.promoCode.findUnique({ where: { code } });
          if (byCode) {
            await this.prisma.promoCode.update({
              where: { id: byCode.id },
              data: {
                codeRaw,
                yourichPromoId: p.id,
                affiliate: true,
                firstOrderOnly: true,
                active,
              },
            });
            upserted += 1;
            continue;
          }
          await this.prisma.promoCode.create({
            data: {
              code,
              codeRaw,
              yourichPromoId: p.id,
              type: PromoCodeType.PERCENT,
              value: 5,
              active,
              affiliate: true,
              firstOrderOnly: true,
              oneShot: false,
            },
          });
          upserted += 1;
        }
      });
      if (upserted) this.logger.log(`Yourich promo sync: upserted=${upserted}`);
      return { upserted, skipped };
    } finally {
      this.running = false;
    }
  }
}
