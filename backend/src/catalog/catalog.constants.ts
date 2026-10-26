/** Верхняя граница page size для admin list (collections / sets / products). */
export const ADMIN_LIST_MAX_LIMIT = 100;

/** Дефолтный page size списков админки (users / orders / products). */
export const ADMIN_LIST_DEFAULT_LIMIT = 20;

/** Public storefront product list defaults (keep in sync with FE PUBLIC_CATALOG_PAGE_SIZE). */
export const PUBLIC_PRODUCTS_DEFAULT_LIMIT = 24;
export const PUBLIC_PRODUCTS_MAX_LIMIT = 100;

/**
 * Служебные корни (ETL fallback) — не показываем в пузырях / меню витрины.
 * Товары в категории остаются доступны по прямым URL и в выдаче.
 */
export const PUBLIC_HIDDEN_CATEGORY_SLUGS = ['uncategorized'] as const;

/**
 * Soft cap when visibility rules force in-memory pagination on default sort
 * (sale/price/popular use SQL — see catalog-list-sql.util.ts).
 * TODO(scale): denorm visibility for SQL PLP without visibilityWalk batches.
 */
export const PUBLIC_PRODUCTS_IN_MEMORY_MAX = 2000;

/** PDP hero: product-level gallery cap (full set via variant switch / lazy thumbs). */
export const PUBLIC_PDP_HERO_IMAGES_MAX = 12;
