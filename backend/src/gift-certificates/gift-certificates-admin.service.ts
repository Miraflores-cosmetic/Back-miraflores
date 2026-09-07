import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GiftCertificateLedgerKind,
  GiftCertificateSource,
  GiftCertificateStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { ADMIN_LIST_MAX_LIMIT } from '../catalog/catalog.constants';
import type {
  AdjustGiftCertificateDto,
  CreateDenominationDto,
  ExtendGiftCertificateDto,
  IssueGiftCertificateDto,
  UpdateDenominationDto,
} from './dto/gift-certificate.dto';
import {
  generateGiftCertificateCode,
  normalizeGiftCertificateCode,
} from './gift-certificate-code.util';
import {
  giftCertificateIssuedEmail,
  maskGiftCertificateCode,
} from './gift-purchase-email';
import { expireOverdueGiftCertificates } from './gift-certificate-expire.util';
import { closeOpenGiftCapturesOnRevoke } from './gift-certificate-hold.util';

function parseOptionalDate(raw: string | null | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || (typeof raw === 'string' && !raw.trim())) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Некорректная дата');
  return d;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const denominationImageOrder = { sortOrder: 'asc' as const };

const denominationListInclude = {
  _count: { select: { certificates: true } },
  images: { orderBy: denominationImageOrder },
} satisfies Prisma.GiftCertificateDenominationInclude;

const certListSelect = {
  id: true,
  code: true,
  denominationId: true,
  faceValue: true,
  balance: true,
  status: true,
  source: true,
  issuedAt: true,
  expiresAt: true,
  recipientEmail: true,
  recipientUserId: true,
  issuedByUserId: true,
  note: true,
  purchaseOrderId: true,
  createdAt: true,
  updatedAt: true,
  denomination: { select: { id: true, name: true, faceValue: true } },
} satisfies Prisma.GiftCertificateSelect;

type LockedGiftCert = {
  id: string;
  balance: number;
  faceValue: number;
  status: GiftCertificateStatus;
  expiresAt: Date | null;
};

@Injectable()
export class GiftCertificatesAdminService {
  private readonly logger = new Logger(GiftCertificatesAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly storage: LocalStorageService,
  ) {}

  /** ACTIVE с expiresAt в прошлом → EXPIRED. */
  async expireOverdueCertificates(now = new Date()): Promise<number> {
    return expireOverdueGiftCertificates(this.prisma, now);
  }

  // --- Denominations ---

