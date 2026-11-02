import type { ShippingSelection } from '@/components/shipping/ShippingCarrierModal';

export const ORDER_CREATE_STEPS = [
  { id: 1, label: 'Клиент' },
  { id: 2, label: 'Состав' },
  { id: 3, label: 'Скидки' },
  { id: 4, label: 'Доставка' },
  { id: 5, label: 'Подтверждение' },
] as const;

export type OrderCreateStepId = (typeof ORDER_CREATE_STEPS)[number]['id'];

export type PayMode = 'awaiting_link' | 'mark_paid' | 'awaiting';

export type ClientMode = 'user' | 'guest';

export type DraftLine = {
  key: string;
  variantId: string;
  shadeId: string | null;
  shadeName: string | null;
  title: string;
  sku: string;
  catalogPrice: number;
  unitPrice: number;
  qty: number;
  imageUrl?: string | null;
};

export type ShippingDraft = {
  selection: ShippingSelection;
  shippingCost: number;
  shippingMethod: 'CDEK' | 'YANDEX' | 'OZON';
  address: {
    city: string;
    address: string;
    apartment: string;
    region: string;
    district: string;
    postalCode: string;
    phone: string;
    recipientName: string;
    pvzCode: string;
    comment: string;
  };
};

export type AdminOrderPreview = {
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount: number;
  shippingCost: number;
  total: number;
  promoCode: string | null;
  giftCertificateCode: string | null;
  gratitudeCount: number;
  gratitudeItems?: Array<{ title: string; qty: number }>;
  priceOverrides: Array<{
    variantId: string;
    catalogPrice: number;
    unitPrice: number;
    qty: number;
  }>;
  lines: Array<{
    variantId: string;
    title: string;
    qty: number;
    unitPrice: number;
    catalogPrice: number;
    lineTotal: number;
  }>;
};
