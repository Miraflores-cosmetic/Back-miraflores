import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type CatalogListSqlFilters = {
  categoryIds?: string[];
  tagSlug?: string;
  collectionId?: string;
  saleOnly?: boolean;
  priceMin?: number;
  priceMax?: number;
  sort: string;
  useCollectionSort: boolean;
  campaignProductIds: string[];
  campaignCategoryIds: string[];
  skip: number;
  take: number;
};

type IdRow = { id: string };
type CountRow = { count: bigint };

/** Sellable variant predicate (mirrors catalog-price.util sample exclusion). */
const SELLABLE_VARIANT_SQL = Prisma.sql`
  v.active = true
  AND v.price > 0
  AND lower(trim(v.name)) <> 'пробник'
  AND v.name NOT ILIKE '%пробник%'
`;

function orderSql(sort: string, useCollectionSort: boolean): Prisma.Sql {
  if (useCollectionSort) {
    if (sort === 'price_asc') {
      return Prisma.sql`ci."sortOrder" ASC, f.card_price ASC NULLS LAST, p."createdAt" DESC`;
    }
    if (sort === 'price_desc') {
      return Prisma.sql`ci."sortOrder" ASC, f.card_price DESC NULLS LAST, p."createdAt" DESC`;
    }
    if (sort === 'popular') {
      return Prisma.sql`ci."sortOrder" ASC, f.discount_ratio DESC NULLS LAST, p."createdAt" DESC`;
    }
    return Prisma.sql`ci."sortOrder" ASC, p."createdAt" DESC`;
  }
  if (sort === 'price_asc') {
    return Prisma.sql`f.card_price ASC NULLS LAST, p."createdAt" DESC`;
  }
  if (sort === 'price_desc') {
    return Prisma.sql`f.card_price DESC NULLS LAST, p."createdAt" DESC`;
  }
  if (sort === 'popular') {
    return Prisma.sql`f.discount_ratio DESC NULLS LAST, p."createdAt" DESC`;
  }
  if (sort === 'name') {
    return Prisma.sql`p.name ASC`;
  }
  return Prisma.sql`p."createdAt" DESC`;
}

/**
 * SQL pagination for PLP sale / price filters (variant min price, no full catalog pool).
 * Campaign list prices are applied after fetch on the page slice only.
 */
export async function queryCatalogProductIdsPage(
  prisma: PrismaService,
  filters: CatalogListSqlFilters,
): Promise<{ ids: string[]; total: number }> {
  const categoryIds = filters.categoryIds?.filter(Boolean) ?? [];
  const tagSlug = filters.tagSlug?.trim() || null;
  const collectionId = filters.collectionId?.trim() || null;
  const useCollectionSort = filters.useCollectionSort && Boolean(collectionId);

  const categoryClause =
    categoryIds.length > 0
      ? Prisma.sql`AND p."categoryId" IN (${Prisma.join(categoryIds)})`
      : Prisma.empty;

  const tagClause = tagSlug
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM "ProductCatalogTag" pct
          INNER JOIN "CatalogTag" t ON t.id = pct."tagId"
          WHERE pct."productId" = p.id AND t.slug = ${tagSlug}
        )
      `
    : Prisma.empty;

  const collectionClause = collectionId
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM "CollectionItem" ci0
          WHERE ci0."productId" = p.id AND ci0."collectionId" = ${collectionId}
        )
      `
    : Prisma.empty;

  const campaignProductIds = filters.campaignProductIds.filter(Boolean);
  const campaignCategoryIds = filters.campaignCategoryIds.filter(Boolean);

  const saleClause = filters.saleOnly
    ? Prisma.sql`AND (
        f.variant_on_sale = true
        ${
          campaignProductIds.length
            ? Prisma.sql`OR p.id IN (${Prisma.join(campaignProductIds)})`
            : Prisma.empty
        }
        ${
          campaignCategoryIds.length
            ? Prisma.sql`OR p."categoryId" IN (${Prisma.join(campaignCategoryIds)})`
            : Prisma.empty
        }
      )`
    : Prisma.empty;

  const priceMinClause =
    filters.priceMin != null
      ? Prisma.sql`AND f.card_price >= ${filters.priceMin}`
      : Prisma.empty;
  const priceMaxClause =
    filters.priceMax != null
      ? Prisma.sql`AND f.card_price <= ${filters.priceMax}`
      : Prisma.empty;

  const collectionJoin = useCollectionSort
    ? Prisma.sql`
        INNER JOIN "CollectionItem" ci ON ci."productId" = p.id AND ci."collectionId" = ${collectionId}
      `
    : Prisma.empty;

  const baseFrom = Prisma.sql`
    FROM "Product" p
    INNER JOIN (
      SELECT
        p2.id,
        MIN(v.price) FILTER (WHERE ${SELLABLE_VARIANT_SQL}) AS card_price,
        BOOL_OR(
          v.active AND v."compareAt" IS NOT NULL AND v."compareAt" > 0 AND v."compareAt" > v.price
        ) AS variant_on_sale,
        MAX(
          CASE
            WHEN v.active AND v."compareAt" IS NOT NULL AND v."compareAt" > v.price AND v."compareAt" > 0
            THEN (v."compareAt" - v.price)::double precision / v."compareAt"
            ELSE 0
          END
        ) AS discount_ratio
      FROM "Product" p2
      INNER JOIN "ProductVariant" v ON v."productId" = p2.id
      WHERE p2.active = true AND p2."excludeFromCatalog" = false
      GROUP BY p2.id
    ) f ON f.id = p.id
    ${collectionJoin}
    WHERE p.active = true AND p."excludeFromCatalog" = false
      AND f.card_price IS NOT NULL
      ${categoryClause}
      ${tagClause}
      ${collectionClause}
      ${saleClause}
      ${priceMinClause}
      ${priceMaxClause}
  `;

  const orderBy = orderSql(filters.sort, useCollectionSort);

  const [countRows, idRows] = await prisma.$transaction([
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      ${baseFrom}
    `,
    prisma.$queryRaw<IdRow[]>`
      SELECT p.id
      ${baseFrom}
      ORDER BY ${orderBy}
      OFFSET ${filters.skip}
      LIMIT ${filters.take}
    `,
  ]);

  const total = Number(countRows[0]?.count ?? 0n);
  const ids = idRows.map((r) => r.id);
  return { ids, total };
}
