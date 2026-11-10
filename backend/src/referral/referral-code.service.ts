import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateReferralCode, normalizeReferralCode } from './referral-code';
import { ReferralSettingsService } from './referral-settings.service';

const MAX_ALLOC_ATTEMPTS = 12;

export type ResolvedMfCode = {
  userId: string;
  /** Нормализованный код из запроса (?mf=). */
  code: string;
  /** true — найден по ReferralCodeAlias в grace, не по текущему User.referralCode. */
  matchedByCodeAlias: boolean;
};

@Injectable()
export class ReferralCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ReferralSettingsService,
  ) {}

  /** Уникальный свободный код (live + неза истёкшие aliases). */
  async allocateUniqueCode(length = 8): Promise<string> {
    const now = new Date();
    for (let i = 0; i < MAX_ALLOC_ATTEMPTS; i++) {
      const code = generateReferralCode(length);
      const taken = await this.prisma.user.findFirst({
        where: { referralCode: code },
        select: { id: true },
      });
      if (taken) continue;

      const alias = await this.prisma.referralCodeAlias.findUnique({
        where: { code },
        select: { id: true, expiresAt: true },
      });
      if (alias) {
        if (alias.expiresAt > now) continue;
        // Истёкший alias — освобождаем код.
        await this.prisma.referralCodeAlias.delete({ where: { id: alias.id } });
      }
      return code;
    }
    throw new BadRequestException('Не удалось выделить реферальный код');
  }

  /**
   * Live User.referralCode или alias с expiresAt > now.
   * Для createOrder / sticky bind.
   */
  async resolveByCode(
    codeRaw: string | null | undefined,
  ): Promise<ResolvedMfCode | null> {
    const code = normalizeReferralCode(codeRaw);
    if (!code) return null;

    const live = await this.prisma.user.findFirst({
      where: { referralCode: code },
      select: { id: true },
    });
    if (live) {
      return { userId: live.id, code, matchedByCodeAlias: false };
    }

    const alias = await this.prisma.referralCodeAlias.findFirst({
      where: { code, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    if (!alias) return null;
    return { userId: alias.userId, code, matchedByCodeAlias: true };
  }

  /**
   * Выдать код, если ещё нет. Идемпотентно.
   * Не реактивирует referralCodeActive=false — только admin setActive.
   * @returns created=true если только что выдали.
   */
  async ensureForUser(
    userId: string,
  ): Promise<{ code: string; created: boolean; active: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        referralCode: true,
        referralCodeActive: true,
        role: true,
        isActive: true,
      },
    });
    if (!user || !user.isActive) {
      throw new NotFoundException('Пользователь не найден');
    }
    if (user.referralCode) {
      return {
        code: user.referralCode,
        created: false,
        active: user.referralCodeActive,
      };
    }

    for (let i = 0; i < MAX_ALLOC_ATTEMPTS; i++) {
      const code = await this.allocateUniqueCode();
      try {
        const updated = await this.prisma.user.updateMany({
          where: { id: userId, referralCode: null },
          data: { referralCode: code, referralCodeActive: true },
        });
        if (updated.count === 1) {
          return { code, created: true, active: true };
        }
        // Гонка: другой запрос уже выдал
        const again = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { referralCode: true, referralCodeActive: true },
        });
        if (again?.referralCode) {
          return {
            code: again.referralCode,
            created: false,
            active: again.referralCodeActive,
          };
        }
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
    throw new BadRequestException('Не удалось выдать реферальный код');
  }

  /**
   * Admin: новый код.
   * `grace: true` (default) — старый код → ReferralCodeAlias на linkTtlDays.
   * `grace: false` — без alias; все aliases пользователя удаляются (утечка / агрегатор).
   */
  async regenerateForUser(
    userId: string,
    opts?: { grace?: boolean },
  ): Promise<{ code: string; active: boolean; grace: boolean }> {
    const grace = opts?.grace !== false;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER },
      select: {
        id: true,
        isActive: true,
        referralCodeActive: true,
        referralCode: true,
      },
    });
    if (!user || !user.isActive) {
      throw new NotFoundException('Пользователь не найден');
    }

    const settings = await this.settings.ensureDefaults();
    const graceDays = Math.min(
      3650,
      Math.max(1, Math.floor(settings.linkTtlDays) || 60),
    );
    const expiresAt = new Date(Date.now() + graceDays * 24 * 60 * 60_000);
    const previous = normalizeReferralCode(user.referralCode);

    for (let i = 0; i < MAX_ALLOC_ATTEMPTS; i++) {
      const code = await this.allocateUniqueCode();
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: userId },
            data: { referralCode: code },
          });
          if (!grace) {
            // Утечка: убить все старые ?mf= этого реферера, не только previous.
            await tx.referralCodeAlias.deleteMany({ where: { userId } });
            return;
          }
          if (previous && previous !== code) {
            await tx.referralCodeAlias.upsert({
              where: { code: previous },
              create: {
                userId,
                code: previous,
                expiresAt,
              },
              update: {
                userId,
                expiresAt,
              },
            });
          }
        });
        return { code, active: user.referralCodeActive, grace };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
    throw new BadRequestException('Не удалось сменить реферальный код');
  }

  async setActive(userId: string, active: boolean): Promise<void> {
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, role: UserRole.USER },
      data: { referralCodeActive: active },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Пользователь не найден');
    }
  }

  /** Для registerBuyer: код в create data. */
  peekNormalized(raw: string | null | undefined): string | null {
    return normalizeReferralCode(raw);
  }
}
