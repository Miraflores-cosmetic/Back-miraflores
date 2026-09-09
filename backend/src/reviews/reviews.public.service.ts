import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LocalStorageService } from '../storage/local-storage.service';
import type { CreateReviewPublicDto } from './dto/reviews.dto';

/** Оплаченные / в доставке — можно оставлять отзыв */
const REVIEWABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

function publicSerialize(r: {
  id: string;
  rating: number;
  text: string;
  authorName: string | null;
  image1Url: string | null;
  image2Url: string | null;
  createdAt: Date;
  user: { displayName: string | null } | null;
}) {
  return {
    id: r.id,
    rating: r.rating,
    text: r.text,
    authorName: r.authorName?.trim() || r.user?.displayName?.trim() || null,
    image1Url: r.image1Url,
    image2Url: r.image2Url,
    createdAt: r.createdAt,
  };
}

@Injectable()
export class ReviewsPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
  ) {}

  async listMyReviewedProductIds(userId: string) {
    const rows = await this.prisma.productReview.findMany({
      where: { userId },
      select: { productId: true },
    });
    return { productIds: rows.map((r) => r.productId) };
  }

  async listByProductSlug(slug: string, opts?: { page?: number; limit?: number }) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        active: true,
        shortDescription: true,
        productType: true,
        images: {
          take: 1,
          orderBy: { sortOrder: 'asc' },
          select: { url: true },
        },
      },
    });
    if (!product || !product.active) throw new NotFoundException('Товар не найден');

    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
    const where = { productId: product.id, isPublished: true };

    const [total, rows, agg] = await Promise.all([
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          rating: true,
          text: true,
          authorName: true,
          image1Url: true,
          image2Url: true,
          createdAt: true,
          user: { select: { displayName: true } },
        },
      }),
      this.prisma.productReview.aggregate({
        where,
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    return {
      product: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        shortDescription: product.shortDescription,
        productType: product.productType,
        imageUrl: product.images[0]?.url ?? null,
      },
      ratingAvg: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
      ratingCount: agg._count._all,
      items: rows.map(publicSerialize),
      total,
      page,
      limit,
    };
  }

  async listPublished(opts?: { page?: number; limit?: number }) {
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 12));
    const where = { isPublished: true, product: { active: true } };

    const [total, rows] = await Promise.all([
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          rating: true,
          text: true,
          authorName: true,
          image1Url: true,
          image2Url: true,
          createdAt: true,
          user: { select: { displayName: true } },
          product: {
            select: {
              id: true,
              slug: true,
              name: true,
              shortDescription: true,
              productType: true,
              images: {
                take: 1,
                orderBy: { sortOrder: 'asc' },
                select: { url: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        ...publicSerialize(r),
        product: {
          id: r.product.id,
          slug: r.product.slug,
          name: r.product.name,
          shortDescription: r.product.shortDescription,
          productType: r.product.productType,
          imageUrl: r.product.images[0]?.url ?? null,
        },
      })),
      total,
      page,
      limit,
    };
  }

  /** @deprecated use listPublished — оставлено для внутренних вызовов с массивом */
  async listLatest(limit = 12) {
    const page = await this.listPublished({ page: 1, limit });
    return page.items;
  }

  private async resolveReviewableOrderId(
    userId: string,
    productId: string,
    orderId?: string | null,
  ): Promise<string> {
    const productInOrder = {
      items: { some: { variant: { productId } } },
    };

    if (orderId?.trim()) {
      const order = await this.prisma.order.findFirst({
        where: {
          id: orderId.trim(),
          userId,
          status: { in: REVIEWABLE_ORDER_STATUSES },
          ...productInOrder,
        },
        select: { id: true },
      });
      if (!order) {
        throw new BadRequestException(
          'Отзыв можно оставить только по оплаченному заказу с этим товаром',
        );
      }
      return order.id;
    }

    const order = await this.prisma.order.findFirst({
      where: {
        userId,
        status: { in: REVIEWABLE_ORDER_STATUSES },
        ...productInOrder,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!order) {
      throw new BadRequestException(
        'Отзыв можно оставить только после покупки этого товара',
      );
    }
    return order.id;
  }

  async create(userId: string, dto: CreateReviewPublicDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, active: true },
    });
    if (!product || !product.active) throw new NotFoundException('Товар не найден');

    const rating = dto.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Рейтинг 1–5');
    }

    const text = dto.text.trim();
    if (text.length < 10) {
      throw new BadRequestException('Текст отзыва — минимум 10 символов');
    }
    if (text.length > 2000) {
      throw new BadRequestException('Текст отзыва — максимум 2000 символов');
    }

    const resolvedOrderId = await this.resolveReviewableOrderId(
      userId,
      dto.productId,
      dto.orderId,
    );

    const dup = await this.prisma.productReview.findFirst({
      where: { productId: dto.productId, userId },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException('Вы уже оставляли отзыв на этот товар');
    }

    let row;
    try {
      row = await this.prisma.productReview.create({
        data: {
          productId: dto.productId,
          userId,
          orderId: resolvedOrderId,
          rating,
          text,
          authorName: dto.authorName?.trim() || null,
          isPublished: false,
        },
        select: {
          id: true,
          rating: true,
          text: true,
          authorName: true,
          image1Url: true,
          image2Url: true,
          createdAt: true,
          isPublished: true,
          user: { select: { displayName: true } },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Вы уже оставляли отзыв на этот товар');
      }
      throw err;
    }

    return {
      ...publicSerialize(row),
      isPublished: row.isPublished,
    };
  }

  async attachImages(
    reviewId: string,
    userId: string,
    files: { buffer: Buffer; mimetype: string; size: number; originalname?: string }[],
  ) {
    const review = await this.prisma.productReview.findUnique({ where: { id: reviewId } });
    if (!review || review.userId !== userId) {
      throw new NotFoundException('Отзыв не найден');
    }
    if (review.isPublished) {
      throw new BadRequestException('Нельзя изменить фото опубликованного отзыва');
    }
    if (files.length > 2) throw new BadRequestException('Максимум 2 фото');

    const slots: (string | null)[] = [review.image1Url, review.image2Url];
    const toDelete: string[] = [];
    let replaceAt = 0;

    for (const file of files.slice(0, 2)) {
      const { url } = await this.storage.saveImage(file, `reviews/${reviewId}`);
      const emptyIdx = slots.findIndex((s) => !s);
      if (emptyIdx >= 0) {
        slots[emptyIdx] = url;
        continue;
      }
      const old = slots[replaceAt];
      if (old) toDelete.push(old);
      slots[replaceAt] = url;
      replaceAt = (replaceAt + 1) % 2;
    }

    const row = await this.prisma.productReview.update({
      where: { id: reviewId },
      data: {
        image1Url: slots[0],
        image2Url: slots[1],
      },
      select: {
        id: true,
        rating: true,
        text: true,
        authorName: true,
        image1Url: true,
        image2Url: true,
        createdAt: true,
        isPublished: true,
        user: { select: { displayName: true } },
      },
    });

    const keep = new Set([slots[0], slots[1]].filter((u): u is string => Boolean(u)));
    for (const old of toDelete) {
      if (!keep.has(old)) {
        await this.storage.deleteByPublicUrl(old);
      }
    }

    return {
      ...publicSerialize(row),
      isPublished: row.isPublished,
    };
  }
}
