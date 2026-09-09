export type AdminOrderListItem = {
  id: string;
  number: string;
  status: string;
  email: string;
  phone: string;
  customerName: string | null;
  total: number;
  refundedAmount?: number;
  userId: string | null;
  createdAt: string;
};

export type AdminOrderListResponse = {
  items: AdminOrderListItem[];
  total: number;
  page: number;
  limit: number;
};

export type AdminOrderShippingAddress = {
  city: string;
  address: string;
  apartment: string;
  region?: string;
  district?: string;
  postalCode: string;
  comment: string;
  pvzCode?: string;
  phone?: string;
  recipientName?: string;
  carrierQuote?: {
    tariffId?: number | null;
    tariffName?: string | null;
    daysMin?: number | null;
    daysMax?: number | null;
    cost?: number | null;
    method?: string | null;
    freePvz?: boolean;
    source?: string | null;
    estimatedAt?: string | null;
    quoteExp?: number | null;
  } | null;
};

export type AdminOrderItem = {
  id: string;
  title: string;
  sku: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  isGratitudeGift?: boolean;
  variantId?: string | null;
  shadeId?: string | null;
  shadeName?: string | null;
  shadeImageUrl?: string | null;
  /** Thumbnail: shade → variant gallery → product image. */
  imageUrl?: string | null;
  productId?: string | null;
  productSlug?: string | null;
};

export type AdminOrderActions = {
  canCancel: boolean;
  canMarkPaid: boolean;
  canStartPacking: boolean;
  canShip: boolean;
  canSendTracking?: boolean;
  canDeliver: boolean;
  canRefund: boolean;
  canEditAddress?: boolean;
  canEditItems?: boolean;
  canCreateSurcharge?: boolean;
};

export type AdminOrderEvent = {
  id: string;
  type: string;
  message: string;
  actorUserId: string | null;
  createdAt: string;
  meta?: unknown;
  actor?: {
    id: string;
    email: string;
    displayName: string | null;
  } | null;
};

export type AdminOrderDetail = {
  id: string;
  number: string;
  status: string;
  email: string;
  phone: string;
  customerName: string | null;
  customerNote?: string | null;
  shippingAddress: AdminOrderShippingAddress | null;
  shippingMethod?: string | null;
  shippingCost: number;
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount?: number;
  giftCertificateCode?: string | null;
  giftPurchaseDenominationId?: string | null;
  giftPurchaseRecipientEmail?: string | null;
  issuedGiftCertificates?: Array<{
    id: string;
    code: string;
    faceValue: number;
    balance: number;
    status: string;
    expiresAt: string | null;
  }>;
  /** Покупка сертификата: коды уже потрачены — refund покупки запрещён. */
  giftPurchaseRefundBlocked?: boolean;
  giftPurchaseSpentTotal?: number;
  total: number;
  refundedAmount: number;
  refundRemaining: number;
  netPaid?: number;
  balanceDue?: number;
  refundSuggested?: number;
  promoCode: string | null;
  pricingGroupId?: string | null;
  pricingGroupName?: string | null;
  pricingContext?: string | null;
  guestId: string | null;
  userId: string | null;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    isActive: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
  hasPromoRedemption: boolean;
  items: AdminOrderItem[];
  payments: Array<{
    id: string;
    provider: string;
    status: string;
    amount: number;
    externalId: string | null;
    confirmationUrl?: string | null;
    kind?: string | null;
    createdAt: string;
  }>;
  shipments: Array<{
    id: string;
    provider: string;
    tracking: string | null;
    status: string | null;
    externalId: string | null;
    createdAt: string;
  }>;
  events: AdminOrderEvent[];
  /** Деньги списаны после cancel/TTL, автовозврат не удался */
  latePaymentFailed?: boolean;
  actions: AdminOrderActions;
  canCancel: boolean;
};
