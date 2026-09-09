export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  coverImageUrl?: string | null;
  sortOrder: number;
  parentId: string | null;
  parent?: { id: string; name: string; slug: string } | null;
  depthFromRoot?: number;
  childrenCount?: number;
  productCount?: number;
};

export type AdminCatalogTag = {
  id: string;
  name: string;
  slug: string;
  coverImageUrl?: string | null;
  sortOrder: number;
  productCount?: number;
  images?: { id: string; url: string; sortOrder: number }[];
  steps?: { id: string; title: string; description: string; sortOrder: number }[];
};

export type AdminVariantShade = {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
};

export type AdminVariant = {
  id: string;
  productId: string;
  name: string;
  slug: string;
  nationalCatalogName: string | null;
  volumeMl: number | null;
  sku: string;
  /** UUID номенклатуры 1С (техполе) */
  onecId: string | null;
  price: number;
  compareAt: number | null;
  orderMinQty: number;
  orderMaxQty: number | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  packageVolume: number | null;
  stock: number;
  stockReserve: number;
  active: boolean;
  productImageIds: string[];
  gallery: { id: string; url: string; sortOrder: number; mediaType?: 'image' | 'video' }[];
  shades: AdminVariantShade[];
  createdAt: string;
  updatedAt: string;
};

export type AdminProduct = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  pageShortDescriptionHtml: string | null;
  descriptionHtml: string | null;
  actionEffectHtml: string | null;
  applicationHtml: string | null;
  compositionHtml: string | null;
  importantNoteHtml: string | null;
  mirafloresNoteHtml: string | null;
  storageHtml: string | null;
  productType: string | null;
  purpose: string | null;
  shelfLife: string | null;
  productTypeOptionId?: string | null;
  purposeOptionId?: string | null;
  shelfLifeOptionId?: string | null;
  storageOptionId?: string | null;
  extraHtml: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  canonicalPath: string | null;
  seoNoIndex: boolean;
  active: boolean;
  /** Скрыт с витрины, но активен (подарки благодарности и т.п.) */
  excludeFromCatalog: boolean;
  categoryId: string;
  category: {
    id: string;
    name: string;
    slug: string;
    parentId?: string | null;
    parent?: { id: string; name: string; slug: string } | null;
  } | null;
  coverImageUrl?: string | null;
  catalogTagIds: string[];
  collectionIds: string[];
  productSetIds: string[];
  variants: AdminVariant[];
  variantCount: number;
  minPrice: number | null;
  images: { id: string; url: string; sortOrder: number; mediaType?: 'image' | 'video' }[];
  createdAt: string;
  updatedAt: string;
};

/** Лёгкая строка списка товаров (без HTML / полной галереи). */
export type AdminProductListItem = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  excludeFromCatalog: boolean;
  categoryId: string;
  category: {
    id: string;
    name: string;
    slug: string;
    parentId?: string | null;
    parent?: { id: string; name: string; slug: string } | null;
  } | null;
  coverImageUrl: string | null;
  coverMediaType: 'image' | 'video';
  variantCount: number;
  minPrice: number | null;
  primarySku: string | null;
  stockTotal: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminProductListResponse = {
  items: AdminProductListItem[];
  total: number;
  page: number;
  limit: number;
};

/** Общая форма коллекции / набора в админке. */
export type AdminProductGroup = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  coverImageUrl: string | null;
  productPreviewUrl?: string | null;
  active: boolean;
  featuredLayout?: boolean;
  sortOrder: number;
  productIds: string[];
  products: { id: string; name: string; slug: string; sortOrder: number }[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminCollection = AdminProductGroup;
export type AdminProductSet = AdminProductGroup;

export type AdminCollectionListResponse = {
  items: AdminCollection[];
  total: number;
  page: number;
  limit: number;
};

export type AdminProductSetListResponse = {
  items: AdminProductSet[];
  total: number;
  page: number;
  limit: number;
};
