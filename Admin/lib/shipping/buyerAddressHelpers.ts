import type { ShippingSelection } from '@/components/shipping/ShippingCarrierModal';
import { formatPhoneE164 } from '@/lib/phone';
import {
  buildJcosAddress2WithMeta,
  getJcosDeliveryDisplayMode,
  jcosCarrierDisplayName,
  parseJcosAddressMeta,
} from '@/lib/shipping/addressShippingMeta';

/** Поля адреса ЛК / DTO без служебных timestamps. */
export type BuyerAddressFields = {
  recipientName?: string | null;
  phone?: string | null;
  city: string;
  address: string;
  apartment?: string | null;
  postalCode?: string | null;
  comment?: string | null;
};

export type AddressApiPayload = {
  recipientName: string | null;
  phone: string | null;
  city: string;
  address: string;
  apartment: string | null;
  postalCode: string | null;
  comment: string;
  isDefault?: boolean;
};

export function formatAddressLine(a: {
  city: string;
  address: string;
  apartment?: string | null;
  postalCode?: string | null;
}): string {
  return [
    a.city,
    a.address,
    a.apartment ? `кв./оф. ${a.apartment}` : null,
    a.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Локация для карточки доставки (перевозчик — в buyerDeliveryTitle). */
export function formatBuyerDeliveryLine(a: BuyerAddressFields): string {
  return formatAddressLine(a);
}

export function buyerDeliveryTitle(
  a: Pick<BuyerAddressFields, 'recipientName' | 'comment'>,
): string {
  const { meta } = parseJcosAddressMeta(a.comment ?? '');
  if (meta) {
    const carrier = jcosCarrierDisplayName(meta.carrier);
    const { mode } = getJcosDeliveryDisplayMode(a.comment);
    return `${carrier}, ${mode === 'pvz' ? 'ПВЗ' : 'Курьер'}`;
  }
  return a.recipientName?.trim() || 'Доставка';
}

/** ShippingCarrierModal → тело POST/PATCH /api/account/addresses. */
export function shippingSelectionToAddressPayload(
  selection: ShippingSelection,
  opts?: { isDefault?: boolean },
): AddressApiPayload {
  const payload: AddressApiPayload = {
    recipientName: selection.recipientName.trim() || null,
    phone: selection.phone.trim()
      ? formatPhoneE164(selection.phone.trim())
      : null,
    city: selection.city.trim(),
    address: selection.address.trim(),
    apartment: selection.apartment.trim() || null,
    postalCode: selection.postalCode.trim() || null,
    comment: buildJcosAddress2WithMeta(
      {
        carrier: selection.carrier,
        dropoff: selection.dropoff,
        ...(selection.lat != null ? { lat: selection.lat } : {}),
        ...(selection.lon != null ? { lon: selection.lon } : {}),
        ...(selection.pvzId ? { pvzId: selection.pvzId } : {}),
      },
      selection.comment,
    ),
  };
  if (opts?.isDefault != null) payload.isDefault = opts.isDefault;
  return payload;
}

/** Адрес ЛК → seed для ShippingCarrierModal. */
export function addressToShippingSeed(
  a: BuyerAddressFields,
): Partial<
  Pick<
    ShippingSelection,
    | 'recipientName'
    | 'phone'
    | 'city'
    | 'address'
    | 'apartment'
    | 'postalCode'
    | 'comment'
    | 'region'
    | 'district'
    | 'carrier'
    | 'dropoff'
    | 'lat'
    | 'lon'
    | 'pvzId'
  >
> {
  const { meta, comment } = parseJcosAddressMeta(a.comment ?? '');
  const mode = getJcosDeliveryDisplayMode(a.comment);
  return {
    recipientName: a.recipientName ?? '',
    phone: a.phone ?? '',
    city: a.city,
    address: a.address,
    apartment: a.apartment ?? '',
    postalCode: a.postalCode ?? '',
    comment,
    ...(meta
      ? {
          carrier: meta.carrier,
          dropoff: meta.dropoff ?? mode.mode,
          lat: meta.lat,
          lon: meta.lon,
          pvzId: meta.pvzId,
        }
      : {}),
  };
}