  async listDenominations(opts: { active?: boolean } = {}) {
    const where: Prisma.GiftCertificateDenominationWhereInput = {};
    if (opts.active !== undefined) where.active = opts.active;
    return this.prisma.giftCertificateDenomination.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { faceValue: 'asc' }],
      include: denominationListInclude,
    });
  }

  async createDenomination(dto: CreateDenominationDto) {
    const faceValue = Math.floor(dto.faceValue);
    if (faceValue < 1) throw new BadRequestException('Номинал: целое ≥ 1');
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const agg = await this.prisma.giftCertificateDenomination.aggregate({
        _max: { sortOrder: true },
      });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }
    return this.prisma.giftCertificateDenomination.create({
      data: {
        name: dto.name.trim(),
        faceValue,
        validityDays:
          dto.validityDays === undefined || dto.validityDays === null
            ? null
            : Math.floor(dto.validityDays),
        active: dto.active ?? true,
        sortOrder: Math.floor(sortOrder),
      },
      include: denominationListInclude,
    });
  }

  async reorderDenominations(orderedIds: string[]) {
    const all = await this.prisma.giftCertificateDenomination.findMany({
      select: { id: true },
    });
    const allIds = new Set(all.map((t) => t.id));
    if (orderedIds.length !== allIds.size || orderedIds.some((id) => !allIds.has(id))) {
      throw new BadRequestException('orderedIds должны содержать все номиналы ровно по разу');
    }
    await this.prisma.$transaction(
      orderedIds.map((id, sortOrder) =>
        this.prisma.giftCertificateDenomination.update({
          where: { id },
          data: { sortOrder },
        }),
      ),
    );
    return { ok: true };
  }

  async updateDenomination(id: string, dto: UpdateDenominationDto) {
    const current = await this.prisma.giftCertificateDenomination.findUnique({
      where: { id },
      include: { _count: { select: { certificates: true } } },
    });
    if (!current) throw new NotFoundException('Номинал не найден');

    const data: Prisma.GiftCertificateDenominationUpdateInput = {};
    let faceValueChanged = false;
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.faceValue !== undefined) {
      const faceValue = Math.floor(dto.faceValue);
      if (faceValue < 1) throw new BadRequestException('Номинал: целое ≥ 1');
      if (faceValue !== current.faceValue) faceValueChanged = true;
      data.faceValue = faceValue;
    }
    if (dto.validityDays !== undefined) {
      data.validityDays =
        dto.validityDays === null ? null : Math.floor(dto.validityDays);
    }
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sortOrder !== undefined) data.sortOrder = Math.floor(dto.sortOrder);

    const updated = await this.prisma.giftCertificateDenomination.update({
      where: { id },
      data,
      include: denominationListInclude,
    });

    const warning =
      faceValueChanged && current._count.certificates > 0
        ? `Сумма шаблона изменена. Уже выпущенные сертификаты (${current._count.certificates}) сохраняют свой номинал — меняется только выпуск новых.`
        : null;

    return { ...updated, warning };
  }

  async deleteDenomination(id: string) {
    const current = await this.prisma.giftCertificateDenomination.findUnique({
      where: { id },
      include: {
        _count: { select: { certificates: true } },
        images: true,
      },
    });
    if (!current) throw new NotFoundException('Номинал не найден');
    if (current._count.certificates > 0) {
      // Soft: выключаем, чтобы не ломать историю.
      const row = await this.prisma.giftCertificateDenomination.update({
        where: { id },
        data: { active: false },
        include: denominationListInclude,
      });
      return {
        ok: true as const,
        deleted: false,
        deactivated: true,
        denomination: row,
      };
    }
    await this.prisma.giftCertificateDenomination.delete({ where: { id } });
    for (const img of current.images ?? []) {
      await this.storage.deleteByPublicUrl(img.url);
    }
    return { ok: true as const, deleted: true, deactivated: false };
  }

  async uploadDenominationImage(
    denominationId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
  ) {
    const den = await this.prisma.giftCertificateDenomination.findUnique({
      where: { id: denominationId },
    });
    if (!den) throw new NotFoundException('Номинал не найден');

    const { url, mediaType } = await this.storage.saveGalleryMedia(
      file,
      `gift-certificates/${denominationId}`,
    );
    const maxSort = await this.prisma.giftCertificateDenominationImage.aggregate({
      where: { denominationId },
      _max: { sortOrder: true },
    });
    return this.prisma.giftCertificateDenominationImage.create({
      data: {
        denominationId,
        url,
        mediaType,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async reorderDenominationImages(denominationId: string, imageIds: string[]) {
    const den = await this.prisma.giftCertificateDenomination.findUnique({
      where: { id: denominationId },
      include: { images: true },
    });
    if (!den) throw new NotFoundException('Номинал не найден');
    const existing = new Set(den.images.map((i) => i.id));
    if (imageIds.length !== existing.size || imageIds.some((id) => !existing.has(id))) {
      throw new BadRequestException('Список imageIds должен совпадать с картинками номинала');
    }
    await this.prisma.$transaction(
      imageIds.map((id, sortOrder) =>
        this.prisma.giftCertificateDenominationImage.update({
          where: { id },
          data: { sortOrder },
        }),
      ),
    );
    return this.prisma.giftCertificateDenomination.findUniqueOrThrow({
      where: { id: denominationId },
      include: denominationListInclude,
    });
  }

  async deleteDenominationImage(imageId: string) {
    const image = await this.prisma.giftCertificateDenominationImage.findUnique({
      where: { id: imageId },
    });
    if (!image) throw new NotFoundException('Изображение не найдено');
    await this.prisma.giftCertificateDenominationImage.delete({ where: { id: imageId } });
    await this.storage.deleteByPublicUrl(image.url);
    return { ok: true };
  }

  // --- Certificates ---

  async listCertificates(opts: {
    q?: string;
    page?: number;
    limit?: number;
    status?: GiftCertificateStatus;
    denominationId?: string;
    source?: GiftCertificateSource;
  } = {}) {
    await this.expireOverdueCertificates();

    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, opts.limit ?? 20));
    const where: Prisma.GiftCertificateWhereInput = {};
    const q = opts.q?.trim();
    if (q) {
      where.OR = [
        { code: { contains: normalizeGiftCertificateCode(q), mode: 'insensitive' } },
        { recipientEmail: { contains: q, mode: 'insensitive' } },
        { note: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (opts.status) where.status = opts.status;
    if (opts.denominationId) where.denominationId = opts.denominationId;
    if (opts.source) where.source = opts.source;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.giftCertificate.count({ where }),
      this.prisma.giftCertificate.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: certListSelect,
      }),
    ]);
    return { items, total, page, limit };
  }

  async getCertificate(
    id: string,
    opts: { ledgerPage?: number; ledgerLimit?: number } = {},
  ) {
    await this.expireOverdueCertificates();

    const ledgerPage = Math.max(1, opts.ledgerPage ?? 1);
    const ledgerLimit = Math.min(
      ADMIN_LIST_MAX_LIMIT,
      Math.max(1, opts.ledgerLimit ?? 20),
    );

    const row = await this.prisma.giftCertificate.findUnique({
      where: { id },
      select: certListSelect,
    });
    if (!row) throw new NotFoundException('Сертификат не найден');

    const [ledgerTotal, ledgerRaw] = await this.prisma.$transaction([
      this.prisma.giftCertificateLedger.count({ where: { certificateId: id } }),
      this.prisma.giftCertificateLedger.findMany({
        where: { certificateId: id },
        orderBy: { createdAt: 'desc' },
        skip: (ledgerPage - 1) * ledgerLimit,
        take: ledgerLimit,
      }),
    ]);

    const actorIds = [
      ...new Set(
        [
          ...ledgerRaw.map((e) => e.actorUserId),
          row.issuedByUserId,
        ].filter((x): x is string => Boolean(x)),
      ),
    ];
    const actors =
      actorIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: {
              id: true,
              email: true,
              displayName: true,
              staffDisplayName: true,
            },
          })
        : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    const orderIds = [
      ...new Set(
        [
          ...ledgerRaw.map((e) => e.orderId),
          row.purchaseOrderId,
        ].filter((x): x is string => Boolean(x)),
      ),
    ];
    const orders =
      orderIds.length > 0
        ? await this.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, number: true },
          })
        : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const toActor = (userId: string | null) => {
      if (!userId) return null;
      const actor = actorById.get(userId);
      if (!actor) return { id: userId, email: '', label: `${userId.slice(0, 8)}…` };
      const label =
        actor.staffDisplayName?.trim() ||
        actor.displayName?.trim() ||
        actor.email;
      return { id: actor.id, email: actor.email, label };
    };

    const ledger = ledgerRaw.map((e) => {
      const ord = e.orderId ? orderById.get(e.orderId) : undefined;
      return {
        ...e,
        actor: toActor(e.actorUserId),
        order: ord
          ? { id: ord.id, number: ord.number }
          : e.orderId
            ? { id: e.orderId, number: null }
            : null,
      };
    });

    const purchase = row.purchaseOrderId
      ? orderById.get(row.purchaseOrderId)
      : undefined;

    return {
      ...row,
      issuedBy: toActor(row.issuedByUserId),
      purchaseOrder: purchase
        ? { id: purchase.id, number: purchase.number }
        : row.purchaseOrderId
          ? { id: row.purchaseOrderId, number: null }
          : null,
      ledger,
      ledgerTotal,
      ledgerPage,
      ledgerLimit,
    };
  }

  async issue(actorUserId: string, dto: IssueGiftCertificateDto) {
    const count = Math.min(100, Math.max(1, Math.floor(dto.count ?? 1)));
    if (dto.code && count > 1) {
      throw new BadRequestException('Ручной код можно указать только при выпуске 1 шт.');
    }

    let faceValue: number;
    let denominationId: string | null = null;
    let validityDays: number | null = null;

    if (dto.denominationId) {
      const den = await this.prisma.giftCertificateDenomination.findUnique({
        where: { id: dto.denominationId },
      });
      if (!den || !den.active) {
        throw new BadRequestException('Номинал не найден или выключен');
      }
      denominationId = den.id;
      faceValue = den.faceValue;
      validityDays = den.validityDays;
    } else if (dto.faceValue != null) {
      faceValue = Math.floor(dto.faceValue);
      if (faceValue < 1) throw new BadRequestException('Номинал: целое ≥ 1');
    } else {
      throw new BadRequestException('Укажите denominationId или faceValue');
    }

    const expiresOverride = parseOptionalDate(dto.expiresAt);
    const recipientEmail = dto.recipientEmail?.trim().toLowerCase() || null;
    const note = dto.note?.trim() || null;
    const issuedAt = new Date();

    const recipientUserId = recipientEmail
      ? (
          await this.prisma.user.findUnique({
            where: { email: recipientEmail },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const expiresAt =
      expiresOverride !== undefined
        ? expiresOverride
        : validityDays != null
          ? addDays(issuedAt, validityDays)
          : null;

    const manualCode = dto.code
      ? normalizeGiftCertificateCode(dto.code)
      : null;
    if (manualCode && manualCode.length < 6) {
      throw new BadRequestException('Код слишком короткий (мин. 6)');
    }
    if (manualCode) {
      const taken = await this.prisma.giftCertificate.findUnique({
        where: { code: manualCode },
        select: { id: true },
      });
      if (taken) throw new BadRequestException('Код уже занят');
    }

    type IssuedRow = {
      id: string;
      code: string;
      faceValue: number;
      balance: number;
      status: GiftCertificateStatus;
      expiresAt: Date | null;
    };

    let created: IssuedRow[];
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const items: IssuedRow[] = [];
        for (let i = 0; i < count; i++) {
          let code: string;
          if (manualCode) {
            code = manualCode;
          } else {
            // Collision → regenerate inside the same tx (без отдельной tx на каждый код).
            let allocated: string | null = null;
            for (let attempt = 0; attempt < 16; attempt++) {
              const candidate = generateGiftCertificateCode();
              try {
                const cert = await tx.giftCertificate.create({
                  data: {
                    code: candidate,
                    denominationId,
                    faceValue,
                    balance: faceValue,
                    status: GiftCertificateStatus.ACTIVE,
                    source: GiftCertificateSource.ADMIN,
                    issuedAt,
                    expiresAt,
                    recipientEmail,
                    recipientUserId,
                    issuedByUserId: actorUserId,
                    note,
                  },
                  select: {
                    id: true,
                    code: true,
                    faceValue: true,
                    balance: true,
                    status: true,
                    expiresAt: true,
                  },
                });
                await tx.giftCertificateLedger.create({
                  data: {
                    certificateId: cert.id,
                    kind: GiftCertificateLedgerKind.ISSUE,
                    amount: faceValue,
                    balanceAfter: faceValue,
                    actorUserId,
                    note: note ?? 'Выпуск',
                  },
                });
                items.push(cert);
                allocated = candidate;
                break;
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
            if (!allocated) {
              throw new BadRequestException(
                'Не удалось сгенерировать уникальный код',
              );
            }
            continue;
          }

          // manualCode path (count === 1)
          const cert = await tx.giftCertificate.create({
            data: {
              code,
              denominationId,
              faceValue,
              balance: faceValue,
              status: GiftCertificateStatus.ACTIVE,
              source: GiftCertificateSource.ADMIN,
              issuedAt,
              expiresAt,
              recipientEmail,
              recipientUserId,
              issuedByUserId: actorUserId,
              note,
            },
            select: {
              id: true,
              code: true,
              faceValue: true,
              balance: true,
              status: true,
              expiresAt: true,
            },
          });
          await tx.giftCertificateLedger.create({
            data: {
              certificateId: cert.id,
              kind: GiftCertificateLedgerKind.ISSUE,
              amount: faceValue,
              balanceAfter: faceValue,
              actorUserId,
              note: note ?? 'Выпуск',
            },
          });
          items.push(cert);
        }
        return items;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('Код уже занят');
      }
      throw e;
    }

    for (const row of created) {
      this.logger.log(
        `Issued gift ${maskGiftCertificateCode(row.code)} face=${faceValue}`,
      );
    }

    let emailDelivered = false;
    if (recipientEmail && created.length) {
      emailDelivered = await this.sendIssuedEmail({
        to: recipientEmail,
        items: created.map((c) => ({
          code: c.code,
          faceValue: c.faceValue,
          expiresAt: c.expiresAt,
        })),
        resend: false,
      });
    }

    return {
      items: created,
      count: created.length,
      emailDelivered,
    };
  }

  async resendEmail(id: string) {
    const cert = await this.prisma.giftCertificate.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        faceValue: true,
        expiresAt: true,
        recipientEmail: true,
        status: true,
      },
    });
    if (!cert) throw new NotFoundException('Сертификат не найден');
    if (!cert.recipientEmail) {
      throw new BadRequestException('У сертификата нет email получателя');
    }
    if (cert.status === GiftCertificateStatus.REVOKED) {
      throw new BadRequestException('Нельзя отправить отозванный сертификат');
    }
    const emailDelivered = await this.sendIssuedEmail({
      to: cert.recipientEmail,
      items: [
        {
          code: cert.code,
          faceValue: cert.faceValue,
          expiresAt: cert.expiresAt,
        },
      ],
      resend: true,
    });
    if (!emailDelivered) {
      throw new BadRequestException(
        'Почта не настроена или отправка не удалась',
      );
    }
    this.logger.log(
      `Resent gift ${maskGiftCertificateCode(cert.code)} to ${cert.recipientEmail}`,
    );
    return { ok: true as const, emailDelivered: true };
  }

  private async sendIssuedEmail(params: {
    to: string;
    items: Array<{ code: string; faceValue: number; expiresAt: Date | null }>;
    resend: boolean;
  }): Promise<boolean> {
    if (!this.mail.isConfigured()) {
      this.logger.warn('SMTP not configured — gift email skipped');
      return false;
    }
    const mail = giftCertificateIssuedEmail(params);
    try {
      await this.mail.sendRaw(mail);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Gift email failed: ${msg}`);
      return false;
    }
  }

  async revoke(actorUserId: string, id: string, note?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedGiftCert[]>`
        SELECT id, balance, "faceValue", status, "expiresAt"
        FROM "GiftCertificate"
        WHERE id = ${id}
        FOR UPDATE
      `;
      const current = locked[0];
      if (!current) throw new NotFoundException('Сертификат не найден');
      if (current.status === GiftCertificateStatus.REVOKED) {
        throw new BadRequestException('Сертификат уже отозван');
      }

      const amount = -current.balance;
      const updated = await tx.giftCertificate.update({
        where: { id },
        data: {
          balance: 0,
          status: GiftCertificateStatus.REVOKED,
        },
        select: certListSelect,
      });
      await tx.giftCertificateLedger.create({
        data: {
          certificateId: id,
          kind: GiftCertificateLedgerKind.REVOKE,
          amount,
          balanceAfter: 0,
          actorUserId: actorUserId,
          note: note?.trim() || 'Отзыв',
        },
      });

      await closeOpenGiftCapturesOnRevoke(tx, id, {
        actorUserId,
        note: 'Закрытие hold при отзыве сертификата (баланс не восстановлен)',
      });

      return updated;
    });
  }

  async adjust(actorUserId: string, id: string, dto: AdjustGiftCertificateDto) {
    const delta = Math.trunc(dto.delta);
    if (delta === 0) throw new BadRequestException('delta не может быть 0');

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedGiftCert[]>`
        SELECT id, balance, "faceValue", status, "expiresAt"
        FROM "GiftCertificate"
        WHERE id = ${id}
        FOR UPDATE
      `;
      const current = locked[0];
      if (!current) throw new NotFoundException('Сертификат не найден');
      if (current.status === GiftCertificateStatus.REVOKED) {
        throw new BadRequestException('Нельзя менять баланс отозванного сертификата');
      }

      const nextBalance = current.balance + delta;
      if (nextBalance < 0) {
        throw new BadRequestException('Баланс не может стать отрицательным');
      }
      if (nextBalance > current.faceValue * 2) {
        // Защита от опечаток; пополнение сверх 2× номинала — через новый выпуск.
        throw new BadRequestException('Слишком большое пополнение (макс. 2× номинала)');
      }

      let status = current.status;
      if (nextBalance === 0) status = GiftCertificateStatus.USED_UP;
      else if (
        status === GiftCertificateStatus.USED_UP ||
        status === GiftCertificateStatus.EXPIRED
      ) {
        const expired =
          current.expiresAt != null && current.expiresAt.getTime() <= Date.now();
        status = expired ? GiftCertificateStatus.EXPIRED : GiftCertificateStatus.ACTIVE;
      }

      const updated = await tx.giftCertificate.update({
        where: { id },
        data: { balance: nextBalance, status },
        select: certListSelect,
      });
      await tx.giftCertificateLedger.create({
        data: {
          certificateId: id,
          kind: GiftCertificateLedgerKind.ADJUST,
          amount: delta,
          balanceAfter: nextBalance,
          actorUserId: actorUserId,
          note: dto.note?.trim() || 'Корректировка',
        },
      });
      return updated;
    });
  }

  async extend(id: string, dto: ExtendGiftCertificateDto) {
    const current = await this.prisma.giftCertificate.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Сертификат не найден');
    if (current.status === GiftCertificateStatus.REVOKED) {
      throw new BadRequestException('Нельзя продлить отозванный сертификат');
    }

    const expiresAt = parseOptionalDate(dto.expiresAt);
    if (expiresAt === undefined) {
      throw new BadRequestException('Укажите expiresAt или null');
    }

    let status = current.status;
    if (current.balance > 0) {
      const expired = expiresAt != null && expiresAt.getTime() <= Date.now();
      status = expired ? GiftCertificateStatus.EXPIRED : GiftCertificateStatus.ACTIVE;
    }

    return this.prisma.giftCertificate.update({
      where: { id },
      data: { expiresAt, status },
      select: certListSelect,
    });
  }
}
