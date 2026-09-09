export type BuyerAddress = {
  id: string;
  recipientName: string | null;
  phone: string | null;
  city: string;
  address: string;
  apartment: string | null;
  postalCode: string | null;
  comment: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BuyerProfile = {
  id: string;
  email: string;
  displayName: string | null;
  phone: string | null;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  createdAt: string;
  pricing?: {
    context: string;
    group: { id: string; name: string; slug: string };
    allowCatalogDiscounts: boolean;
    allowPromoCodes: boolean;
  };
};

export type BuyerOrderItem = {
  id: string;
  title: string;
  sku: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  subtitle: string | null;
  imageUrl: string | null;
};

export type BuyerOrder = {
  id: string;
  number: string;
  status: string;
  total: number;
  createdAt: string;
  items: BuyerOrderItem[];
  tracking?: string | null;
  trackingProvider?: string | null;
};

export type BuyerOrderDetail = BuyerOrder & {
  email: string;
  phone: string;
  customerName: string | null;
  shippingAddress: {
    city: string;
    address: string;
    apartment: string;
    postalCode: string;
    comment: string;
  } | null;
  shippingCost: number;
  subtotal: number;
  discountTotal: number;
  promoCode: string | null;
  pricingGroup?: {
    id: string | null;
    name: string;
    context: string | null;
  } | null;
  giftCertificateCode?: string | null;
  giftCertificateAmount?: number;
  payToken: string | null;
  /** ISO: до какого момента ждать оплату (TTL). */
  payExpiresAt?: string | null;
  canCancel?: boolean;
  refundedAmount?: number;
  shipments?: Array<{
    id: string;
    provider: string;
    tracking: string | null;
    status: string | null;
    createdAt: string;
  }>;
};
