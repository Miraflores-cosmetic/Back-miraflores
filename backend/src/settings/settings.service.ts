import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type ProductAttributeKind,
} from '@miraflores/admin-types';
import { extractMediaUrlsFromRichHtml } from '../blog/blog-html.util';
import { sanitizeProductRichHtml } from '../catalog/catalog-html.util';
import { sanitizeFaqTextForWrite } from './faq-html.util';
import {
  catalogSellablePrices,
  pickCatalogCardVariant,
} from '../catalog/catalog-price.util';
import { PrismaService } from '../prisma/prisma.service';
import { LocalStorageService } from '../storage/local-storage.service';
import type { ReplaceFaqItemsDto } from './dto/faq.dto';
import type { ReplaceGratitudeDto } from './dto/gratitude.dto';
import type { ReplaceHeroSlidesDto } from './dto/hero.dto';
import type { ReplaceHomepageSetsDto } from './dto/homepage-sets.dto';
import type { ReplaceProductAttributeOptionsDto } from './dto/product-attributes.dto';
import type { ReplaceQuizContentDto } from './dto/quiz-content.dto';
import type { UpdateCartSettingsDto } from './dto/cart.dto';
import type { UpdateMenuSettingsDto } from './dto/menu.dto';
import type { UpdateSiteSeoSettingsDto } from './dto/site-seo.dto';
import {
  QUIZ_ALL_CONTENT_KEYS,
  QUIZ_ALL_TEXT_FALLBACKS,
  QUIZ_MEDIA_KEYS,
} from './quiz-content.constants';

