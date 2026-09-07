import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ADMIN_LIST_DEFAULT_LIMIT, ADMIN_LIST_MAX_LIMIT } from '../catalog/catalog.constants';
import { PrismaService } from '../prisma/prisma.service';
import { LocalStorageService } from '../storage/local-storage.service';
import type { CreateReviewAdminDto, UpdateReviewAdminDto } from './dto/reviews.dto';
import {
  REVIEW_TEXT_MAX_LENGTH,
  REVIEW_TEXT_MIN_LENGTH,
} from './dto/reviews.dto';

export type AdminReviewListStatus = 'all' | 'pending' | 'published' | 'rejected';

function serializeReview(
  r: Prisma.ProductReviewGetPayload<{
    include: {
      product: { select: { id: true; name: true; slug: true } };
      user: { select: { id: true; email: true; displayName: true } };
    };
  }>,
) {
  return {
    id: r.id,
    productId: r.productId,
    product: r.product,
    userId: r.userId,
    user: r.user
      ? {
          id: r.user.id,
          email: r.user.email,
          displayName: r.user.displayName,
        }
      : null,
    orderId: r.orderId,
    rating: r.rating,
    text: r.text,
    authorName: r.authorName,
    image1Url: r.image1Url,
    image2Url: r.image2Url,
    isPublished: r.isPublished,
    sortOrder: r.sortOrder,
    moderatedById: r.moderatedById,
    moderatedAt: r.moderatedAt,
    rejectedAt: r.rejectedAt,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const reviewInclude = {
  product: { select: { id: true, name: true, slug: true } },
  user: { select: { id: true, email: true, displayName: true } },
} satisfies Prisma.ProductReviewInclude;

function buildListWhere(opts: {
  q?: string;
  status?: AdminReviewListStatus;
  productId?: string;
}): Prisma.ProductReviewWhereInput {
  const where: Prisma.ProductReviewWhereInput = {};
  if (opts.status === 'pending') {
    where.isPublished = false;
    where.rejectedAt = null;
  } else if (opts.status === 'published') {
    where.isPublished = true;
  } else if (opts.status === 'rejected') {
    where.rejectedAt = { not: null };
  }
  if (opts.productId) where.productId = opts.productId;
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { text: { contains: q, mode: 'insensitive' } },
      { authorName: { contains: q, mode: 'insensitive' } },
      { rejectionReason: { contains: q, mode: 'insensitive' } },
      { product: { name: { contains: q, mode: 'insensitive' } } },
      { product: { slug: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { displayName: { contains: q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

@Injectable()
export class ReviewsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
  ) {}

  async list(opts: {
    q?: string;
    status?: AdminReviewListStatus;
    productId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(
      ADMIN_LIST_MAX_LIMIT,
      Math.max(1, opts.limit ?? ADMIN_LIST_DEFAULT_LIMIT),
    );
    const where = buildListWhere(opts);
    const baseForCounts = buildListWhere({
      q: opts.q,
      productId: opts.productId,
      status: 'all',
    });

    const [total, rows, all, pending, published, rejected] = await Promise.all([
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.findMany({
        where,
        include: reviewInclude,
        orderBy:
          opts.status === 'published'
            ? [{ sortOrder: 'asc' }, { createdAt: 'desc' }]
            : opts.status === 'rejected'
              ? [{ rejectedAt: 'desc' }, { createdAt: 'desc' }]
              : [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productReview.count({ where: baseForCounts }),
      this.prisma.productReview.count({
        where: { ...baseForCounts, isPublished: false, rejectedAt: null },
      }),
      this.prisma.productReview.count({
        where: { ...baseForCounts, isPublished: true },
      }),
      this.prisma.productReview.count({
        where: { ...baseForCounts, rejectedAt: { not: null } },
      }),
    ]);

    return {
      items: rows.map(serializeReview),
      total,
      page,
      limit,
      counts: { all, pending, published, rejected },
    };
  }

  async get(id: string) {
    const row = await this.prisma.productReview.findUnique({
      where: { id },
      include: reviewInclude,
    });
    if (!row) throw new NotFoundException('Отзыв не найден');
    return serializeReview(row);
  }

  async create(dto: CreateReviewAdminDto, moderatorId?: string) {
    await this.requireProduct(dto.productId);
    const rating = dto.rating ?? 5;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Рейтинг 1–5');
    }
    const text = dto.text?.trim() || '';
    const image1Url = this.normalizeMediaUrl(dto.image1Url);
    const image2Url = this.normalizeMediaUrl(dto.image2Url);
    this.assertAdminTextAndMedia(text, image1Url, image2Url);

    const published = dto.isPublished ?? false;
    const maxSort = await this.prisma.productReview.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    const row = await this.prisma.productReview.create({
      data: {
        productId: dto.productId,
        rating,
        text,
        authorName: dto.authorName?.trim() || null,
        image1Url,
        image2Url,
        isPublished: published,
        sortOrder,
        moderatedById: published ? moderatorId ?? null : null,
        moderatedAt: published ? new Date() : null,
      },
      include: reviewInclude,
    });
    return serializeReview(row);
  }

  async update(id: string, dto: UpdateReviewAdminDto, moderatorId?: string) {
    const existing = await this.prisma.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Отзыв не найден');

    const data: Prisma.ProductReviewUpdateInput = {};
    if (dto.rating !== undefined) {
      if (!Number.isInteger(dto.rating) || dto.rating < 1 || dto.rating > 5) {
        throw new BadRequestException('Рейтинг 1–5');
      }
      data.rating = dto.rating;
    }
    if (dto.authorName !== undefined) data.authorName = dto.authorName?.trim() || null;

    const nextText = dto.text !== undefined ? dto.text.trim() : existing.text;
    const nextImage1 =
      dto.image1Url !== undefined
        ? this.normalizeMediaUrl(dto.image1Url)
        : existing.image1Url;
    const nextImage2 =
      dto.image2Url !== undefined
        ? this.normalizeMediaUrl(dto.image2Url)
        : existing.image2Url;

    if (
      dto.text !== undefined ||
      dto.image1Url !== undefined ||
      dto.image2Url !== undefined
    ) {
      this.assertAdminTextAndMedia(nextText, nextImage1, nextImage2);
    }
    if (dto.text !== undefined) data.text = nextText;
    if (dto.image1Url !== undefined) data.image1Url = nextImage1;
    if (dto.image2Url !== undefined) data.image2Url = nextImage2;

    if (dto.isPublished !== undefined) {
      data.isPublished = dto.isPublished;
      if (dto.isPublished) {
        data.rejectedAt = null;
        data.rejectionReason = null;
        if (!existing.isPublished) {
          data.moderatedBy = moderatorId
            ? { connect: { id: moderatorId } }
            : undefined;
          data.moderatedAt = new Date();
        }
      }
    }

    const row = await this.prisma.productReview.update({
      where: { id },
      data,
      include: reviewInclude,
    });

    if (dto.image1Url !== undefined || dto.image2Url !== undefined) {
      const keep = new Set(
        [nextImage1, nextImage2].filter((u): u is string => Boolean(u)),
      );
      for (const old of [existing.image1Url, existing.image2Url]) {
        if (old && !keep.has(old)) {
          await this.storage.deleteByPublicUrl(old);
        }
      }
    }

    return serializeReview(row);
  }

  async publish(id: string, moderatorId: string) {
    return this.update(id, { isPublished: true }, moderatorId);
  }

  /** Снять с витрины без пометки «отклонён» (снова в очереди модерации). */
  async unpublish(id: string) {
    const existing = await this.prisma.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Отзыв не найден');
    const row = await this.prisma.productReview.update({
      where: { id },
      data: {
        isPublished: false,
        rejectedAt: null,
        rejectionReason: null,
      },
      include: reviewInclude,
    });
    return serializeReview(row);
  }

  /** Soft-reject: остаётся в БД с причиной; с витрины снимается. */
  async reject(id: string, reason: string, moderatorId?: string) {
    const existing = await this.prisma.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Отзыв не найден');
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException('Укажите причину отклонения');
    }
    const row = await this.prisma.productReview.update({
      where: { id },
      data: {
        isPublished: false,
        rejectedAt: new Date(),
        rejectionReason: trimmed,
        moderatedById: moderatorId ?? existing.moderatedById,
        moderatedAt: new Date(),
      },
      include: reviewInclude,
    });
    return serializeReview(row);
  }

  async remove(id: string) {
    const existing = await this.prisma.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Отзыв не найден');
    await this.prisma.productReview.delete({ where: { id } });
    if (existing.image1Url) await this.storage.deleteByPublicUrl(existing.image1Url);
    if (existing.image2Url) await this.storage.deleteByPublicUrl(existing.image2Url);
    return { ok: true };
  }

  async bulkPublish(ids: string[], moderatorId: string) {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new BadRequestException('Пустой список id');
    const now = new Date();
    const result = await this.prisma.productReview.updateMany({
      where: { id: { in: unique } },
      data: {
        isPublished: true,
        rejectedAt: null,
        rejectionReason: null,
        moderatedById: moderatorId,
        moderatedAt: now,
      },
    });
    return { ok: true as const, updated: result.count };
  }

  async bulkReject(ids: string[], reason: string, moderatorId: string) {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new BadRequestException('Пустой список id');
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException('Укажите причину отклонения');
    }
    const now = new Date();
    const result = await this.prisma.productReview.updateMany({
      where: { id: { in: unique } },
      data: {
        isPublished: false,
        rejectedAt: now,
        rejectionReason: trimmed,
        moderatedById: moderatorId,
        moderatedAt: now,
      },
    });
    return { ok: true as const, updated: result.count };
  }

  async bulkRemove(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new BadRequestException('Пустой список id');
    const rows = await this.prisma.productReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, image1Url: true, image2Url: true },
    });
    await this.prisma.productReview.deleteMany({ where: { id: { in: unique } } });
    for (const row of rows) {
      if (row.image1Url) await this.storage.deleteByPublicUrl(row.image1Url);
      if (row.image2Url) await this.storage.deleteByPublicUrl(row.image2Url);
    }
    return { ok: true as const, deleted: rows.length };
  }

  /**
   * Глобальный reorder опубликованных: `orderedIds` — новый порядок окна (страницы).
   * Окно вставляется на место прежнего contiguous-сегмента в полном списке; sortOrder 0..n-1.
   */
  async reorder(orderedIds: string[]) {
    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length) {
      throw new BadRequestException('В порядке не должно быть дубликатов id');
    }
    if (!orderedIds.length) {
      throw new BadRequestException('Пустой порядок');
    }

    const all = await this.prisma.productReview.findMany({
      where: { isPublished: true },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });
    const indexById = new Map(all.map((r, i) => [r.id, i]));
    const indices = orderedIds.map((id) => {
      const i = indexById.get(id);
      if (i === undefined) {
        throw new BadRequestException('Можно менять порядок только у опубликованных отзывов');
      }
      return i;
    });
    const minI = Math.min(...indices);
    const maxI = Math.max(...indices);
    if (maxI - minI + 1 !== orderedIds.length) {
      throw new BadRequestException(
        'Окно сортировки должно быть непрерывным в глобальном порядке (без фильтров/поиска)',
      );
    }
    const windowSet = new Set(all.slice(minI, maxI + 1).map((r) => r.id));
    for (const id of orderedIds) {
      if (!windowSet.has(id)) {
        throw new BadRequestException('Несогласованное окно сортировки');
      }
    }

    const merged = [
      ...all.slice(0, minI).map((r) => r.id),
      ...orderedIds,
      ...all.slice(maxI + 1).map((r) => r.id),
    ];

    await this.prisma.$transaction(
      merged.map((id, sortOrder) =>
        this.prisma.productReview.update({
          where: { id },
          data: { sortOrder },
        }),
      ),
    );
    return { ok: true as const };
  }

  async uploadMedia(file: {
    buffer: Buffer;
    mimetype: string;
    size: number;
    originalname?: string;
  }) {
    const { url, mediaType } = await this.storage.saveGalleryMedia(file, 'reviews');
    return { url, mediaType };
  }

  /**
   * Только локальный storage: `/uploads/…` или absolute с pathname `/uploads/…`.
   * Внешние CDN/произвольные URL отклоняются.
   */
  normalizeMediaUrl(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const t = String(raw).trim();
    if (!t) return null;
    if (t.startsWith('/uploads/')) return t;
    try {
      const u = new URL(t);
      if (u.pathname.startsWith('/uploads/')) return t;
    } catch {
      /* not absolute */
    }
    if (this.storage.tryPublicUrlToKey(t)) return t;
    throw new BadRequestException(
      'Недопустимый URL медиа (ожидается локальный /uploads/… через upload)',
    );
  }

  private assertAdminTextAndMedia(
    text: string,
    image1Url: string | null,
    image2Url: string | null,
  ) {
    if (text.length > REVIEW_TEXT_MAX_LENGTH) {
      throw new BadRequestException(
        `Текст отзыва — максимум ${REVIEW_TEXT_MAX_LENGTH} символов`,
      );
    }
    const hasMedia = Boolean(image1Url || image2Url);
    if (!hasMedia && text.length < REVIEW_TEXT_MIN_LENGTH) {
      throw new BadRequestException(
        `Текст — минимум ${REVIEW_TEXT_MIN_LENGTH} символов, если нет медиа`,
      );
    }
  }

  private async requireProduct(productId: string) {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Товар не найден');
  }
}
