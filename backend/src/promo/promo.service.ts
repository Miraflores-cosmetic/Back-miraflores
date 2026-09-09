import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceContextService } from '../user-groups/commerce-context.service';
import { ADMIN_LIST_MAX_LIMIT } from '../catalog/catalog.constants';
import type { CreatePromoCodeDto, PromoType, UpdatePromoCodeDto } from './dto/promo.dto';
import { PROMO_TYPES } from './dto/promo.dto';
import { promoConsumingRedemptionWhere } from './promo-redemption.util';

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function normalizeEmail(raw?: string | null): string | null {
  const t = raw?.trim().toLowerCase();
  return t || null;
}

function parseOptionalDate(raw: string | null | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || (typeof raw === 'string' && !raw.trim())) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Некорректная дата');
  return d;
}

function parseOptionalInt(raw: number | null | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) throw new BadRequestException('Ожидается целое ≥ 1');
  return n;
}

function assertReward(type: PromoType, value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException('Значение скидки: целое число ≥ 1');
  }
  if (type === 'PERCENT' && value > 100) {
    throw new BadRequestException('PERCENT: максимум 100');
  }
}

export function parsePromoType(raw: string): PromoType {
  if ((PROMO_TYPES as readonly string[]).includes(raw)) return raw as PromoType;
  throw new BadRequestException('Некорректный тип промокода');
}

/** PERCENT / FIXED only — unknown types reject (не fallback на FIXED). */
export function computePromoDiscount(type: string, value: number, subtotal: number): number {
  const base = Math.max(0, Math.floor(subtotal));
  if (base <= 0) return 0;
  const t = parsePromoType(type);
  if (t === 'PERCENT') {
    return Math.min(base, Math.floor((base * value) / 100));
  }
  return Math.min(base, value);
}

export type PromoIdentity = {
  email?: string | null;
  userId?: string | null;
  guestId?: string | null;
};

export type PromoApplyResult = {
  promoCodeId: string;
  code: string;
  type: string;
  value: number;
  discountAmount: number;
  subtotal: number;
  total: number;
  maxUses: number | null;
  oneShot: boolean;
  minOrderAmount: number | null;
  usedCount: number;
};

@Injectable()
export class PromoAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: { q?: string; page?: number; limit?: number; active?: boolean } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, opts.limit ?? 20));
    const where: Prisma.PromoCodeWhereInput = {};
    const q = opts.q?.trim();
    if (q) {
      where.code = { contains: q, mode: 'insensitive' };
    }
    if (opts.active !== undefined) where.active = opts.active;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.promoCode.count({ where }),
      this.prisma.promoCode.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              redemptions: { where: promoConsumingRedemptionWhere },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map(({ _count, ...r }) => ({
        ...r,
        usedCount: _count.redemptions,
      })),
      total,
      page,
      limit,
    };
  }

  async get(id: string, opts: { redemptionsPage?: number; redemptionsLimit?: number } = {}) {
    const redemptionsPage = Math.max(1, opts.redemptionsPage ?? 1);
    const redemptionsLimit = Math.min(
      ADMIN_LIST_MAX_LIMIT,
      Math.max(1, opts.redemptionsLimit ?? 20),
    );

    const row = await this.prisma.promoCode.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            redemptions: { where: promoConsumingRedemptionWhere },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Промокод не найден');

    const redemptionsWhere: Prisma.PromoCodeRedemptionWhereInput = { promoCodeId: id };
    const [redemptionsTotal, redemptions] = await this.prisma.$transaction([
      this.prisma.promoCodeRedemption.count({ where: redemptionsWhere }),
      this.prisma.promoCodeRedemption.findMany({
        where: redemptionsWhere,
        orderBy: { createdAt: 'desc' },
        skip: (redemptionsPage - 1) * redemptionsLimit,
        take: redemptionsLimit,
        select: {
          id: true,
          orderId: true,
          code: true,
          discountAmount: true,
          email: true,
          userId: true,
          guestId: true,
          createdAt: true,
          order: { select: { number: true, total: true, status: true } },
        },
      }),
    ]);

    const { _count, ...rest } = row;
    return {
      ...rest,
      usedCount: _count.redemptions,
      redemptions,
      redemptionsTotal,
      redemptionsPage,
      redemptionsLimit,
    };
  }

  async create(dto: CreatePromoCodeDto) {
    const code = normalizeCode(dto.code);
    if (!code) throw new BadRequestException('Укажите код');
    assertReward(dto.type, dto.value);
    const startsAt = parseOptionalDate(dto.startsAt) ?? null;
    const endsAt = parseOptionalDate(dto.endsAt) ?? null;
    if (startsAt && endsAt && endsAt < startsAt) {
      throw new BadRequestException('Дата окончания раньше начала');
    }
    try {
      return await this.prisma.promoCode.create({
        data: {
          code,
          type: dto.type,
          value: dto.value,
          active: dto.active ?? true,
          startsAt,
          endsAt,
          maxUses: parseOptionalInt(dto.maxUses) ?? null,
          oneShot: dto.oneShot ?? false,
          minOrderAmount: parseOptionalInt(dto.minOrderAmount) ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Такой код уже есть');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdatePromoCodeDto) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Промокод не найден');

    const type = parsePromoType(dto.type ?? existing.type);
    const value = dto.value ?? existing.value;
    assertReward(type, value);

    const data: Prisma.PromoCodeUpdateInput = {};
    if (dto.code !== undefined) data.code = normalizeCode(dto.code);
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.startsAt !== undefined) data.startsAt = parseOptionalDate(dto.startsAt) ?? null;
    if (dto.endsAt !== undefined) data.endsAt = parseOptionalDate(dto.endsAt) ?? null;
    if (dto.maxUses !== undefined) data.maxUses = parseOptionalInt(dto.maxUses) ?? null;
    if (dto.oneShot !== undefined) data.oneShot = dto.oneShot;
    if (dto.minOrderAmount !== undefined) {
      data.minOrderAmount = parseOptionalInt(dto.minOrderAmount) ?? null;
    }

    const nextStarts =
      dto.startsAt !== undefined ? (parseOptionalDate(dto.startsAt) ?? null) : existing.startsAt;
    const nextEnds =
      dto.endsAt !== undefined ? (parseOptionalDate(dto.endsAt) ?? null) : existing.endsAt;
    if (nextStarts && nextEnds && nextEnds < nextStarts) {
      throw new BadRequestException('Дата окончания раньше начала');
    }

    try {
      return await this.prisma.promoCode.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Такой код уже есть');
      }
      throw e;
    }
  }

  async delete(id: string) {
    const existing = await this.prisma.promoCode.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!existing) throw new NotFoundException('Промокод не найден');

    // История применений: при любых redemption — только active=false (без cascade wipe).
    if (existing._count.redemptions > 0) {
      const row = await this.prisma.promoCode.update({
        where: { id },
        data: { active: false },
      });
      return { ok: true, deactivated: true, id: row.id, code: row.code };
    }

    await this.prisma.promoCode.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }
}