function serializeFaq(row: {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeProductAttributeOption(row: {
  id: string;
  kind: string;
  label: string;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  usageCount?: number;
}) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    sortOrder: row.sortOrder,
    active: row.active,
    usageCount: row.usageCount ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Kind → Product denorm label field + FK. Keys = PRODUCT_ATTRIBUTE_KINDS. */
const PRODUCT_ATTR_KIND_META: Record<
  ProductAttributeKind,
  { labelField: string; optionIdField: string }
> = {
  productType: {
    labelField: 'productType',
    optionIdField: 'productTypeOptionId',
  },
  purpose: {
    labelField: 'purpose',
    optionIdField: 'purposeOptionId',
  },
  shelfLife: {
    labelField: 'shelfLife',
    optionIdField: 'shelfLifeOptionId',
  },
  storage: {
    labelField: 'storageHtml',
    optionIdField: 'storageOptionId',
  },
};

async function readAttributeCatalogVersion(
  db: PrismaService | Prisma.TransactionClient,
): Promise<number> {
  const row = await db.productAttributeCatalog.findUnique({
    where: { id: 'default' },
    select: { version: true },
  });
  return row?.version ?? 0;
}

function serializeHero(row: {
  id: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    mobileImageUrl: row.mobileImageUrl,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const homepageSetProductSelect = {
  id: true,
  slug: true,
  name: true,
  productType: true,
  shortDescription: true,
  images: {
    take: 8,
    orderBy: { sortOrder: 'asc' as const },
    select: { url: true, mediaType: true },
  },
  variants: {
    where: { active: true },
    orderBy: [{ price: 'asc' as const }, { createdAt: 'asc' as const }],
    select: {
      id: true,
      name: true,
      price: true,
      compareAt: true,
      orderMinQty: true,
      orderMaxQty: true,
      stock: true,
      stockReserve: true,
      shades: {
        orderBy: { sortOrder: 'asc' as const },
        take: 1,
        select: { id: true, name: true, imageUrl: true },
      },
    },
  },
};

type HomepageSetProductSource = {
  id: string;
  slug: string;
  name: string;
  productType: string | null;
  shortDescription: string | null;
  images: Array<{ url: string; mediaType?: string }>;
  variants: Array<{
    id: string;
    name: string;
    price: number;
    compareAt: number | null;
    orderMinQty: number;
    orderMaxQty: number | null;
    stock: number;
    stockReserve: number;
    shades: Array<{ id: string; name: string; imageUrl: string | null }>;
  }>;
};

function toHomepageSetProductCard(p: HomepageSetProductSource) {
  const variants = p.variants ?? [];
  const prices = catalogSellablePrices(variants);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const v = pickCatalogCardVariant(variants);
  const price = v?.price ?? minPrice;
  const compareAt = v?.compareAt ?? null;
  const discountPercent =
    compareAt != null && compareAt > price
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : null;
  const available = v ? Math.max(0, v.stock - v.stockReserve) : 0;
  const minQty = Math.max(1, v?.orderMinQty ?? 1);
  let maxQty =
    v == null
      ? 0
      : v.orderMaxQty != null
        ? Math.min(v.orderMaxQty, available)
        : available;
  if (maxQty > 0 && minQty > maxQty) maxQty = 0;
  const shade = v?.shades?.[0] ?? null;
  const imageUrls = p.images.map((img) => img.url).filter(Boolean);
  const cover = p.images[0];
  const productType = p.productType?.trim() || null;
  return {
    id: p.id,
    variantId: v?.id ?? null,
    variantName: v?.name ?? null,
    shadeId: shade?.id ?? null,
    shadeName: shade?.name ?? null,
    slug: p.slug,
    name: p.name,
    productType,
    shortDescription: p.shortDescription,
    price,
    oldPrice: compareAt != null && compareAt > price ? compareAt : null,
    discountPercent,
    priceFrom: maxPrice > minPrice,
    available,
    minQty,
    maxQty,
    coverImageUrl: cover?.url || shade?.imageUrl || null,
    imageUrl: cover?.url || shade?.imageUrl || null,
    imageUrls,
    mediaType: cover?.mediaType === 'video' ? ('video' as const) : ('image' as const),
  };
}

function serializeHomepageSetAdmin(row: {
  id: string;
  imageUrl: string;
  productId: string;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  product: { id: string; name: string; slug: string };
}) {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    productId: row.productId,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    product: row.product,
  };
}

function serializeCart(row: {
  id: string;
  freeShippingThresholdRub: number;
  progressContentText: string;
  progressSuccessText: string;
  legalHtml: string;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    freeShippingThresholdRub: row.freeShippingThresholdRub,
    progressContentText: row.progressContentText,
    progressSuccessText: row.progressSuccessText,
    legalHtml: row.legalHtml,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t || null;
}

const CART_DEFAULTS = {
  id: 'default',
  freeShippingThresholdRub: 10000,
  progressContentText: 'до бесплатной доставки до ПВЗ',
  progressSuccessText: 'Бесплатная доставка до ПВЗ!',
  legalHtml: '<p></p>',
} as const;

const SITE_SEO_DEFAULTS = {
  titleSuffix: 'Miraflores',
} as const;

function serializeSiteSeo(row: {
  id: string;
  siteUrl: string | null;
  titleSuffix: string;
  defaultMetaDescription: string | null;
  defaultOgImageUrl: string | null;
  homeMetaTitle: string | null;
  homeMetaDescription: string | null;
  homeOgImageUrl: string | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    siteUrl: row.siteUrl,
    titleSuffix: row.titleSuffix,
    defaultMetaDescription: row.defaultMetaDescription,
    defaultOgImageUrl: row.defaultOgImageUrl,
    homeMetaTitle: row.homeMetaTitle,
    homeMetaDescription: row.homeMetaDescription,
    homeOgImageUrl: row.homeOgImageUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function emptySiteSeoResponse() {
  return {
    id: 'default',
    siteUrl: null as string | null,
    titleSuffix: SITE_SEO_DEFAULTS.titleSuffix,
    defaultMetaDescription: null as string | null,
    defaultOgImageUrl: null as string | null,
    homeMetaTitle: null as string | null,
    homeMetaDescription: null as string | null,
    homeOgImageUrl: null as string | null,
    updatedAt: null as string | null,
  };
}

function normalizeSiteUrl(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  if (!t) return null;
  return t.replace(/\/+$/, '');
}

@Injectable()
export class SettingsAdminService {
  private readonly logger = new Logger(SettingsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
  ) {}

  async listFaq() {
    const rows = await this.prisma.faqItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(serializeFaq) };
  }

  /**
   * Синхронизация списка FAQ: update существующих id, create новых,
   * delete отсутствующих. Id сохраняются, если клиент их передаёт.
   */
  async replaceFaq(dto: ReplaceFaqItemsDto) {
    const cleaned = (dto.items ?? [])
      .map((it) => ({
        id: typeof it.id === 'string' && it.id.trim() ? it.id.trim() : undefined,
        question: sanitizeFaqTextForWrite(it.question),
        answer: sanitizeFaqTextForWrite(it.answer),
        active: it.active ?? true,
      }))
      .filter((it) => it.question && it.answer);

    const rows = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.faqItem.findMany({ select: { id: true } });
      const existingIds = new Set(existing.map((r) => r.id));

      const keepIds = new Set(
        cleaned
          .map((it) => it.id)
          .filter((id): id is string => Boolean(id && existingIds.has(id))),
      );

      const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await tx.faqItem.deleteMany({ where: { id: { in: toDelete } } });
      }

      const out = [];
      for (let i = 0; i < cleaned.length; i++) {
        const it = cleaned[i]!;
        const data = {
          question: it.question,
          answer: it.answer,
          active: it.active,
          sortOrder: i,
        };
        if (it.id && existingIds.has(it.id)) {
          out.push(await tx.faqItem.update({ where: { id: it.id }, data }));
        } else {
          out.push(await tx.faqItem.create({ data }));
        }
      }
      return out;
    });

    return { items: rows.map(serializeFaq) };
  }

  async listProductAttributes() {
    const rows = await this.prisma.productAttributeOption.findMany({
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const [byType, byPurpose, byShelf, byStorage, version] = await Promise.all([
      this.prisma.product.groupBy({
        by: ['productTypeOptionId'],
        where: { productTypeOptionId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.product.groupBy({
        by: ['purposeOptionId'],
        where: { purposeOptionId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.product.groupBy({
        by: ['shelfLifeOptionId'],
        where: { shelfLifeOptionId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.product.groupBy({
        by: ['storageOptionId'],
        where: { storageOptionId: { not: null } },
        _count: { _all: true },
      }),
      readAttributeCatalogVersion(this.prisma),
    ]);

    const usageByOptionId = new Map<string, number>();
    for (const r of byType) {
      if (r.productTypeOptionId) usageByOptionId.set(r.productTypeOptionId, r._count._all);
    }
    for (const r of byPurpose) {
      if (r.purposeOptionId) usageByOptionId.set(r.purposeOptionId, r._count._all);
    }
    for (const r of byShelf) {
      if (r.shelfLifeOptionId) usageByOptionId.set(r.shelfLifeOptionId, r._count._all);
    }
    for (const r of byStorage) {
      if (r.storageOptionId) usageByOptionId.set(r.storageOptionId, r._count._all);
    }

    return {
      revision: version,
      items: rows.map((row) =>
        serializeProductAttributeOption({
          ...row,
          usageCount: usageByOptionId.get(row.id) ?? 0,
        }),
      ),
    };
  }

  /**
   * Синхронизация опций атрибутов товара: update существующих id, create новых,
   * delete отсутствующих. Rename каскадом обновляет Product.* по FK; delete блокируется при usage > 0.
   * Пустой payload без allowEmpty отклоняется (защита от wipe).
   * expectedRevision обязателен при непустом каталоге — optimistic concurrency (иначе 409).
   */
  async replaceProductAttributes(dto: ReplaceProductAttributeOptionsDto) {
    const cleaned = (dto.items ?? [])
      .map((it) => ({
        id: typeof it.id === 'string' && it.id.trim() ? it.id.trim() : undefined,
        kind: it.kind as ProductAttributeKind,
        label: (it.label ?? '').trim(),
        active: it.active ?? true,
      }))
      .filter((it) => it.label && it.kind in PRODUCT_ATTR_KIND_META);

    const dupKey = new Set<string>();
    for (const it of cleaned) {
      const key = `${it.kind}\0${it.label.toLowerCase()}`;
      if (dupKey.has(key)) {
        throw new BadRequestException(
          `Дубликат значения «${it.label}» в «${it.kind}» — оставьте одно`,
        );
      }
      dupKey.add(key);
    }

    const existingBefore = await this.prisma.productAttributeOption.findMany({
      select: { id: true },
    });

    if (cleaned.length === 0 && existingBefore.length > 0 && !dto.allowEmpty) {
      throw new BadRequestException(
        'Пустой список не сохраняется — так можно стереть все опции. ' +
          'Удалите ненужные по одной или подтвердите очистку (allowEmpty).',
      );
    }

    const kindCounters: Record<string, number> = {};

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productAttributeCatalog.upsert({
          where: { id: 'default' },
          create: { id: 'default', version: 0 },
          update: {},
        });
        const current = await tx.productAttributeCatalog.findUniqueOrThrow({
          where: { id: 'default' },
          select: { version: true },
        });

        if (
          existingBefore.length > 0 &&
          (dto.expectedRevision === undefined || dto.expectedRevision === null)
        ) {
          throw new BadRequestException(
            'Укажите expectedRevision (версия с последнего GET) — защита от параллельных правок',
          );
        }
        if (
          dto.expectedRevision !== undefined &&
          dto.expectedRevision !== null &&
          dto.expectedRevision !== current.version
        ) {
          throw new ConflictException(
            `Каталог атрибутов уже изменён (revision ${current.version}). Обновите страницу и повторите.`,
          );
        }

        const bumped = await tx.productAttributeCatalog.updateMany({
          where: { id: 'default', version: current.version },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1) {
          throw new ConflictException(
            'Каталог атрибутов уже изменён. Обновите страницу и повторите.',
          );
        }

        const existing = await tx.productAttributeOption.findMany();
        const existingById = new Map(existing.map((r) => [r.id, r]));
        const existingIds = new Set(existing.map((r) => r.id));

        const staleIds = cleaned
          .map((it) => it.id)
          .filter((id): id is string => Boolean(id) && !existingIds.has(id!));
        if (staleIds.length > 0) {
          throw new BadRequestException(
            `Неизвестные id опций (${staleIds.length}): обновите страницу и повторите. ` +
              `Новые значения добавляйте без id.`,
          );
        }

        const keepIds = new Set(
          cleaned
            .map((it) => it.id)
            .filter((id): id is string => Boolean(id && existingIds.has(id))),
        );

        // Rename cascade by FK before deletes
        for (const it of cleaned) {
          if (!it.id || !existingById.has(it.id)) continue;
          const prev = existingById.get(it.id)!;
          if (prev.label === it.label) continue;
          const meta = PRODUCT_ATTR_KIND_META[prev.kind as ProductAttributeKind];
          if (!meta) continue;
          await tx.product.updateMany({
            where: { [meta.optionIdField]: it.id },
            data: { [meta.labelField]: it.label },
          });
        }

        const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
        if (toDelete.length > 0) {
          const blocked: string[] = [];
          for (const id of toDelete) {
            const prev = existingById.get(id)!;
            const meta = PRODUCT_ATTR_KIND_META[prev.kind as ProductAttributeKind];
            if (!meta) continue;
            const count = await tx.product.count({
              where: { [meta.optionIdField]: id },
            });
            if (count > 0) {
              blocked.push(`«${prev.label}» (${count})`);
            }
          }
          if (blocked.length > 0) {
            throw new BadRequestException(
              `Нельзя удалить опции, которые стоят на товарах: ${blocked.join(', ')}. ` +
                `Переименуйте значение или снимите его с товаров.`,
            );
          }
          await tx.productAttributeOption.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const it of cleaned) {
          const sortOrder = kindCounters[it.kind] ?? 0;
          kindCounters[it.kind] = sortOrder + 1;
          const data = {
            kind: it.kind,
            label: it.label,
            active: it.active,
            sortOrder,
          };
          if (it.id) {
            await tx.productAttributeOption.update({ where: { id: it.id }, data });
          } else {
            await tx.productAttributeOption.create({ data });
          }
        }
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Такое значение уже есть в этом списке (без учёта регистра) — дубликаты не допускаются',
        );
      }
      throw e;
    }

    return this.listProductAttributes();
  }

  async listHero() {
    const rows = await this.prisma.heroSlide.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(serializeHero) };
  }

  async replaceHero(dto: ReplaceHeroSlidesDto) {
    const cleaned = (dto.items ?? []).map((it) => ({
      id: typeof it.id === 'string' && it.id.trim() ? it.id.trim() : undefined,
      imageUrl: it.imageUrl.trim(),
      mobileImageUrl: trimOrNull(it.mobileImageUrl ?? null),
      active: it.active ?? true,
    }));
    const incomplete = cleaned.filter((it) => !it.imageUrl);
    if (incomplete.length > 0) {
      throw new BadRequestException(
        incomplete.length === 1
          ? 'У слайда нет картинки'
          : `Есть слайды без картинки (${incomplete.length})`,
      );
    }

    const rows = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.heroSlide.findMany({ select: { id: true } });
      const existingIds = new Set(existing.map((r) => r.id));

      const keepIds = new Set(
        cleaned
          .map((it) => it.id)
          .filter((id): id is string => Boolean(id && existingIds.has(id))),
      );

      const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await tx.heroSlide.deleteMany({ where: { id: { in: toDelete } } });
      }

      const out = [];
      for (let i = 0; i < cleaned.length; i++) {
        const it = cleaned[i]!;
        const data = {
          imageUrl: it.imageUrl,
          mobileImageUrl: it.mobileImageUrl,
          active: it.active,
          sortOrder: i,
        };
        if (it.id && existingIds.has(it.id)) {
          out.push(await tx.heroSlide.update({ where: { id: it.id }, data }));
        } else {
          out.push(await tx.heroSlide.create({ data }));
        }
      }
      return out;
    });

    return { items: rows.map(serializeHero) };
  }

  async listHomepageSets() {
    const rows = await this.prisma.homepageSet.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        product: { select: { id: true, name: true, slug: true } },
      },
    });
    return { items: rows.map(serializeHomepageSetAdmin) };
  }

  /**
   * Синхронизация наборов главной: update существующих id, create новых,
   * delete отсутствующих. Id сохраняются, если клиент их передаёт.
   * Один productId — не больше одного набора.
   */
  async replaceHomepageSets(dto: ReplaceHomepageSetsDto) {
    const cleaned = (dto.items ?? []).map((it) => ({
      id: typeof it.id === 'string' && it.id.trim() ? it.id.trim() : undefined,
      imageUrl: it.imageUrl.trim(),
      productId: it.productId.trim(),
      active: it.active ?? true,
    }));
    const incomplete = cleaned.filter((it) => !it.imageUrl || !it.productId);
    if (incomplete.length > 0) {
      throw new BadRequestException(
        incomplete.length === 1
          ? 'Добавьте картинку и товар или удалите пустую строку'
          : `Есть неполные наборы (${incomplete.length})`,
      );
    }

    const productIds = cleaned.map((it) => it.productId);
    const uniqueProductIds = [...new Set(productIds)];
    if (uniqueProductIds.length !== productIds.length) {
      throw new BadRequestException('Один товар нельзя указать в двух наборах');
    }

    if (uniqueProductIds.length > 0) {
      const found = await this.prisma.product.findMany({
        where: { id: { in: uniqueProductIds } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((p) => p.id));
      const missing = uniqueProductIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          missing.length === 1 ? 'Товар не найден' : 'Один или несколько товаров не найдены',
        );
      }
    }

    const rows = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.homepageSet.findMany({ select: { id: true } });
      const existingIds = new Set(existing.map((r) => r.id));

      const keepIds = new Set(
        cleaned
          .map((it) => it.id)
          .filter((id): id is string => Boolean(id && existingIds.has(id))),
      );

      const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await tx.homepageSet.deleteMany({ where: { id: { in: toDelete } } });
      }

      const productInclude = {
        product: { select: { id: true, name: true, slug: true } },
      } as const;

      const out = [];
      for (let i = 0; i < cleaned.length; i++) {
        const it = cleaned[i]!;
        const data = {
          imageUrl: it.imageUrl,
          productId: it.productId,
          active: it.active,
          sortOrder: i,
        };
        if (it.id && existingIds.has(it.id)) {
          out.push(
            await tx.homepageSet.update({
              where: { id: it.id },
              data,
              include: productInclude,
            }),
          );
        } else {
          out.push(
            await tx.homepageSet.create({
              data,
              include: productInclude,
            }),
          );
        }
      }
      return out;
    });

    return { items: rows.map(serializeHomepageSetAdmin) };
  }

  async getCart() {
    const row = await this.prisma.cartSettings.findUnique({
      where: { id: 'default' },
    });
    if (!row) {
      return {
        id: CART_DEFAULTS.id,
        freeShippingThresholdRub: CART_DEFAULTS.freeShippingThresholdRub,
        progressContentText: CART_DEFAULTS.progressContentText,
        progressSuccessText: CART_DEFAULTS.progressSuccessText,
        legalHtml: CART_DEFAULTS.legalHtml,
        updatedAt: null,
      };
    }
    return serializeCart(row);
  }

  async updateCart(dto: UpdateCartSettingsDto) {
    const prev = await this.prisma.cartSettings.findUnique({
      where: { id: 'default' },
    });
    const legalHtml =
      sanitizeProductRichHtml(dto.legalHtml.trim() || '<p></p>').trim() ||
      '<p></p>';

    const row = await this.prisma.cartSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        freeShippingThresholdRub: dto.freeShippingThresholdRub,
        progressContentText: dto.progressContentText.trim(),
        progressSuccessText: dto.progressSuccessText.trim(),
        legalHtml,
      },
      update: {
        freeShippingThresholdRub: dto.freeShippingThresholdRub,
        progressContentText: dto.progressContentText.trim(),
        progressSuccessText: dto.progressSuccessText.trim(),
        legalHtml,
      },
    });

    if (prev?.legalHtml) {
      const prevUrls = new Set(extractMediaUrlsFromRichHtml(prev.legalHtml));
      const nextUrls = new Set(extractMediaUrlsFromRichHtml(legalHtml));
      const toRemove = [...prevUrls].filter((u) => !nextUrls.has(u));
      if (toRemove.length) {
        void this.discardCartUploads(toRemove).catch((e) =>
          this.logger.warn(
            `cart media cleanup: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    }

    return serializeCart(row);
  }

  async getMenu() {
    const row = await this.prisma.menuSettings.findUnique({
      where: { id: 'default' },
      include: {
        product: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!row) {
      return {
        id: 'default',
        productId: null as string | null,
        annotationText: '',
        product: null as { id: string; name: string; slug: string } | null,
        updatedAt: null as string | null,
      };
    }
    return {
      id: row.id,
      productId: row.productId,
      annotationText: row.annotationText,
      product: row.product,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateMenu(dto: UpdateMenuSettingsDto) {
    const rawId =
      dto.productId === undefined
        ? undefined
        : dto.productId == null || String(dto.productId).trim() === ''
          ? null
          : String(dto.productId).trim();

    if (rawId) {
      const exists = await this.prisma.product.findUnique({
        where: { id: rawId },
        select: { id: true },
      });
      if (!exists) {
        throw new BadRequestException('productId not found');
      }
    }

    const annotationText =
      dto.annotationText !== undefined
        ? String(dto.annotationText).trim()
        : undefined;

    const data: { productId?: string | null; annotationText?: string } = {};
    if (rawId !== undefined) data.productId = rawId;
    if (annotationText !== undefined) data.annotationText = annotationText;

    const row = await this.prisma.menuSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        productId: data.productId ?? null,
        annotationText: data.annotationText ?? '',
      },
      update: data,
      include: {
        product: { select: { id: true, name: true, slug: true } },
      },
    });

    return {
      id: row.id,
      productId: row.productId,
      annotationText: row.annotationText,
      product: row.product,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Удаляет локальные /uploads/… из Quill cart legal, если URL больше
   * не числится в CartSettings и не используется в rich-полях товаров.
   */
  async discardCartUploads(urls: string[]) {
    const candidates = [
      ...new Set(
        (urls ?? [])
          .map((u) => String(u ?? '').trim())
          .filter((u) => Boolean(u) && Boolean(this.storage.tryPublicUrlToKey(u))),
      ),
    ].slice(0, 50);

    if (!candidates.length) return { deleted: 0 };

    const referenced = await this.collectReferencedRichMediaUrls();
    let deleted = 0;
    for (const url of candidates) {
      if (referenced.has(url)) continue;
      try {
        const ok = await this.storage.deleteByPublicUrl(url);
        if (ok) deleted += 1;
      } catch (e) {
        this.logger.warn(
          `discardCartUploads ${url}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { deleted };
  }

  private async collectReferencedRichMediaUrls(): Promise<Set<string>> {
    const out = new Set<string>();
    const cart = await this.prisma.cartSettings.findUnique({
      where: { id: 'default' },
      select: { legalHtml: true },
    });
    for (const u of extractMediaUrlsFromRichHtml(cart?.legalHtml)) out.add(u);

    const cmsPages = await this.prisma.cmsPage.findMany({
      select: { bodyHtml: true },
    });
    for (const p of cmsPages) {
      for (const u of extractMediaUrlsFromRichHtml(p.bodyHtml)) out.add(u);
    }

    const products = await this.prisma.product.findMany({
      select: {
        descriptionHtml: true,
        applicationHtml: true,
        compositionHtml: true,
        storageHtml: true,
        extraHtml: true,
      },
    });
    for (const p of products) {
      for (const html of [
        p.descriptionHtml,
        p.applicationHtml,
        p.compositionHtml,
        p.storageHtml,
        p.extraHtml,
      ]) {
        for (const u of extractMediaUrlsFromRichHtml(html)) out.add(u);
      }
    }
    return out;
  }

  async listQuizContentAdmin() {
    const rows = await this.prisma.quizContentEntry.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const items = QUIZ_ALL_CONTENT_KEYS.map((key) => {
      const row = byKey.get(key);
      const isMedia = (QUIZ_MEDIA_KEYS as readonly string[]).includes(key);
      const fallback = QUIZ_ALL_TEXT_FALLBACKS[key] ?? '';
      return {
        key,
        plain: row?.plain ?? (isMedia ? '' : fallback),
        html: row?.html ?? '',
        mediaUrl: row?.mediaUrl ?? null,
        mediaType: (row?.mediaType as 'image' | 'video' | null) ?? null,
      };
    });
    return { items };
  }

  async replaceQuizContent(dto: ReplaceQuizContentDto) {
    const cleaned = (dto.items ?? [])
      .map((it) => ({
        key: it.key.trim(),
        plain: (it.plain ?? '').trim(),
        html: (it.html ?? '').trim(),
        mediaUrl: trimOrNull(it.mediaUrl ?? null),
        mediaType:
          it.mediaType === 'image' || it.mediaType === 'video' ? it.mediaType : null,
      }))
      .filter((it) => it.key && QUIZ_ALL_CONTENT_KEYS.includes(it.key));

    await this.prisma.$transaction(async (tx) => {
      for (const it of cleaned) {
        await tx.quizContentEntry.upsert({
          where: { key: it.key },
          create: {
            key: it.key,
            plain: it.plain,
            html: it.html,
            mediaUrl: it.mediaUrl,
            mediaType: it.mediaType,
          },
          update: {
            plain: it.plain,
            html: it.html,
            mediaUrl: it.mediaUrl,
            mediaType: it.mediaType,
          },
        });
      }
    });

    return this.listQuizContentAdmin();
  }

  async getGratitudeAdmin() {
    const [rules, settings, tiers] = await Promise.all([
      this.prisma.gratitudeGiftRule.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              sku: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      }),
      this.prisma.gratitudeProgramSettings.findUnique({ where: { id: 'default' } }),
      this.prisma.gratitudeGiftTier.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    return {
      articleSlug: settings?.articleSlug ?? null,
      rules: rules.map((r) => ({
        id: r.id,
        minRub: r.minRub,
        maxRub: r.maxRub,
        variantId: r.variantId,
        active: r.active,
        sortOrder: r.sortOrder,
        variant: r.variant,
      })),
      tiers: tiers.map((t) => ({
        id: t.id,
        sortOrder: t.sortOrder,
        title: t.title,
        infoHtml: t.infoHtml,
        imageUrl: t.imageUrl,
        active: t.active,
      })),
    };
  }

  async replaceGratitude(dto: ReplaceGratitudeDto) {
    const cleanedRules = (dto.rules ?? [])
      .map((r) => ({
        id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : undefined,
        minRub: r.minRub,
        maxRub: r.maxRub ?? null,
        variantId: r.variantId.trim(),
        active: r.active ?? true,
      }))
      .filter((r) => r.variantId);

    for (const r of cleanedRules) {
      if (r.maxRub != null && r.maxRub < r.minRub) {
        throw new BadRequestException('maxRub не может быть меньше minRub');
      }
    }

    const variantIds = [...new Set(cleanedRules.map((r) => r.variantId))];
    if (variantIds.length > 0) {
      const found = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds }, active: true },
        select: { id: true },
      });
      const foundIds = new Set(found.map((v) => v.id));
      const missing = variantIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          missing.length === 1 ? 'Вариант не найден' : 'Один или несколько вариантов не найдены',
        );
      }
    }

    const cleanedTiers = (dto.tiers ?? []).map((t) => ({
      id: typeof t.id === 'string' && t.id.trim() ? t.id.trim() : undefined,
      title: (t.title ?? '').trim(),
      infoHtml: (t.infoHtml ?? '').trim(),
      imageUrl: trimOrNull(t.imageUrl ?? null),
      active: t.active ?? true,
    }));

    await this.prisma.$transaction(async (tx) => {
      const existingRules = await tx.gratitudeGiftRule.findMany({ select: { id: true } });
      const existingRuleIds = new Set(existingRules.map((r) => r.id));
      const keepRuleIds = new Set(
        cleanedRules
          .map((r) => r.id)
          .filter((id): id is string => Boolean(id && existingRuleIds.has(id))),
      );
      const deleteRuleIds = [...existingRuleIds].filter((id) => !keepRuleIds.has(id));
      if (deleteRuleIds.length > 0) {
        await tx.gratitudeGiftRule.deleteMany({ where: { id: { in: deleteRuleIds } } });
      }

      for (let i = 0; i < cleanedRules.length; i++) {
        const r = cleanedRules[i]!;
        const data = {
          minRub: r.minRub,
          maxRub: r.maxRub,
          variantId: r.variantId,
          active: r.active,
          sortOrder: i,
        };
        if (r.id && existingRuleIds.has(r.id)) {
          await tx.gratitudeGiftRule.update({ where: { id: r.id }, data });
        } else {
          await tx.gratitudeGiftRule.create({ data });
        }
      }

      if (variantIds.length > 0) {
        await tx.product.updateMany({
          where: {
            variants: { some: { id: { in: variantIds } } },
          },
          data: { excludeFromCatalog: true },
        });
      }

      await tx.gratitudeProgramSettings.upsert({
        where: { id: 'default' },
        create: {
          id: 'default',
          articleSlug: trimOrNull(dto.articleSlug ?? null),
        },
        update: {
          articleSlug: trimOrNull(dto.articleSlug ?? null),
        },
      });

      if (dto.tiers !== undefined) {
        const existingTiers = await tx.gratitudeGiftTier.findMany({ select: { id: true } });
        const existingTierIds = new Set(existingTiers.map((t) => t.id));
        const keepTierIds = new Set(
          cleanedTiers
            .map((t) => t.id)
            .filter((id): id is string => Boolean(id && existingTierIds.has(id))),
        );
        const deleteTierIds = [...existingTierIds].filter((id) => !keepTierIds.has(id));
        if (deleteTierIds.length > 0) {
          await tx.gratitudeGiftTier.deleteMany({ where: { id: { in: deleteTierIds } } });
        }

        for (let i = 0; i < cleanedTiers.length; i++) {
          const t = cleanedTiers[i]!;
          const data = {
            title: t.title,
            infoHtml: t.infoHtml,
            imageUrl: t.imageUrl,
            active: t.active,
            sortOrder: i,
          };
          if (t.id && existingTierIds.has(t.id)) {
            await tx.gratitudeGiftTier.update({ where: { id: t.id }, data });
          } else {
            await tx.gratitudeGiftTier.create({ data });
          }
        }
      }
    });

    return this.getGratitudeAdmin();
  }

  async getSiteSeo() {
    const row = await this.prisma.siteSettings.findUnique({
      where: { id: 'default' },
    });
    if (!row) return emptySiteSeoResponse();
    return serializeSiteSeo(row);
  }

  async updateSiteSeo(dto: UpdateSiteSeoSettingsDto) {
    const row = await this.prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        siteUrl: normalizeSiteUrl(dto.siteUrl),
        titleSuffix: dto.titleSuffix?.trim() || SITE_SEO_DEFAULTS.titleSuffix,
        defaultMetaDescription: trimOrNull(dto.defaultMetaDescription),
        defaultOgImageUrl: trimOrNull(dto.defaultOgImageUrl),
        homeMetaTitle: trimOrNull(dto.homeMetaTitle),
        homeMetaDescription: trimOrNull(dto.homeMetaDescription),
        homeOgImageUrl: trimOrNull(dto.homeOgImageUrl),
      },
      update: {
        ...(dto.siteUrl !== undefined
          ? { siteUrl: normalizeSiteUrl(dto.siteUrl) }
          : {}),
        ...(dto.titleSuffix !== undefined
          ? { titleSuffix: dto.titleSuffix.trim() || SITE_SEO_DEFAULTS.titleSuffix }
          : {}),
        ...(dto.defaultMetaDescription !== undefined
          ? { defaultMetaDescription: trimOrNull(dto.defaultMetaDescription) }
          : {}),
        ...(dto.defaultOgImageUrl !== undefined
          ? { defaultOgImageUrl: trimOrNull(dto.defaultOgImageUrl) }
          : {}),
        ...(dto.homeMetaTitle !== undefined
          ? { homeMetaTitle: trimOrNull(dto.homeMetaTitle) }
          : {}),
        ...(dto.homeMetaDescription !== undefined
          ? { homeMetaDescription: trimOrNull(dto.homeMetaDescription) }
          : {}),
        ...(dto.homeOgImageUrl !== undefined
          ? { homeOgImageUrl: trimOrNull(dto.homeOgImageUrl) }
          : {}),
      },
    });
    return serializeSiteSeo(row);
  }
}

