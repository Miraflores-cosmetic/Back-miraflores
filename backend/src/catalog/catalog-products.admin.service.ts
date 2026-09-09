import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProductAttributeKind } from '@miraflores/admin-types';
import { PrismaService } from '../prisma/prisma.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { ADMIN_LIST_DEFAULT_LIMIT, ADMIN_LIST_MAX_LIMIT } from './catalog.constants';
import { dedupeIdsPreserveOrder, normalizeCanonicalPath, trimOrNull } from './catalog-admin.helpers';
import { CatalogCategoriesAdminService } from './catalog-categories.admin.service';
import {
  productInclude,
  productListInclude,
  serializeProduct,
  serializeProductListItem,
  serializeVariant,
  variantInclude,
} from './catalog-admin.serializers';
import { sanitizeRichHtmlOrNull } from './catalog-html.util';
import { slugify, volumeSlugPart } from './slug.util';
import type {
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantInputDto,
} from './dto/catalog-admin.dto';

const PRODUCT_ATTR_LINKS: Array<{
  kind: ProductAttributeKind;
  optionKey:
    | 'productTypeOptionId'
    | 'purposeOptionId'
    | 'shelfLifeOptionId'
    | 'storageOptionId';
  labelKey: 'productType' | 'purpose' | 'shelfLife' | 'storageHtml';
}> = [
  {
    kind: 'productType',
    optionKey: 'productTypeOptionId',
    labelKey: 'productType',
  },
  {
    kind: 'purpose',
    optionKey: 'purposeOptionId',
    labelKey: 'purpose',
  },
  {
    kind: 'shelfLife',
    optionKey: 'shelfLifeOptionId',
    labelKey: 'shelfLife',
  },
  {
    kind: 'storage',
    optionKey: 'storageOptionId',
    labelKey: 'storageHtml',
  },
];

type ProductAttrLinkFields = {
  productType?: string | null;
  purpose?: string | null;
  shelfLife?: string | null;
  storageHtml?: string | null;
  productTypeOptionId?: string | null;
  purposeOptionId?: string | null;
  shelfLifeOptionId?: string | null;
  storageOptionId?: string | null;
};

