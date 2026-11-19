import { hostname } from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lease-row leader election: один holder на key, TTL, без session advisory lock через пул.
 */
@Injectable()
export class BackgroundWorkerLeaseService {
  private readonly logger = new Logger(BackgroundWorkerLeaseService.name);
  private readonly holder = `${hostname()}-${process.pid}`;

  constructor(private readonly prisma: PrismaService) {}

  holderId(): string {
    return this.holder;
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const ttl = Math.max(5_000, Math.round(ttlMs));
    const expiresAt = new Date(Date.now() + ttl);

    await this.prisma.backgroundWorkerLease.upsert({
      where: { key },
      create: { key, holder: '', expiresAt: new Date(0) },
      update: {},
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ key: string }>>`
        UPDATE "BackgroundWorkerLease"
        SET
          "holder" = ${this.holder},
          "expiresAt" = ${expiresAt},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "key" = ${key}
          AND ("expiresAt" < CURRENT_TIMESTAMP OR "holder" = ${this.holder})
        RETURNING "key"
      `;
      return rows.length > 0;
    });

    if (updated) {
      this.logger.debug(`Lease acquired ${key} holder=${this.holder}`);
    }
    return updated;
  }

  async renew(key: string, ttlMs: number): Promise<boolean> {
    const expiresAt = new Date(Date.now() + Math.max(5_000, Math.round(ttlMs)));
    const n = await this.prisma.backgroundWorkerLease.updateMany({
      where: { key, holder: this.holder },
      data: { expiresAt },
    });
    return n.count > 0;
  }

  async release(key: string): Promise<void> {
    await this.prisma.backgroundWorkerLease.updateMany({
      where: { key, holder: this.holder },
      data: { expiresAt: new Date(0) },
    });
  }
}