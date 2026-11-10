import { Injectable } from '@nestjs/common';
import {
  ReferralEarnMode,
  ReferralQuarantineMode,
  type Prisma,
  type ReferralSettings,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateReferralSettingsDto } from './dto/update-referral-settings.dto';

export type ReferralSettingsPublic = {
  enabled: boolean;
  enabledAt: string | null;
  earnPercent: number;
  earnMode: ReferralEarnMode;
  earnWindowMaxOrders: number;
  earnWindowDays: number;
  linkTtlDays: number;
  minOrderRub: number;
  quarantineMode: ReferralQuarantineMode;
  quarantineDays: number;
  inviteeBonusEnabled: boolean;
  inviteeBonusRub: number;
  spendCapPercent: number;
  monthlyEarnCapRub: number;
  shareText: string;
  updatedAt: string;
};

export type ReferralSettingsRevisionItem = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  snapshot: ReferralSettingsPublic;
};

export type ReferralSettingsActor = {
  userId?: string | null;
  email?: string | null;
};

/** TTL кеша между процессами / на случай missed invalidate. */
const SETTINGS_CACHE_TTL_MS = 60_000;

function serialize(row: ReferralSettings): ReferralSettingsPublic {
  return {
    enabled: row.enabled,
    enabledAt: row.enabledAt?.toISOString() ?? null,
    earnPercent: row.earnPercent,
    earnMode: row.earnMode,
    earnWindowMaxOrders: row.earnWindowMaxOrders,
    earnWindowDays: row.earnWindowDays,
    linkTtlDays: row.linkTtlDays,
    minOrderRub: row.minOrderRub,
    quarantineMode: row.quarantineMode,
    quarantineDays: row.quarantineDays,
    inviteeBonusEnabled: row.inviteeBonusEnabled,
    inviteeBonusRub: row.inviteeBonusRub,
    spendCapPercent: row.spendCapPercent,
    monthlyEarnCapRub: row.monthlyEarnCapRub,
    shareText: row.shareText,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function snapshotsEqual(a: ReferralSettingsPublic, b: ReferralSettingsPublic): boolean {
  return (
    a.enabled === b.enabled &&
    a.enabledAt === b.enabledAt &&
    a.earnPercent === b.earnPercent &&
    a.earnMode === b.earnMode &&
    a.earnWindowMaxOrders === b.earnWindowMaxOrders &&
    a.earnWindowDays === b.earnWindowDays &&
    a.linkTtlDays === b.linkTtlDays &&
    a.minOrderRub === b.minOrderRub &&
    a.quarantineMode === b.quarantineMode &&
    a.quarantineDays === b.quarantineDays &&
    a.inviteeBonusEnabled === b.inviteeBonusEnabled &&
    a.inviteeBonusRub === b.inviteeBonusRub &&
    a.spendCapPercent === b.spendCapPercent &&
    a.monthlyEarnCapRub === b.monthlyEarnCapRub &&
    a.shareText === b.shareText
  );
}

@Injectable()
export class ReferralSettingsService {
  private cached: { row: ReferralSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private readCache(): ReferralSettings | null {
    if (!this.cached) return null;
    if (Date.now() - this.cached.at > SETTINGS_CACHE_TTL_MS) {
      this.cached = null;
      return null;
    }
    return this.cached.row;
  }

  private writeCache(row: ReferralSettings): void {
    this.cached = { row, at: Date.now() };
  }

  /** Сброс после update (и для тестов). */
  invalidateCache(): void {
    this.cached = null;
  }

  /**
   * Singleton settings. Без лишнего upsert: findUnique + create-once;
   * in-memory кеш до TTL / invalidate.
   */
  async ensureDefaults(): Promise<ReferralSettings> {
    const hit = this.readCache();
    if (hit) return hit;

    const existing = await this.prisma.referralSettings.findUnique({
      where: { id: 'default' },
    });
    if (existing) {
      this.writeCache(existing);
      return existing;
    }

    const created = await this.prisma.referralSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    this.writeCache(created);
    return created;
  }

  async get(): Promise<ReferralSettingsPublic> {
    const row = await this.ensureDefaults();
    return serialize(row);
  }

  async update(
    dto: UpdateReferralSettingsDto,
    actor?: ReferralSettingsActor | null,
  ): Promise<ReferralSettingsPublic> {
    const prev = await this.ensureDefaults();
    const prevSnap = serialize(prev);
    const data: Prisma.ReferralSettingsUpdateInput = {};
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
      // Первый stamp enabledAt только если ещё null — re-enable не сбрасывает окно attribution.
      if (dto.enabled === true && !prev.enabledAt) {
        data.enabledAt = new Date();
      }
    }
    if (dto.earnPercent !== undefined) data.earnPercent = dto.earnPercent;
    if (dto.earnMode !== undefined) data.earnMode = dto.earnMode;
    if (dto.earnWindowMaxOrders !== undefined) {
      data.earnWindowMaxOrders = dto.earnWindowMaxOrders;
    }
    if (dto.earnWindowDays !== undefined) data.earnWindowDays = dto.earnWindowDays;
    if (dto.linkTtlDays !== undefined) data.linkTtlDays = dto.linkTtlDays;
    if (dto.minOrderRub !== undefined) data.minOrderRub = dto.minOrderRub;
    if (dto.quarantineMode !== undefined) data.quarantineMode = dto.quarantineMode;
    if (dto.quarantineDays !== undefined) data.quarantineDays = dto.quarantineDays;
    if (dto.inviteeBonusEnabled !== undefined) {
      data.inviteeBonusEnabled = dto.inviteeBonusEnabled;
    }
    if (dto.inviteeBonusRub !== undefined) data.inviteeBonusRub = dto.inviteeBonusRub;
    if (dto.spendCapPercent !== undefined) data.spendCapPercent = dto.spendCapPercent;
    if (dto.monthlyEarnCapRub !== undefined) {
      data.monthlyEarnCapRub = dto.monthlyEarnCapRub;
    }
    if (dto.shareText !== undefined) {
      const t = dto.shareText.trim();
      data.shareText = t || 'Закажи в Miraflores по моей ссылке: {link}';
    }

    if (Object.keys(data).length === 0) {
      return prevSnap;
    }

    return this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      const row = await this.prisma.referralSettings.update({
        where: { id: 'default' },
        data,
      });
      const nextSnap = serialize(row);
      if (!snapshotsEqual(prevSnap, nextSnap)) {
        await this.prisma.referralSettingsRevision.create({
          data: {
            snapshot: prevSnap as unknown as Prisma.InputJsonValue,
            actorUserId: actor?.userId?.trim() || null,
            actorEmail: actor?.email?.trim() || null,
          },
        });
      }
      this.writeCache(row);
      return nextSnap;
    });
  }

  async listRevisions(opts?: {
    limit?: number;
  }): Promise<{ items: ReferralSettingsRevisionItem[] }> {
    const take = Math.min(50, Math.max(1, Math.floor(opts?.limit ?? 20)));
    const rows = await this.prisma.runInRlsTransaction(
      { userId: '', bypass: true },
      () =>
        this.prisma.referralSettingsRevision.findMany({
          orderBy: { createdAt: 'desc' },
          take,
        }),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorUserId: r.actorUserId,
        actorEmail: r.actorEmail,
        snapshot: r.snapshot as ReferralSettingsPublic,
      })),
    };
  }
}
