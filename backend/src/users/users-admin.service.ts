import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { formatPhoneE164, isValidPhone } from '../common/phone.util';
import { QUIZ_FUNNEL_STEPS } from '../quiz/quiz-events.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralCodeService } from '../referral/referral-code.service';
import { UserGroupsAdminService } from '../user-groups/user-groups-admin.service';
import type { UpdateRetailUserProfileDto } from './dto/update-retail-user-profile.dto';

/** Пустая строка → null; иначе E.164 или BadRequest. */
function normalizeOptionalPhone(raw: string | null | undefined): string | null {
  const t = raw?.trim() || '';
  if (!t) return null;
  if (!isValidPhone(t)) {
    throw new BadRequestException('Некорректный телефон');
  }
  return formatPhoneE164(t);
}

function normalizeOptionalBirthday(raw: string | null | undefined): Date | null {
  const t = raw?.trim() || '';
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new BadRequestException('Некорректная дата рождения');
  }
  const d = new Date(`${t}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Некорректная дата рождения');
  }
  return d;
}

const LIST_MAX = 100;
const LIST_DEFAULT = 20;
const ORDERS_PAGE_DEFAULT = 50;
const ORDERS_PAGE_MAX = 100;
const QUIZ_EVENTS_CAP = 300;

type QuizSavedPayload = {
  version: number;
  zone: string;
  completedAt: string;
  answers: Record<string, unknown>;
  result: { priority: number | null; blockKeys: string[] };
};

type QuizFunnelStepView = {
  key: string;
  label: string;
  zone: string | null;
  viewed: boolean;
  completed: boolean;
};

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userGroups: UserGroupsAdminService,
    private readonly referralCodes: ReferralCodeService,
  ) {}

  async listRetailUsers(opts: { q?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(LIST_MAX, Math.max(1, opts.limit ?? LIST_DEFAULT));
    const where = this.retailListWhere(opts.q);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          displayName: true,
          isActive: true,
          createdAt: true,
          marketingConsent: true,
          _count: { select: { orders: true } },
        },
      }),
    ]);

    const emails = rows.map((r) => r.email.toLowerCase());
    const subscribers =
      emails.length === 0
        ? []
        : await this.prisma.newsletterSubscriber.findMany({
            where: {
              email: { in: emails },
              unsubscribedAt: null,
            },
            select: { email: true },
          });
    const subSet = new Set(subscribers.map((s) => s.email.toLowerCase()));

    return {
      items: rows.map((r) => {
        const email = r.email.toLowerCase();
        const newsletterSubscribed = subSet.has(email);
        return {
          id: r.id,
          email: r.email,
          displayName: r.displayName,
          isActive: r.isActive,
          createdAt: r.createdAt,
          orderCount: r._count.orders,
          marketingConsent: r.marketingConsent,
          newsletterSubscribed,
          subscribed: r.marketingConsent || newsletterSubscribed,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async getRetailUser(
    id: string,
    opts: { ordersPage?: number; ordersLimit?: number } = {},
  ) {
    const ordersPage = Math.max(1, opts.ordersPage ?? 1);
    const ordersLimit = Math.min(
      ORDERS_PAGE_MAX,
      Math.max(1, opts.ordersLimit ?? ORDERS_PAGE_DEFAULT),
    );

    const u = await this.prisma.user.findFirst({
      where: { id, role: UserRole.USER, isActive: true },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        birthday: true,
        marketingConsent: true,
        marketingConsentAt: true,
        privacyConsentAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        groupId: true,
        referralCode: true,
        referralCodeActive: true,
        group: {
          select: { id: true, name: true, slug: true, assignable: true },
        },
        _count: { select: { orders: true } },
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          select: {
            id: true,
            recipientName: true,
            phone: true,
            city: true,
            address: true,
            apartment: true,
            region: true,
            district: true,
            postalCode: true,
            comment: true,
            isDefault: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!u) throw new NotFoundException('Пользователь не найден');

    const [ordersTotal, orders, quizResultRow, quizEvents] = await Promise.all([
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        skip: (ordersPage - 1) * ordersLimit,
        take: ordersLimit,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
      this.prisma.userQuizResult.findUnique({ where: { userId: id } }),
      this.prisma.quizEvent.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: QUIZ_EVENTS_CAP,
        select: {
          type: true,
          zone: true,
          stepKey: true,
          sessionId: true,
          meta: true,
          createdAt: true,
        },
      }),
    ]);

    const newsletter = await this.prisma.newsletterSubscriber.findUnique({
      where: { email: u.email.toLowerCase() },
      select: {
        email: true,
        name: true,
        source: true,
        subscribedAt: true,
        unsubscribedAt: true,
      },
    });

    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      phone: u.phone,
      birthday: u.birthday ? u.birthday.toISOString().slice(0, 10) : null,
      marketingConsent: u.marketingConsent,
      marketingConsentAt: u.marketingConsentAt,
      privacyConsentAt: u.privacyConsentAt,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      orderCount: u._count.orders,
      group: u.group,
      groupId: u.groupId,
      referralCode: u.referralCode,
      referralCodeActive: u.referralCodeActive,
      referralLinkPath: u.referralCode
        ? `/?mf=${encodeURIComponent(u.referralCode)}`
        : null,
      addresses: u.addresses,
      orders,
      ordersTotal,
      ordersPage,
      ordersLimit,
      quiz: this.buildQuizAdminView(quizResultRow, quizEvents),
      newsletter: newsletter
        ? {
            email: newsletter.email,
            name: newsletter.name,
            source: newsletter.source,
            subscribedAt: newsletter.subscribedAt,
            unsubscribedAt: newsletter.unsubscribedAt,
            active: !newsletter.unsubscribedAt,
          }
        : null,
      subscribed: u.marketingConsent || Boolean(newsletter && !newsletter.unsubscribedAt),
    };
  }

  async updateUserGroup(userId: string, groupId: string | null) {
    return this.userGroups.updateUserGroup(userId, groupId);
  }

  async updateRetailUserProfile(userId: string, dto: UpdateRetailUserProfileDto) {
    const existing = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER, isActive: true },
      select: { id: true, email: true },
    });
    if (!existing) throw new NotFoundException('Пользователь не найден');

    const email = dto.email.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Email обязателен');
    }

    if (email !== existing.email.toLowerCase()) {
      const taken = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (taken && taken.id !== userId) {
        throw new ConflictException('Пользователь с таким email уже есть');
      }
    }

    const displayName =
      dto.displayName !== undefined
        ? dto.displayName?.trim() || null
        : undefined;
    const phone =
      dto.phone !== undefined ? normalizeOptionalPhone(dto.phone) : undefined;
    const birthday =
      dto.birthday !== undefined
        ? normalizeOptionalBirthday(dto.birthday)
        : undefined;

    const data: Prisma.UserUpdateInput = { email };
    if (displayName !== undefined) data.displayName = displayName;
    if (phone !== undefined) data.phone = phone;
    if (birthday !== undefined) data.birthday = birthday;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          email: true,
          displayName: true,
          phone: true,
          birthday: true,
          updatedAt: true,
        },
      });

      const prevEmail = existing.email.toLowerCase();
      if (email !== prevEmail) {
        const oldSub = await tx.newsletterSubscriber.findUnique({
          where: { email: prevEmail },
          select: { id: true },
        });
        if (oldSub) {
          const clash = await tx.newsletterSubscriber.findUnique({
            where: { email },
            select: { id: true },
          });
          if (!clash) {
            await tx.newsletterSubscriber.update({
              where: { id: oldSub.id },
              data: { email, userId },
            });
          }
        }
      }

      return updated;
    });

    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      phone: row.phone,
      birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : null,
      updatedAt: row.updatedAt,
    };
  }

  /** Выдать код, если нет (кнопка в карточке клиента). */
  async ensureReferralCode(userId: string) {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER, isActive: true },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('Пользователь не найден');
    const issued = await this.referralCodes.ensureForUser(userId);
    return {
      code: issued.code,
      active: issued.active,
      created: issued.created,
      linkPath: `/?mf=${encodeURIComponent(issued.code)}`,
    };
  }

  /** Сменить код. `grace: false` — отозвать aliases сразу. */
  async regenerateReferralCode(
    userId: string,
    opts?: { grace?: boolean },
  ) {
    const out = await this.referralCodes.regenerateForUser(userId, opts);
    return {
      code: out.code,
      active: out.active,
      grace: out.grace,
      linkPath: `/?mf=${encodeURIComponent(out.code)}`,
    };
  }

  async setReferralCodeActive(userId: string, active: boolean) {
    await this.referralCodes.setActive(userId, active);
    return { active };
  }

  /**
   * Мягкое удаление покупателя: деактивация + анонимизация.
   * Заказы сохраняются. Restore / просмотр удалённых — не в v1.
   */
  async deleteRetailUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: UserRole.USER },
      select: { id: true, isActive: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (!user.isActive) throw new BadRequestException('Пользователь уже удалён');

    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    await this.prisma.$transaction([
      this.prisma.userAddress.deleteMany({ where: { userId: id } }),
      this.prisma.userQuizResult.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({
        where: { id },
        data: {
          isActive: false,
          email: `deleted-${id}@deleted.jcos.local`,
          displayName: null,
          phone: null,
          marketingConsent: false,
          marketingConsentAt: null,
          marketingConsentVersion: null,
          passwordHash,
        },
      }),
    ]);

    return { ok: true };
  }

  private buildQuizAdminView(
    row: {
      version: number;
      zone: string;
      answers: Prisma.JsonValue;
      result: Prisma.JsonValue;
      completedAt: Date;
      updatedAt: Date;
    } | null,
    events: {
      type: string;
      zone: string | null;
      stepKey: string | null;
      sessionId: string;
      meta: Prisma.JsonValue;
      createdAt: Date;
    }[],
  ) {
    const saved = row ? this.mapSavedQuizResult(row) : null;

    const viewed = new Set<string>();
    const completed = new Set<string>();
    const sessions = new Set<string>();
    let lastActivityAt: string | null = null;
    let lastZone: string | null = null;
    let lastCompleteMeta: { blockKeys: string[]; priority: number | null } | null =
      null;

    for (const ev of events) {
      sessions.add(ev.sessionId);
      if (!lastActivityAt) lastActivityAt = ev.createdAt.toISOString();
      if (!lastZone && ev.zone) lastZone = ev.zone;

      if (ev.type === 'quiz_start') viewed.add('start');
      if (ev.type === 'zone_select') {
        viewed.add('zone');
        completed.add('zone');
      }
      if (ev.stepKey) {
        if (ev.type === 'step_view' || ev.type === 'quiz_complete') {
          viewed.add(ev.stepKey);
        }
        if (ev.type === 'step_complete' || ev.type === 'quiz_complete') {
          completed.add(ev.stepKey);
          viewed.add(ev.stepKey);
        }
      }
      if (ev.type === 'quiz_complete' && !lastCompleteMeta) {
        lastCompleteMeta = this.extractCompleteMeta(ev.meta);
      }
    }

    const funnel: QuizFunnelStepView[] = QUIZ_FUNNEL_STEPS.map((step) => ({
      key: step.key,
      label: step.label,
      zone: step.zone ?? null,
      viewed: viewed.has(step.key),
      completed: completed.has(step.key),
    }));

    return {
      saved,
      funnel,
      stats: {
        eventsCount: events.length,
        sessionsCount: sessions.size,
        lastActivityAt,
        lastZone,
        lastCompleteBlockKeys: lastCompleteMeta?.blockKeys ?? [],
        lastCompletePriority: lastCompleteMeta?.priority ?? null,
      },
    };
  }

  private mapSavedQuizResult(row: {
    version: number;
    zone: string;
    answers: Prisma.JsonValue;
    result: Prisma.JsonValue;
    completedAt: Date;
    updatedAt: Date;
  }): QuizSavedPayload & { updatedAt: string } {
    const resultObj =
      row.result && typeof row.result === 'object' && !Array.isArray(row.result)
        ? (row.result as { priority?: unknown; blockKeys?: unknown })
        : {};
    const blockKeys = Array.isArray(resultObj.blockKeys)
      ? resultObj.blockKeys.filter((k): k is string => typeof k === 'string')
      : [];
    const priority =
      typeof resultObj.priority === 'number' ? resultObj.priority : null;

    return {
      version: row.version,
      zone: row.zone,
      completedAt: row.completedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      answers:
        row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
          ? (row.answers as Record<string, unknown>)
          : {},
      result: { priority, blockKeys },
    };
  }

  private extractCompleteMeta(meta: Prisma.JsonValue): {
    blockKeys: string[];
    priority: number | null;
  } {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return { blockKeys: [], priority: null };
    }
    const obj = meta as { blockKeys?: unknown; priority?: unknown };
    const blockKeys = Array.isArray(obj.blockKeys)
      ? obj.blockKeys.filter((k): k is string => typeof k === 'string')
      : [];
    const priority = typeof obj.priority === 'number' ? obj.priority : null;
    return { blockKeys, priority };
  }

  private retailListWhere(q?: string): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {
      role: UserRole.USER,
      isActive: true,
    };
    const term = q?.trim();
    if (term) {
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { displayName: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
      ];
    }
    return where;
  }
}