@Injectable()
export class PromoPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceContext: CommerceContextService,
  ) {}

  /**
   * Preview для drawer: доверяет client subtotal (UX).
   * Лимиты maxUses / oneShot проверяются мягко (если переданы email/guestId).
   */
  async validate(
    codeRaw: string,
    subtotal: number,
    identity: PromoIdentity = {},
    buyerUserId?: string | null,
  ) {
    const ctx = await this.commerceContext.resolveFromUserId(buyerUserId);
    if (!ctx.allowPromoCodes) {
      throw new BadRequestException('Промокод недоступен для вашей группы');
    }
    return this.applyAgainstSubtotal(codeRaw, subtotal, identity, { enforceIdentity: false });
  }

  /**
   * Checkout: только после серверного пересчёта корзины.
   * oneShot / maxUses — жёстко.
   */
  async applyForCheckout(codeRaw: string, serverSubtotal: number, identity: PromoIdentity) {
    return this.applyAgainstSubtotal(codeRaw, serverSubtotal, identity, { enforceIdentity: true });
  }

  private async applyAgainstSubtotal(
    codeRaw: string,
    subtotal: number,
    identity: PromoIdentity,
    opts: { enforceIdentity: boolean },
  ): Promise<PromoApplyResult> {
    const code = normalizeCode(codeRaw);
    if (!code) throw new BadRequestException('Введите промокод');

    const row = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!row || !row.active) {
      throw new BadRequestException('Промокод не найден или неактивен');
    }

    const now = new Date();
    if (row.startsAt && row.startsAt > now) {
      throw new BadRequestException('Промокод ещё не действует');
    }
    if (row.endsAt && row.endsAt < now) {
      throw new BadRequestException('Срок действия промокода истёк');
    }

    const sub = Math.max(0, Math.floor(subtotal));
    if (row.minOrderAmount != null && sub < row.minOrderAmount) {
      throw new BadRequestException(
        `Минимальная сумма заказа для промокода — ${row.minOrderAmount} ₽`,
      );
    }

    const usedCount = await this.prisma.promoCodeRedemption.count({
      where: { promoCodeId: row.id, ...promoConsumingRedemptionWhere },
    });
    if (row.maxUses != null && usedCount >= row.maxUses) {
      throw new BadRequestException('Лимит применений промокода исчерпан');
    }

    const email = normalizeEmail(identity.email);
    const userId = identity.userId?.trim() || null;
    const guestId = identity.guestId?.trim() || null;

    if (row.oneShot) {
      if (!email && opts.enforceIdentity) {
        throw new BadRequestException('Для one-shot промокода нужен email');
      }
      if (!email && !opts.enforceIdentity) {
        throw new BadRequestException(
          'Укажите email в форме оформления, чтобы проверить промокод',
        );
      }
      const or: Prisma.PromoCodeRedemptionWhereInput[] = [];
      if (email) or.push({ email });
      if (userId) or.push({ userId });
      if (guestId) or.push({ guestId });
      if (or.length) {
        const prior = await this.prisma.promoCodeRedemption.findFirst({
          where: {
            promoCodeId: row.id,
            ...promoConsumingRedemptionWhere,
            OR: or,
          },
          select: { id: true },
        });
        if (prior) {
          throw new BadRequestException('Этот промокод уже был использован');
        }
      }
    }

    const discountAmount = computePromoDiscount(row.type, row.value, sub);
    return {
      promoCodeId: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      discountAmount,
      subtotal: sub,
      total: Math.max(0, sub - discountAmount),
      maxUses: row.maxUses,
      oneShot: row.oneShot,
      minOrderAmount: row.minOrderAmount,
      usedCount,
    };
  }
}
