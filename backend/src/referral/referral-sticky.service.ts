import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeReferralCode } from './referral-code';
import { ReferralCodeService } from './referral-code.service';
import { ReferralSettingsService } from './referral-settings.service';

/**
 * Sticky attribution: User.referredByUserId переживает очистку localStorage.
 * TTL = ReferralSettings.linkTtlDays от referredByAt.
 */
@Injectable()
export class ReferralStickyService {
  private readonly logger = new Logger(ReferralStickyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ReferralSettingsService,
    private readonly codes: ReferralCodeService,
  ) {}

  /** Код реферера для createOrder, если LS пуст, но sticky в TTL. */
  async resolveCodeForUser(userId: string): Promise<string | null> {
    const id = userId?.trim();
    if (!id) return null;
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        referredByUserId: true,
        referredByAt: true,
        referredBy: {
          select: {
            referralCode: true,
            referralCodeActive: true,
            isActive: true,
          },
        },
      },
    });
    if (!user?.referredByUserId || !user.referredByAt || !user.referredBy) {
      return null;
    }
    const ttlDays = await this.linkTtlDays();
    const ageMs = Date.now() - user.referredByAt.getTime();
    if (ageMs > ttlDays * 24 * 60 * 60_000) return null;
    const ref = user.referredBy;
    if (!ref.isActive || !ref.referralCodeActive) return null;
    return normalizeReferralCode(ref.referralCode);
  }

  /** Привязать по ?mf=code (регистрация / login / bind). Не перезаписывает. */
  async bindByCode(
    userId: string,
    codeRaw: string | null | undefined,
  ): Promise<{ bound: boolean; referrerUserId: string | null }> {
    const code = normalizeReferralCode(codeRaw);
    if (!code) return { bound: false, referrerUserId: null };

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referredByUserId: true },
    });
    if (!existing) return { bound: false, referrerUserId: null };
    if (existing.referredByUserId) {
      return { bound: false, referrerUserId: existing.referredByUserId };
    }

    const resolved = await this.codes.resolveByCode(code);
    if (!resolved) return { bound: false, referrerUserId: null };

    const referrer = await this.prisma.user.findUnique({
      where: { id: resolved.userId },
      select: {
        id: true,
        referralCodeActive: true,
        isActive: true,
      },
    });
    if (!referrer?.isActive || !referrer.referralCodeActive) {
      return { bound: false, referrerUserId: null };
    }
    if (referrer.id === userId) {
      return { bound: false, referrerUserId: null };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        referredByUserId: referrer.id,
        referredByAt: new Date(),
      },
    });
    this.logger.log(`sticky referral bound user=${userId} referrer=${referrer.id}`);
    return { bound: true, referrerUserId: referrer.id };
  }

  /** После успешной attribution на заказе — stamp если пусто. */
  async stampIfEmpty(
    userId: string,
    referrerUserId: string,
  ): Promise<void> {
    const uid = userId?.trim();
    const rid = referrerUserId?.trim();
    if (!uid || !rid || uid === rid) return;
    try {
      await this.prisma.user.updateMany({
        where: { id: uid, referredByUserId: null },
        data: {
          referredByUserId: rid,
          referredByAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(
        `sticky stamp failed user=${uid}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async linkTtlDays(): Promise<number> {
    const s = await this.settings.ensureDefaults();
    return Math.min(3650, Math.max(1, Math.floor(s.linkTtlDays) || 60));
  }
}