@Injectable()
export class CatalogProductsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly categories: CatalogCategoriesAdminService,
  ) {}

  /**
   * Связывает Product с ProductAttributeOption (FK) и синхронизирует denormalized labels.
   * Prefer optionId; иначе ищем опцию по label. Orphan label без опции — label есть, FK null.
   */
  private async resolveProductAttrLinks(
    tx: Prisma.TransactionClient,
    dto: ProductAttrLinkFields,
    patch: boolean,
  ): Promise<ProductAttrLinkFields> {
    const out: ProductAttrLinkFields = {};
    for (const { kind, optionKey, labelKey } of PRODUCT_ATTR_LINKS) {
      const hasOption = Object.prototype.hasOwnProperty.call(dto, optionKey);
      const hasLabel = Object.prototype.hasOwnProperty.call(dto, labelKey);
      if (patch && !hasOption && !hasLabel) continue;

      if (hasOption) {
        const rawId = dto[optionKey];
        if (rawId == null || String(rawId).trim() === '') {
          out[optionKey] = null;
          out[labelKey] = null;
          continue;
        }
        const opt = await tx.productAttributeOption.findFirst({
          where: { id: String(rawId).trim(), kind },
          select: { id: true, label: true },
        });
        if (!opt) {
          throw new BadRequestException(
            `Неизвестная опция атрибута «${kind}»`,
          );
        }
        out[optionKey] = opt.id;
        out[labelKey] = opt.label;
        continue;
      }

      const label = trimOrNull(dto[labelKey]);
      if (!label) {
        out[optionKey] = null;
        out[labelKey] = null;
        continue;
      }
      const opt = await tx.productAttributeOption.findFirst({
        where: { kind, label: { equals: label, mode: 'insensitive' } },
        select: { id: true, label: true },
      });
      out[labelKey] = opt?.label ?? label;
      out[optionKey] = opt?.id ?? null;
    }
    return out;
  }

  // --- Products ---

  async listProducts(opts: {
    q?: string;
    page?: number;
    limit?: number;
    visibility?: 'all' | 'catalog' | 'hidden' | 'excluded';
    categoryId?: string;
    collectionId?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, opts.limit ?? ADMIN_LIST_DEFAULT_LIMIT));
    const where: Prisma.ProductWhereInput = {};
    if (opts.visibility === 'catalog') {
      where.active = true;
      where.excludeFromCatalog = false;
    }
    if (opts.visibility === 'hidden') where.active = false;
    if (opts.visibility === 'excluded') where.excludeFromCatalog = true;
    const categoryId = opts.categoryId?.trim();
    if (categoryId) where.categoryId = categoryId;
    const collectionId = opts.collectionId?.trim();
    if (collectionId) {
      where.collectionItems = { some: { collectionId } };
    }
    const q = opts.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productListInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: items.map((p) => serializeProductListItem(p)),
      total,
      page,
      limit,
    };
  }

  async getProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return serializeProduct(product);
  }

  /** Лёгкий контекст для формы варианта: имя/slug/галерея без HTML и всех вариантов. */
  async getProductVariantFormContext(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        slug: true,
        images: { orderBy: { sortOrder: 'asc' as const } },
      },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      images: product.images.map((img) => ({
        id: img.id,
        url: img.url,
        sortOrder: img.sortOrder,
        mediaType: img.mediaType === 'video' ? ('video' as const) : ('image' as const),
      })),
    };
  }

  async getVariant(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        ...variantInclude,
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: { orderBy: { sortOrder: 'asc' as const } },
          },
        },
      },
    });
    if (!variant) throw new NotFoundException('Вариант не найден');
    const { product, ...v } = variant;
    return {
      variant: serializeVariant(
        v as Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>,
      ),
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        images: product.images.map((img) => ({
          id: img.id,
          url: img.url,
          sortOrder: img.sortOrder,
          mediaType: img.mediaType === 'video' ? ('video' as const) : ('image' as const),
        })),
      },
    };
  }

  async createProduct(dto: CreateProductDto) {
    await this.categories.requireCategory(dto.categoryId);

    const baseSlug = await this.uniqueProductSlug(
      dto.slug?.trim() ? slugify(dto.slug) : slugify(dto.name),
    );

    return this.prisma.$transaction(async (tx) => {
      const attrs = await this.resolveProductAttrLinks(tx, dto, false);
      const product = await tx.product.create({
        data: {
          name: dto.name.trim(),
          slug: baseSlug,
          shortDescription: trimOrNull(dto.shortDescription),
          pageShortDescriptionHtml: sanitizeRichHtmlOrNull(dto.pageShortDescriptionHtml),
          descriptionHtml: sanitizeRichHtmlOrNull(dto.descriptionHtml),
          actionEffectHtml: sanitizeRichHtmlOrNull(dto.actionEffectHtml),
          applicationHtml: sanitizeRichHtmlOrNull(dto.applicationHtml),
          compositionHtml: sanitizeRichHtmlOrNull(dto.compositionHtml),
          importantNoteHtml: sanitizeRichHtmlOrNull(dto.importantNoteHtml),
          mirafloresNoteHtml: sanitizeRichHtmlOrNull(dto.mirafloresNoteHtml),
          storageHtml: attrs.storageHtml ?? null,
          productType: attrs.productType ?? null,
          purpose: attrs.purpose ?? null,
          shelfLife: attrs.shelfLife ?? null,
          productTypeOptionId: attrs.productTypeOptionId ?? null,
          purposeOptionId: attrs.purposeOptionId ?? null,
          shelfLifeOptionId: attrs.shelfLifeOptionId ?? null,
          storageOptionId: attrs.storageOptionId ?? null,
          extraHtml: sanitizeRichHtmlOrNull(dto.extraHtml),
          categoryId: dto.categoryId,
          active: dto.active ?? true,
          excludeFromCatalog: dto.excludeFromCatalog ?? false,
          metaTitle: trimOrNull(dto.metaTitle),
          metaDescription: trimOrNull(dto.metaDescription),
          ogImageUrl: trimOrNull(dto.ogImageUrl),
          canonicalPath: normalizeCanonicalPath(dto.canonicalPath),
          seoNoIndex: dto.seoNoIndex ?? false,
        },
      });

      for (const v of dto.variants ?? []) {
        await this.createVariantInTx(tx, product.id, product.slug, v);
      }

      await this.syncProductCatalogTags(tx, product.id, dto.catalogTagIds ?? []);
      await this.syncProductCollections(tx, product.id, dto.collectionIds ?? []);
      await this.syncProductSets(tx, product.id, dto.productSetIds ?? []);

      const full = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: productInclude,
      });
      return serializeProduct(full);
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Товар не найден');
    if (dto.categoryId) await this.categories.requireCategory(dto.categoryId);

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ProductUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const raw = dto.slug.trim();
      if (!raw) {
        throw new BadRequestException('Slug не может быть пустым');
      }
      data.slug = await this.uniqueProductSlug(slugify(raw), id);
    }
      if (dto.shortDescription !== undefined) {
        data.shortDescription = trimOrNull(dto.shortDescription);
      }
      if (dto.pageShortDescriptionHtml !== undefined) {
        data.pageShortDescriptionHtml = sanitizeRichHtmlOrNull(dto.pageShortDescriptionHtml);
      }
      if (dto.descriptionHtml !== undefined) {
        data.descriptionHtml = sanitizeRichHtmlOrNull(dto.descriptionHtml);
      }
      if (dto.actionEffectHtml !== undefined) {
        data.actionEffectHtml = sanitizeRichHtmlOrNull(dto.actionEffectHtml);
      }
      if (dto.applicationHtml !== undefined) {
        data.applicationHtml = sanitizeRichHtmlOrNull(dto.applicationHtml);
      }
      if (dto.compositionHtml !== undefined) {
        data.compositionHtml = sanitizeRichHtmlOrNull(dto.compositionHtml);
      }
      if (dto.importantNoteHtml !== undefined) {
        data.importantNoteHtml = sanitizeRichHtmlOrNull(dto.importantNoteHtml);
      }
      if (dto.mirafloresNoteHtml !== undefined) {
        data.mirafloresNoteHtml = sanitizeRichHtmlOrNull(dto.mirafloresNoteHtml);
      }
      const attrs = await this.resolveProductAttrLinks(tx, dto, true);
      if (attrs.storageHtml !== undefined) data.storageHtml = attrs.storageHtml;
      if (attrs.productType !== undefined) data.productType = attrs.productType;
      if (attrs.purpose !== undefined) data.purpose = attrs.purpose;
      if (attrs.shelfLife !== undefined) data.shelfLife = attrs.shelfLife;
      if (attrs.productTypeOptionId !== undefined) {
        data.productTypeOption = attrs.productTypeOptionId
          ? { connect: { id: attrs.productTypeOptionId } }
          : { disconnect: true };
      }
      if (attrs.purposeOptionId !== undefined) {
        data.purposeOption = attrs.purposeOptionId
          ? { connect: { id: attrs.purposeOptionId } }
          : { disconnect: true };
      }
      if (attrs.shelfLifeOptionId !== undefined) {
        data.shelfLifeOption = attrs.shelfLifeOptionId
          ? { connect: { id: attrs.shelfLifeOptionId } }
          : { disconnect: true };
      }
      if (attrs.storageOptionId !== undefined) {
        data.storageOption = attrs.storageOptionId
          ? { connect: { id: attrs.storageOptionId } }
          : { disconnect: true };
      }
      if (dto.extraHtml !== undefined) {
        data.extraHtml = sanitizeRichHtmlOrNull(dto.extraHtml);
      }
      if (dto.active !== undefined) data.active = dto.active;
      if (dto.excludeFromCatalog !== undefined) {
        data.excludeFromCatalog = dto.excludeFromCatalog;
      }
      if (dto.metaTitle !== undefined) {
        data.metaTitle = trimOrNull(dto.metaTitle);
      }
      if (dto.metaDescription !== undefined) {
        data.metaDescription = trimOrNull(dto.metaDescription);
      }
      if (dto.ogImageUrl !== undefined) {
        data.ogImageUrl = trimOrNull(dto.ogImageUrl);
      }
      if (dto.canonicalPath !== undefined) {
        data.canonicalPath = normalizeCanonicalPath(dto.canonicalPath);
      }
      if (dto.seoNoIndex !== undefined) {
        data.seoNoIndex = dto.seoNoIndex;
      }
      if (dto.categoryId !== undefined) {
        data.category = { connect: { id: dto.categoryId } };
      }

      if (Object.keys(data).length) {
        await tx.product.update({ where: { id }, data });
      }

      if (dto.catalogTagIds !== undefined) {
        await this.syncProductCatalogTags(tx, id, dto.catalogTagIds);
      }
      if (dto.collectionIds !== undefined) {
        await this.syncProductCollections(tx, id, dto.collectionIds);
      }
      if (dto.productSetIds !== undefined) {
        await this.syncProductSets(tx, id, dto.productSetIds);
      }
    });

    return this.getProduct(id);
  }

  async deleteProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        variants: { select: { id: true } },
        images: { select: { url: true } },
      },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const variantIds = product.variants.map((v) => v.id);
    if (variantIds.length) {
      const ordered = await this.prisma.orderItem.count({
        where: { variantId: { in: variantIds } },
      });
      if (ordered > 0) {
        throw new ConflictException(
          'Нельзя удалить: варианты есть в заказах. Скройте товар (active=false).',
        );
      }
    }

    await this.prisma.product.delete({ where: { id } });
    for (const img of product.images) {
      await this.storage.deleteByPublicUrl(img.url);
    }
    return { ok: true };
  }

  // --- Variants ---

  async addVariant(productId: string, dto: CreateVariantDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Товар не найден');
    const variant = await this.prisma.$transaction((tx) =>
      this.createVariantInTx(tx, productId, product.slug, dto),
    );
    return serializeVariant(variant);
  }

  async updateVariant(variantId: string, dto: UpdateVariantDto) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { id: true, slug: true } } },
    });
    if (!variant) throw new NotFoundException('Вариант не найден');

    const nextMin =
      dto.orderMinQty !== undefined ? dto.orderMinQty : variant.orderMinQty;
    const nextMax =
      dto.orderMaxQty !== undefined ? dto.orderMaxQty : variant.orderMaxQty;
    this.assertOrderQty(nextMin, nextMax);

    const data: Prisma.ProductVariantUpdateInput = {};
    const nextName = dto.name !== undefined ? dto.name.trim() : variant.name;
    if (dto.name !== undefined) {
      if (!nextName) throw new BadRequestException('Укажите название варианта');
      data.name = nextName;
    }
    if (dto.slug !== undefined) {
      const raw = dto.slug.trim();
      if (!raw) {
        throw new BadRequestException('Slug не может быть пустым');
      }
      data.slug = await this.uniqueVariantSlug(
        variant.productId,
        slugify(raw),
        variantId,
      );
    }
    // Не перезаписываем slug/SKU молча при смене имени или объёма.
    if (dto.nationalCatalogName !== undefined) {
      data.nationalCatalogName = trimOrNull(dto.nationalCatalogName);
    }
    if (dto.volumeMl !== undefined) data.volumeMl = dto.volumeMl;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.compareAt !== undefined) data.compareAt = dto.compareAt;
    if (dto.orderMinQty !== undefined) data.orderMinQty = dto.orderMinQty;
    if (dto.orderMaxQty !== undefined) data.orderMaxQty = dto.orderMaxQty;
    if (dto.weightGrams !== undefined) data.weightGrams = dto.weightGrams;
    if (dto.lengthMm !== undefined) data.lengthMm = dto.lengthMm;
    if (dto.widthMm !== undefined) data.widthMm = dto.widthMm;
    if (dto.heightMm !== undefined) data.heightMm = dto.heightMm;
    if (dto.packageVolume !== undefined) data.packageVolume = dto.packageVolume;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.stockReserve !== undefined) data.stockReserve = dto.stockReserve;
    if (dto.active !== undefined) data.active = dto.active;

    if (dto.sku !== undefined) {
      const raw = dto.sku.trim();
      if (!raw) {
        throw new BadRequestException('SKU не может быть пустым');
      }
      data.sku = await this.uniqueSku(raw, variantId);
    }
    if (dto.onecId !== undefined) {
      data.onecId = await this.normalizeOnecId(dto.onecId, variantId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data,
      });
      if (dto.productImageIds !== undefined) {
        await this.setVariantGallery(tx, variantId, variant.productId, dto.productImageIds);
      }
      if (dto.shades !== undefined) {
        await this.replaceVariantShades(tx, variantId, dto.shades);
      }
      return tx.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        include: variantInclude,
      });
    });

    return serializeVariant(updated);
  }

  async deleteVariant(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundException('Вариант не найден');

    const ordered = await this.prisma.orderItem.count({ where: { variantId } });
    if (ordered > 0) {
      throw new ConflictException('Вариант есть в заказах — удаление запрещено');
    }
    await this.prisma.productVariant.delete({ where: { id: variantId } });
    return { ok: true };
  }

  async duplicateVariant(variantId: string) {
    const source = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: variantInclude,
    });
    if (!source) throw new NotFoundException('Вариант не найден');

    const product = await this.prisma.product.findUnique({
      where: { id: source.productId },
      select: { id: true, slug: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const copyName = `${source.name} (копия)`.slice(0, 200);
    const created = await this.prisma.$transaction(async (tx) => {
      const slug = await this.uniqueVariantSlug(
        product.id,
        slugify(copyName),
        undefined,
        tx,
      );
      const sku = await this.uniqueSku(
        this.skuFromProductAndVariant(product.slug, copyName, source.volumeMl),
        undefined,
        tx,
      );

      const variant = await tx.productVariant.create({
        data: {
          productId: product.id,
          name: copyName,
          slug,
          nationalCatalogName: source.nationalCatalogName,
          volumeMl: source.volumeMl,
          sku,
          price: source.price,
          compareAt: source.compareAt,
          orderMinQty: source.orderMinQty,
          orderMaxQty: source.orderMaxQty,
          weightGrams: source.weightGrams,
          lengthMm: source.lengthMm,
          widthMm: source.widthMm,
          heightMm: source.heightMm,
          packageVolume: source.packageVolume,
          stock: source.stock,
          stockReserve: source.stockReserve,
          active: false,
        },
      });

      if (source.galleryLinks.length) {
        await tx.productVariantImage.createMany({
          data: source.galleryLinks.map((link) => ({
            variantId: variant.id,
            productImageId: link.productImageId,
            sortOrder: link.sortOrder,
          })),
        });
      }

      if (source.shades.length) {
        await tx.productVariantShade.createMany({
          data: source.shades.map((s) => ({
            variantId: variant.id,
            name: s.name,
            imageUrl: s.imageUrl,
            sortOrder: s.sortOrder,
          })),
        });
      }

      return tx.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        include: variantInclude,
      });
    });

    return serializeVariant(created);
  }

  // --- Images ---

  async uploadProductImage(
    productId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
  ) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Товар не найден');

    const { url, mediaType } = await this.storage.saveGalleryMedia(
      file,
      `products/${productId}`,
    );
    const maxSort = await this.prisma.productImage.aggregate({
      where: { productId },
      _max: { sortOrder: true },
    });
    const image = await this.prisma.productImage.create({
      data: {
        productId,
        url,
        mediaType,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });
    return image;
  }

  async reorderProductImages(productId: string, imageIds: string[]) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { images: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    const existing = new Set(product.images.map((i) => i.id));
    if (imageIds.length !== existing.size || imageIds.some((id) => !existing.has(id))) {
      throw new BadRequestException('Список imageIds должен совпадать с картинками товара');
    }
    await this.prisma.$transaction(
      imageIds.map((id, sortOrder) =>
        this.prisma.productImage.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    return this.getProduct(productId);
  }

  async deleteProductImage(imageId: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Изображение не найдено');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.deleteByPublicUrl(image.url);
    return { ok: true };
  }

  async uploadRichMedia(file: {
    buffer: Buffer;
    mimetype: string;
    size: number;
    originalname?: string;
  }) {
    const { url } = await this.storage.saveImage(file, 'rich');
    return { url };
  }

  // --- helpers ---

  private assertOrderQty(min: number, max: number | null | undefined) {
    if (max != null && max < min) {
      throw new BadRequestException('Макс. кол-во не может быть меньше мин.');
    }
  }

  private async createVariantInTx(
    tx: Prisma.TransactionClient,
    productId: string,
    productSlug: string,
    dto: VariantInputDto,
  ) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Укажите название варианта');
    this.assertOrderQty(dto.orderMinQty ?? 1, dto.orderMaxQty ?? null);

    const slug = await this.uniqueVariantSlug(
      productId,
      dto.slug?.trim() ? slugify(dto.slug) : slugify(name),
      undefined,
      tx,
    );
    const sku = dto.sku?.trim()
      ? await this.uniqueSku(dto.sku.trim(), undefined, tx)
      : await this.uniqueSku(
          this.skuFromProductAndVariant(productSlug, name, dto.volumeMl ?? null),
          undefined,
          tx,
        );

    const onecId =
      dto.onecId !== undefined
        ? await this.normalizeOnecId(dto.onecId, undefined, tx)
        : null;

    const variant = await tx.productVariant.create({
      data: {
        productId,
        name,
        slug,
        nationalCatalogName: trimOrNull(dto.nationalCatalogName),
        volumeMl: dto.volumeMl ?? null,
        sku,
        onecId,
        price: dto.price,
        compareAt: dto.compareAt ?? null,
        orderMinQty: dto.orderMinQty ?? 1,
        orderMaxQty: dto.orderMaxQty ?? null,
        weightGrams: dto.weightGrams ?? null,
        lengthMm: dto.lengthMm ?? null,
        widthMm: dto.widthMm ?? null,
        heightMm: dto.heightMm ?? null,
        packageVolume: dto.packageVolume ?? null,
        stock: dto.stock ?? 0,
        stockReserve: dto.stockReserve ?? 0,
        active: dto.active ?? true,
      },
      include: variantInclude,
    });

    if (dto.productImageIds?.length) {
      await this.setVariantGallery(tx, variant.id, productId, dto.productImageIds);
    }
    if (dto.shades?.length) {
      await this.replaceVariantShades(tx, variant.id, dto.shades);
    }
    if (dto.productImageIds?.length || dto.shades?.length) {
      return tx.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        include: variantInclude,
      });
    }
    return variant;
  }

  async uploadVariantShadeImage(
    variantId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
    shadeName?: string,
  ) {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundException('Вариант не найден');

    const { url } = await this.storage.saveImage(file, `variants/${variantId}/shades`);
    const maxSort = await this.prisma.productVariantShade.aggregate({
      where: { variantId },
      _max: { sortOrder: true },
    });
    const name = shadeName?.trim() || 'Оттенок';
    const shade = await this.prisma.productVariantShade.create({
      data: {
        variantId,
        name,
        imageUrl: url,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });
    return shade;
  }

  private async replaceVariantShades(
    tx: Prisma.TransactionClient,
    variantId: string,
    shades: { id?: string; name: string; imageUrl?: string | null; sortOrder?: number }[],
  ) {
    const cleaned = shades
      .map((s, i) => ({
        id: s.id?.trim() || undefined,
        name: s.name.trim(),
        imageUrl: s.imageUrl?.trim() || null,
        sortOrder: s.sortOrder ?? i,
      }))
      .filter((s) => s.name);

    const existing = await tx.productVariantShade.findMany({ where: { variantId } });
    const keepIds = new Set(cleaned.map((s) => s.id).filter(Boolean) as string[]);
    const toDelete = existing.filter((e) => !keepIds.has(e.id));
    for (const row of toDelete) {
      if (row.imageUrl) await this.storage.deleteByPublicUrl(row.imageUrl);
    }
    if (toDelete.length) {
      await tx.productVariantShade.deleteMany({
        where: { id: { in: toDelete.map((d) => d.id) } },
      });
    }

    for (const s of cleaned) {
      if (s.id && existing.some((e) => e.id === s.id)) {
        await tx.productVariantShade.update({
          where: { id: s.id },
          data: { name: s.name, imageUrl: s.imageUrl, sortOrder: s.sortOrder },
        });
      } else {
        await tx.productVariantShade.create({
          data: {
            variantId,
            name: s.name,
            imageUrl: s.imageUrl,
            sortOrder: s.sortOrder,
          },
        });
      }
    }
  }

  private skuFromProductAndVariant(
    productSlug: string,
    variantName: string,
    volumeMl: number | null | undefined,
  ): string {
    if (volumeMl != null && Number.isFinite(volumeMl)) {
      return `${productSlug}-${volumeSlugPart(volumeMl)}ml`;
    }
    return `${productSlug}-${slugify(variantName)}`;
  }

  private async setVariantGallery(
    tx: Prisma.TransactionClient,
    variantId: string,
    productId: string,
    productImageIds: string[],
  ) {
    const ids = dedupeIdsPreserveOrder(productImageIds);
    if (ids.length) {
      const images = await tx.productImage.findMany({
        where: { id: { in: ids }, productId },
        select: { id: true },
      });
      if (images.length !== ids.length) {
        throw new BadRequestException(
          'productImageIds должны принадлежать галерее этого товара',
        );
      }
    }
    await tx.productVariantImage.deleteMany({ where: { variantId } });
    if (ids.length) {
      await tx.productVariantImage.createMany({
        data: ids.map((productImageId, sortOrder) => ({
          variantId,
          productImageId,
          sortOrder,
        })),
      });
    }
  }

  private async syncProductCatalogTags(
    tx: Prisma.TransactionClient,
    productId: string,
    rawIds: string[],
  ) {
    const desired = dedupeIdsPreserveOrder(rawIds);
    if (desired.length) {
      const n = await tx.catalogTag.count({ where: { id: { in: desired } } });
      if (n !== desired.length) {
        throw new BadRequestException('Один из тегов зон не найден');
      }
    }
    await tx.productCatalogTag.deleteMany({ where: { productId } });
    if (desired.length) {
      await tx.productCatalogTag.createMany({
        data: desired.map((tagId) => ({ productId, tagId })),
        skipDuplicates: true,
      });
    }
  }

  private async syncProductCollections(
    tx: Prisma.TransactionClient,
    productId: string,
    rawIds: string[],
  ) {
    const desired = dedupeIdsPreserveOrder(rawIds);
    if (desired.length) {
      const n = await tx.collection.count({ where: { id: { in: desired } } });
      if (n !== desired.length) {
        throw new BadRequestException('Одна из коллекций не найдена');
      }
    }
    const existing = await tx.collectionItem.findMany({ where: { productId } });
    const existingByCollection = new Map(existing.map((e) => [e.collectionId, e]));
    const desiredSet = new Set(desired);
    const toRemove = existing.filter((e) => !desiredSet.has(e.collectionId));
    if (toRemove.length) {
      await tx.collectionItem.deleteMany({
        where: { id: { in: toRemove.map((r) => r.id) } },
      });
    }
    for (const collectionId of desired) {
      if (existingByCollection.has(collectionId)) continue;
      const agg = await tx.collectionItem.aggregate({
        where: { collectionId },
        _max: { sortOrder: true },
      });
      await tx.collectionItem.create({
        data: {
          collectionId,
          productId,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
        },
      });
    }
  }

  private async syncProductSets(
    tx: Prisma.TransactionClient,
    productId: string,
    rawIds: string[],
  ) {
    const desired = dedupeIdsPreserveOrder(rawIds);
    if (desired.length) {
      const n = await tx.productSet.count({ where: { id: { in: desired } } });
      if (n !== desired.length) {
        throw new BadRequestException('Один из наборов не найден');
      }
    }
    const existing = await tx.productSetItem.findMany({ where: { productId } });
    const existingBySet = new Map(existing.map((e) => [e.productSetId, e]));
    const desiredSet = new Set(desired);
    const toRemove = existing.filter((e) => !desiredSet.has(e.productSetId));
    if (toRemove.length) {
      await tx.productSetItem.deleteMany({
        where: { id: { in: toRemove.map((r) => r.id) } },
      });
    }
    for (const productSetId of desired) {
      if (existingBySet.has(productSetId)) continue;
      const agg = await tx.productSetItem.aggregate({
        where: { productSetId },
        _max: { sortOrder: true },
      });
      await tx.productSetItem.create({
        data: {
          productSetId,
          productId,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
        },
      });
    }
  }

  private async uniqueProductSlug(base: string, excludeId?: string) {
    let slug = base;
    let n = 2;
    for (;;) {
      const found = await this.prisma.product.findUnique({ where: { slug } });
      if (!found || found.id === excludeId) return slug;
      slug = `${base}-${n++}`;
    }
  }

  private async uniqueVariantSlug(
    productId: string,
    base: string,
    excludeId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    let slug = base.slice(0, 80) || 'variant';
    let n = 2;
    for (;;) {
      const found = await db.productVariant.findFirst({
        where: { productId, slug },
      });
      if (!found || found.id === excludeId) return slug;
      slug = `${base.slice(0, 70)}-${n++}`;
    }
  }

  private async uniqueSku(
    base: string,
    excludeId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    let sku = base.slice(0, 80);
    let n = 2;
    for (;;) {
      const found = await db.productVariant.findUnique({ where: { sku } });
      if (!found || found.id === excludeId) return sku;
      sku = `${base.slice(0, 70)}-${n++}`;
    }
  }

  /** Пустая строка / null → сброс; иначе unique onecId. */
  private async normalizeOnecId(
    value: string | null | undefined,
    excludeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (value == null) return null;
    const raw = value.trim();
    if (!raw) return null;
    const onecId = raw.split('#')[0]!.trim().slice(0, 64);
    if (!onecId) return null;
    const db = tx ?? this.prisma;
    const found = await db.productVariant.findUnique({ where: { onecId } });
    if (found && found.id !== excludeId) {
      throw new ConflictException(`onecId уже занят другим вариантом: ${onecId}`);
    }
    return onecId;
  }
}
