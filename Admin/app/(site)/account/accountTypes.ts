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
  /** Неоплаченный заказ: можно открыть виджет ЮKassa */
  canPay?: boolean;
  payToken?: string | null;
  /**
   * Legacy: раньше дедлайн оплаты (= TTL авто-отмены).
   * Авто-отмена отключена — API отдаёт null; поле не гейтит оплату.
   */
  payExpiresAt?: string | null;
};

/** UI: оплата пока бэкенд canPay (AWAITING_PAYMENT / NEW). Без TTL cutoff. */
export function buyerOrderCanPayNow(order: { canPay?: boolean }): boolean {
  return Boolean(order.canPay);
}

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
  /** Legacy; не гейтит оплату (см. BuyerOrder). */
  payExpiresAt?: string | null;
  canPay?: boolean;
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
