import { OrderStatus, Prisma, ShipmentProvider } from '@prisma/client';

/**
 * Операционные флаги заказов Ozon для списка в админке:
 * - ozon_no_track — оплачен/в работе, но номера отправления Ozon ещё нет (ждёт оформления в кабинете);
 * - ozon_no_cost — отправлен Ozon, но факт стоимости из кабинета не внесён (нужен для сверки тарифа).
 */
export const OZON_FLAG_FILTERS = ['ozon_no_track', 'ozon_no_cost'] as const;
export type OzonFlagFilter = (typeof OZON_FLAG_FILTERS)[number];

export function parseOzonFlagFilter(raw?: string | null): OzonFlagFilter | null {
  const v = raw?.trim().toLowerCase();
  return (OZON_FLAG_FILTERS as readonly string[]).includes(v ?? '') ? (v as OzonFlagFilter) : null;
}

const NEEDS_TRACK_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];
const SHIPPED_STATUSES: OrderStatus[] = [OrderStatus.SHIPPED, OrderStatus.DELIVERED];

const OZON_ORDER: Prisma.OrderWhereInput = {
  OR: [
    { shippingMethod: ShipmentProvider.OZON },
    { shipments: { some: { provider: ShipmentProvider.OZON } } },
  ],
};

const HAS_TRACK: Prisma.ShipmentWhereInput = {
  AND: [{ tracking: { not: null } }, { NOT: { tracking: '' } }],
};

export function ozonFlagWhere(flag: OzonFlagFilter): Prisma.OrderWhereInput {
  if (flag === 'ozon_no_track') {
    return {
      AND: [OZON_ORDER, { status: { in: NEEDS_TRACK_STATUSES } }, { shipments: { none: HAS_TRACK } }],
    };
  }
  return {
    AND: [
      { status: { in: SHIPPED_STATUSES } },
      { shipments: { some: { provider: ShipmentProvider.OZON } } },
      { shipments: { none: { provider: ShipmentProvider.OZON, carrierCostRub: { not: null } } } },
    ],
  };
}

export type OzonRowFlags = { noTrack: boolean; noCost: boolean };

/** Те же правила, что в ozonFlagWhere, — для бейджей строки списка. */
export function ozonRowFlags(row: {
  status: OrderStatus;
  shippingMethod: ShipmentProvider | null;
  shipments: Array<{ provider: ShipmentProvider; tracking: string | null; carrierCostRub: number | null }>;
}): OzonRowFlags | null {
  const ozonShipments = row.shipments.filter((s) => s.provider === ShipmentProvider.OZON);
  if (row.shippingMethod !== ShipmentProvider.OZON && !ozonShipments.length) return null;
  const hasTrack = row.shipments.some((s) => Boolean(s.tracking?.trim()));
  return {
    noTrack: NEEDS_TRACK_STATUSES.includes(row.status) && !hasTrack,
    noCost:
      SHIPPED_STATUSES.includes(row.status) &&
      ozonShipments.length > 0 &&
      !ozonShipments.some((s) => s.carrierCostRub != null),
  };
}