@Injectable()
export class SettingsPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async getSiteSeo() {
    const row = await this.prisma.siteSettings.findUnique({
      where: { id: 'default' },
    });
    if (!row) return emptySiteSeoResponse();
    return serializeSiteSeo(row);
  }

  async listFaq() {
    const rows = await this.prisma.faqItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        question: true,
        answer: true,
      },
    });
    return { items: rows };
  }

  async listHero() {
    const rows = await this.prisma.heroSlide.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        imageUrl: true,
        mobileImageUrl: true,
      },
    });
    return { items: rows };
  }

  async listHomepageSets() {
    const rows = await this.prisma.homepageSet.findMany({
      where: { active: true, product: { active: true, excludeFromCatalog: false } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        product: { select: homepageSetProductSelect },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        imageUrl: row.imageUrl,
        slug: row.product.slug,
        name: row.product.name,
        product: toHomepageSetProductCard(row.product),
      })),
    };
  }

  /** Landing «Программа благодарности»: tiers + articleSlug из админки. */
  async getGratitude() {
    const [settings, tiers] = await Promise.all([
      this.prisma.gratitudeProgramSettings.findUnique({ where: { id: 'default' } }),
      this.prisma.gratitudeGiftTier.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          sortOrder: true,
          title: true,
          infoHtml: true,
          imageUrl: true,
        },
      }),
    ]);
    return {
      articleSlug: settings?.articleSlug?.trim() || null,
      tiers: tiers.map((t) => ({
        id: t.id,
        sortOrder: t.sortOrder,
        title: t.title,
        infoHtml: sanitizeProductRichHtml(t.infoHtml),
        imageUrl: t.imageUrl,
      })),
    };
  }

  async getCart() {
    const row = await this.prisma.cartSettings.findUnique({
      where: { id: 'default' },
    });
    if (!row) {
      return {
        freeShippingThresholdRub: CART_DEFAULTS.freeShippingThresholdRub,
        progressContentText: CART_DEFAULTS.progressContentText,
        progressSuccessText: CART_DEFAULTS.progressSuccessText,
        legalHtml: CART_DEFAULTS.legalHtml,
      };
    }
    return {
      freeShippingThresholdRub: row.freeShippingThresholdRub,
      progressContentText: row.progressContentText,
      progressSuccessText: row.progressSuccessText,
      legalHtml: sanitizeProductRichHtml(row.legalHtml),
    };
  }

  async getMenu() {
    const row = await this.prisma.menuSettings.findUnique({
      where: { id: 'default' },
    });
    const annotationText = row?.annotationText?.trim() || '';
    if (!row?.productId) {
      return { annotationText, product: null };
    }

    const productRow = await this.prisma.product.findFirst({
      where: { id: row.productId, active: true, excludeFromCatalog: false },
      select: homepageSetProductSelect,
    });
    if (!productRow) {
      return { annotationText, product: null };
    }

    const card = toHomepageSetProductCard(productRow);
    return {
      annotationText,
      product: {
        id: card.id,
        variantId: card.variantId,
        slug: card.slug,
        name: card.name,
        productType: card.productType,
        shortDescription: card.shortDescription,
        price: card.price,
        oldPrice: card.oldPrice,
        discountPercent: card.discountPercent,
        imageUrl: card.imageUrl,
        imageUrls: card.imageUrls,
      },
    };
  }

  async getQuizContentPublic() {
    const rows = await this.prisma.quizContentEntry.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const content: Record<
      string,
      { plain: string; html: string; mediaUrl: string | null; mediaType: string | null }
    > = {};

    for (const key of QUIZ_ALL_CONTENT_KEYS) {
      const row = byKey.get(key);
      const isMedia = (QUIZ_MEDIA_KEYS as readonly string[]).includes(key);
      const fallback = QUIZ_ALL_TEXT_FALLBACKS[key] ?? '';
      content[key] = {
        plain: row?.plain ?? (isMedia ? '' : fallback),
        html: row?.html ?? '',
        mediaUrl: row?.mediaUrl ?? null,
        mediaType: row?.mediaType ?? null,
      };
    }

    return { content };
  }

  async getApplicableGift(subtotal: number) {
    const subtotalInt = Math.round(subtotal);
    if (subtotalInt <= 0) {
      return { applicable: false };
    }

    const rules = await this.prisma.gratitudeGiftRule.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { minRub: 'desc' }],
      include: {
        variant: {
          select: {
            id: true,
            name: true,
            active: true,
            stock: true,
            stockReserve: true,
            product: {
              select: {
                id: true,
                name: true,
                active: true,
                images: {
                  take: 1,
                  orderBy: { sortOrder: 'asc' },
                  select: { url: true },
                },
              },
            },
          },
        },
      },
    });

    const matching = rules.filter((rule) => {
      if (!rule.variant.active || !rule.variant.product.active) return false;
      if (subtotalInt < rule.minRub) return false;
      if (rule.maxRub != null && subtotalInt > rule.maxRub) return false;
      const available = Math.max(0, rule.variant.stock - rule.variant.stockReserve);
      if (available < 1) return false;
      return true;
    });

    if (matching.length === 0) {
      return { applicable: false };
    }

    matching.sort((a, b) => b.minRub - a.minRub);
    const rule = matching[0]!;
    const variant = rule.variant;
    const product = variant.product;
    const thumbnailUrl = product.images[0]?.url ?? null;

    return {
      applicable: true,
      variantId: variant.id,
      productName: product.name,
      thumbnailUrl,
      quantity: 1,
    };
  }
}
