import { Injectable } from '@nestjs/common';
import {
  ReferralEarnMode,
  ReferralQuarantineMode,
  type ReferralSettings,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateReferralSettingsDto } from './dto/update-referral-settings.dto';

export type ReferralSettingsPublic = {
  enabled: boolean;
  enabledAt: string | null;
  earnPercent: number;
  earnMode: ReferralEarnMode;
  linkTtlDays: number;
  minOrderRub: number;
  quarantineMode: ReferralQuarantineMode;
  quarantineDays: number;
  inviteeBonusEnabled: boolean;
  inviteeBonusRub: number;
  spendCapPercent: number;
  shareText: string;
  updatedAt: string;
};

function serialize(row: ReferralSettings): ReferralSettingsPublic {
  return {
    enabled: row.enabled,
    enabledAt: row.enabledAt?.toISOString() ?? null,
    earnPercent: row.earnPercent,
    earnMode: row.earnMode,
    linkTtlDays: row.linkTtlDays,
    minOrderRub: row.minOrderRub,
    quarantineMode: row.quarantineMode,
    quarantineDays: row.quarantineDays,
    inviteeBonusEnabled: row.inviteeBonusEnabled,
    inviteeBonusRub: row.inviteeBonusRub,
    spendCapPercent: row.spendCapPercent,
    shareText: row.shareText,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ReferralSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Upsert singleton — смена %/mode не пересчитывает старые ledger. */
  async ensureDefaults(): Promise<ReferralSettings> {
    return this.prisma.referralSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  async get(): Promise<ReferralSettingsPublic> {
    const row = await this.ensureDefaults();
    return serialize(row);
  }

  async update(dto: UpdateReferralSettingsDto): Promise<ReferralSettingsPublic> {
    const prev = await this.ensureDefaults();
    const data: Record<string, unknown> = {};
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
      // Включение (false→true или впервые): новый enabledAt — старые PAID/attribution не earn.
      if (dto.enabled === true && !prev.enabled) {
        data.enabledAt = new Date();
      }
    }
    if (dto.earnPercent !== undefined) data.earnPercent = dto.earnPercent;
    if (dto.earnMode !== undefined) data.earnMode = dto.earnMode;
    if (dto.linkTtlDays !== undefined) data.linkTtlDays = dto.linkTtlDays;
    if (dto.minOrderRub !== undefined) data.minOrderRub = dto.minOrderRub;
    if (dto.quarantineMode !== undefined) data.quarantineMode = dto.quarantineMode;
    if (dto.quarantineDays !== undefined) data.quarantineDays = dto.quarantineDays;
    if (dto.inviteeBonusEnabled !== undefined) {
      data.inviteeBonusEnabled = dto.inviteeBonusEnabled;
    }
    if (dto.inviteeBonusRub !== undefined) data.inviteeBonusRub = dto.inviteeBonusRub;
    if (dto.spendCapPercent !== undefined) data.spendCapPercent = dto.spendCapPercent;
    if (dto.shareText !== undefined) {
      const t = dto.shareText.trim();
      data.shareText = t || 'Закажи в Miraflores по моей ссылке: {link}';
    }

    const row = await this.prisma.referralSettings.update({
      where: { id: 'default' },
      data,
    });
    return serialize(row);
  }
}
