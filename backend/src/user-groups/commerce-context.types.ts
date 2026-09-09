import type { PriceRounding } from '@prisma/client';

export type CommerceContextKind =
  | 'guest'
  | 'registered_default'
  | 'registered_group';

export type CommerceContext = {
  kind: CommerceContextKind;
  groupId: string;
  groupName: string;
  groupSlug: string;
  allowCatalogDiscounts: boolean;
  allowPromoCodes: boolean;
  priceRounding: PriceRounding;
  isGuest: boolean;
  isRegistered: boolean;
  userId?: string;
  /** Explicit User.groupId (null = registered default) */
  userGroupId?: string | null;
};

export type VariantPriceInput = {
  variantId: string;
  categoryId: string;
  basePrice: number;
};

export type ResolvedVariantPrice = {
  basePrice: number;
  groupPrice: number;
};
