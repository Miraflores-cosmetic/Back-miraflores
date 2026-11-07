import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateReferralCode, normalizeReferralCode } from './referral-code';

const MAX_ALLOC_ATTEMPTS = 12;

@Injectable()
export class ReferralCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Уникальный свободный код (проверка в БД). */
  async allocateUniqueCode(length = 8): Promise<string> {
    for (let i = 0; i < MAX_ALLOC_ATTEMPTS; i++) {
      const code = generateReferralCode(length);
      const taken = await this.prisma.user.findFirst({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new BadRequestException('Не удалось выделить реферальный код');
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

  /** Admin: принудительно новый код (старый ?mf= перестаёт резолвиться). */
  async regenerateForUser(
    userId: string,
  ): Promise<{ code: string; active: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER },
      select: { id: true, isActive: true, referralCodeActive: true },
    });
    if (!user || !user.isActive) {
      throw new NotFoundException('Пользователь не найден');
    }

    for (let i = 0; i < MAX_ALLOC_ATTEMPTS; i++) {
      const code = await this.allocateUniqueCode();
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: { referralCode: code },
        });
        return { code, active: user.referralCodeActive };
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
