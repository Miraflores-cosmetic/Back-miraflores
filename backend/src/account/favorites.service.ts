import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscountsPublicService } from '../discounts/discounts-public.service';
import { applyCampaignToDetailVariants } from '../catalog/catalog-campaign-price.util';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogVisibilityService } from '../user-groups/catalog-visibility.service';
import { CommerceContextService } from '../user-groups/commerce-context.service';
import { GroupPricingService } from '../user-groups/group-pricing.service';

function availableOf(v: { stock: number; stockReserve: number }) {
  return Math.max(0, v.stock - v.stockReserve);
}

function cardFromFavorite(
  row: {
    variantId: string;
    variant: {
      id: string;
      name: string;
      price: number;
      compareAt: number | null;
      orderMinQty: number;
      orderMaxQty: number | null;
      stock: number;
      stockReserve: number;
      shades: { id: string; name: string; imageUrl: string | null }[];
      product: {
        id: string;
        slug: string;
        name: string;
        shortDescription: string | null;
        categoryId: string;
        active: boolean;
        images: { url: string; mediaType: string }[];
      };
    };
  },
  resolvedPrice: number,
  compareAt: number | null,
) {
  const v = row.variant;
  const p = v.product;
  const available = availableOf(v);
  const minQty = Math.max(1, v.orderMinQty ?? 1);
  let maxQty =
    v.orderMaxQty != null ? Math.min(v.orderMaxQty, available) : available;
  if (maxQty > 0 && minQty > maxQty) maxQty = 0;
  const shade = v.shades[0] ?? null;
  const imageUrls = p.images.map((i) => i.url).filter(Boolean);
  const cover = p.images[0];
  const price = resolvedPrice;
  const discountPercent =
    compareAt != null && compareAt > price
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : null;

  return {
    id: p.id,
    productId: p.id,
    variantId: v.id,
    variantName: v.name,
    shadeId: shade?.id ?? null,
    shadeName: shade?.name ?? null,
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription,
    price,
    oldPrice: compareAt != null && compareAt > price ? compareAt : null,
    discountPercent,
    priceFrom: false,
    available,
    minQty,
    maxQty,
    imageUrl: cover?.url || shade?.imageUrl || null,
    imageUrls,
    mediaType: cover?.mediaType === 'video' ? ('video' as const) : ('image' as const),
  };
}

const favoriteInclude = {
  variant: {
    select: {
      id: true,
      name: true,
      price: true,
      compareAt: true,
      orderMinQty: true,
      orderMaxQty: true,
      stock: true,
      stockReserve: true,
      active: true,
      shades: {
        orderBy: { sortOrder: 'asc' as const },
        take: 1,
        select: { id: true, name: true, imageUrl: true },
      },
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          shortDescription: true,
          categoryId: true,
          active: true,
          excludeFromCatalog: true,
          images: {
            take: 8,
            orderBy: { sortOrder: 'asc' as const },
            select: { url: true, mediaType: true },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceContext: CommerceContextService,
    private readonly groupPricing: GroupPricingService,
    private readonly catalogVisibility: CatalogVisibilityService,
    private readonly discountsPublic: DiscountsPublicService,
  ) {}

  async listIds(userId: string) {
    const rows = await this.prisma.userFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { variantId: true },
    });
    return { variantIds: rows.map((r) => r.variantId) };
  }

  async listItems(userId: string) {
    const ctx = await this.commerceContext.resolveFromUserId(userId);
    const rows = await this.prisma.userFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: favoriteInclude,
    });

    const eligible = rows.filter(
      (r) =>
        r.variant.active &&
        r.variant.product.active &&
        !r.variant.product.excludeFromCatalog,
    );
    if (!eligible.length) return { items: [] as const };

    const campaigns = ctx.allowCatalogDiscounts
      ? await this.discountsPublic.loadRunningCampaigns()
      : [];

    const priceInputs = eligible.map((r) => ({
      variantId: r.variantId,
      categoryId: r.variant.product.categoryId,
      basePrice: r.variant.price,
    }));
    const priceMap = await this.groupPricing.resolveVariantPrices(ctx, priceInputs);

    const items = [];
    for (const row of eligible) {
      const p = row.variant.product;
      const visibleIds = await this.catalogVisibility.filterVisibleVariantIds(ctx, {
        productId: p.id,
        categoryId: p.categoryId,
        variantIds: [row.variantId],
      });
      if (!visibleIds.includes(row.variantId)) continue;

      const groupPrice = priceMap.get(row.variantId)?.groupPrice ?? row.variant.price;
      let price = groupPrice;
      let compareAt = row.variant.compareAt;
      if (ctx.allowCatalogDiscounts && campaigns.length) {
        const priced = applyCampaignToDetailVariants(
          [{ id: row.variantId, price: groupPrice, compareAt: row.variant.compareAt }],
          p.id,
          p.categoryId,
          campaigns,
        );
        price = priced[0]?.price ?? groupPrice;
        compareAt = priced[0]?.compareAt ?? compareAt;
      }

      items.push(cardFromFavorite(row, price, compareAt));
    }

    return { items };
  }

  async add(userId: string, variantId: string) {
    await this.requireActiveVariant(variantId);
    await this.prisma.userFavorite.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId },
      update: {},
    });
    return this.listIds(userId);
  }

  async remove(userId: string, variantId: string) {
    await this.prisma.userFavorite.deleteMany({
      where: { userId, variantId },
    });
    return this.listIds(userId);
  }

  async replace(userId: string, variantIds: string[]) {
    const unique = [...new Set(variantIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length > 200) {
      throw new BadRequestException('Слишком много позиций в избранном');
    }

    if (unique.length) {
      const found = await this.prisma.productVariant.findMany({
        where: { id: { in: unique }, active: true, product: { active: true, excludeFromCatalog: false } },
        select: { id: true },
      });
      const ok = new Set(found.map((v) => v.id));
      const valid = unique.filter((id) => ok.has(id));

      await this.prisma.$transaction(async (tx) => {
        await tx.userFavorite.deleteMany({ where: { userId } });
        if (valid.length) {
          await tx.userFavorite.createMany({
            data: valid.map((variantId) => ({ userId, variantId })),
            skipDuplicates: true,
          });
        }
      });
    } else {
      await this.prisma.userFavorite.deleteMany({ where: { userId } });
    }

    return this.listIds(userId);
  }

  async clear(userId: string) {
    await this.prisma.userFavorite.deleteMany({ where: { userId } });
    return { variantIds: [] as string[] };
  }

  private async requireActiveVariant(variantId: string) {
    const v = await this.prisma.productVariant.findFirst({
      where: { id: variantId, active: true, product: { active: true, excludeFromCatalog: false } },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('Вариант не найден');
  }
}
