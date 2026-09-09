export type AdminUserGroupCounts = {
  users: number;
  variantPrices: number;
  categoryPrices: number;
  visibilityRules: number;
};

export type AdminUserGroup = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  isDefaultGuest: boolean;
  isDefaultRegistered: boolean;
  assignable: boolean;
  allowCatalogDiscounts: boolean;
  allowPromoCodes: boolean;
  priceRounding: 'FLOOR' | 'CEIL' | 'NEAREST';
  counts: AdminUserGroupCounts;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserGroupListResponse = {
  items: AdminUserGroup[];
  total: number;
  page: number;
  limit: number;
};

export type AdminGroupVariantPriceRow = {
  variantId: string;
  price: number;
  basePrice: number;
  sku: string;
  variantName: string;
  productId: string;
  productName: string;
  productSlug: string;
};

export type AdminGroupVariantPriceListResponse = {
  items: AdminGroupVariantPriceRow[];
  total: number;
  page: number;
  limit: number;
};

export type AdminGroupCategoryPriceRow = {
  categoryId: string;
  type: 'PERCENT_OFF' | 'FIXED_OFF' | 'FIXED_PRICE';
  value: number;
  categoryName: string;
  categorySlug: string;
};

export type AdminCatalogVisibilityRule = {
  id: string;
  mode: string;
  groupId: string | null;
  targetType: string;
  targetId: string;
  targetLabel?: string | null;
  group?: { id: string; name: string; slug: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminGroupMember = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

export type AdminGroupMemberListResponse = {
  items: AdminGroupMember[];
  total: number;
  page: number;
  limit: number;
};
