/**
 * Best-effort расчёт стоимости доставки для checkout (подсказка в summary).
 * При ошибке / отсутствии тарифа возвращает null — не маскируем как 0 ₽.
 */

import {
  cleanRuPostalCode,
  pickCdekCityForAddress,
} from '@/lib/shipping/cdekCityPick';
import {
  calculateDelivery as calculateCdekDelivery,
  getCities,
} from '@/lib/shipping/cdek';
import {
  filterCdekCourierTariffs,
  filterCdekPvzTariffs,
} from '@/lib/shipping/cdekPvzTariffs';
import { CDEK_ORIGIN_CITY_CODE } from '@/lib/shipping/cdekOrigin';
import type { ShippingSelection } from '@/components/shipping/ShippingCarrierModal';
import {
  calculateDelivery as calculateYandexDelivery,
  getCheapestOffer,
  parseYandexOfferPrice,
} from '@/lib/shipping/yandexDelivery';

const DEFAULT_WEIGHT_G = 2000;

export async function estimateShippingCostRub(
  selection: ShippingSelection,
): Promise<number | null> {
  try {
    if (selection.carrier === 'yandex') {
      const usePvz = selection.dropoff === 'pvz' && Boolean(selection.pvzId?.trim());
      const coords =
        selection.lon != null &&
        selection.lat != null &&
        Number.isFinite(selection.lon) &&
        Number.isFinite(selection.lat)
          ? ([selection.lon, selection.lat] as [number, number])
          : undefined;
      const res = await calculateYandexDelivery({
        city: selection.city.trim(),
        fullname: selection.address.trim(),
        coordinates: coords,
        mode: usePvz ? 'pvz' : 'door',
        ...(usePvz && selection.pvzId
          ? { yandexPointId: selection.pvzId.trim() }
          : {}),
      });
      const allOffers = res.offers || [];
      const positive = allOffers.filter(
        (o) => parseYandexOfferPrice(o.price?.total_price) > 0,
      );
      const cheapest = getCheapestOffer(
        positive.length > 0 ? positive : allOffers,
      );
      if (cheapest?.price?.total_price != null) {
        const sum = parseYandexOfferPrice(cheapest.price.total_price);
        return sum > 0 ? Math.round(sum) : null;
      }
      return null;
    }

    // CDEK
    const cityQuery = selection.city.trim();
    if (!cityQuery) return null;
    const postal = cleanRuPostalCode(selection.postalCode);
    let cities = await getCities({
      city: cityQuery,
      country_codes: 'RU',
      size: 40,
      ...(postal ? { postal_code: postal } : {}),
    });
    if ((!cities || cities.length === 0) && postal) {
      cities = await getCities({
        city: cityQuery,
        country_codes: 'RU',
        size: 40,
      });
    }
    const picked = cities?.length
      ? pickCdekCityForAddress({ city: cityQuery }, cities)
      : null;
    if (!picked) return null;

    const { tariffs } = await calculateCdekDelivery({
      fromCityCode: CDEK_ORIGIN_CITY_CODE,
      toCityCode: picked.code,
      weight: DEFAULT_WEIGHT_G,
    });
    const filtered =
      selection.dropoff === 'courier'
        ? filterCdekCourierTariffs(tariffs)
        : filterCdekPvzTariffs(tariffs);
    if (!filtered.length) return null;
    const cheapest = filtered.reduce((min, t) =>
      t.delivery_sum < min.delivery_sum ? t : min,
    );
    return cheapest.delivery_sum > 0 ? Math.round(cheapest.delivery_sum) : null;
  } catch {
    return null;
  }
}
