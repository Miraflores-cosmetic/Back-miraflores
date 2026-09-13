import type { CdekTariff } from '@/lib/shipping/types'
import {
  CDEK_EXCLUDED_TARIFF_CODES,
  CDEK_TARIFFS,
} from '@/lib/shipping/types'

function withoutExcluded(tariffs: CdekTariff[]): CdekTariff[] {
  return tariffs.filter((t) => !CDEK_EXCLUDED_TARIFF_CODES.has(t.tariff_code))
}

/**
 * Тарифы СДЭК с доставкой до пункта выдачи (склад/дверь отправителя → ПВЗ/постамат).
 * См. contract CDEK: 136 стандарт ИМ, 234 эконом, 366 экспресс, 138 дверь→ПВЗ.
 */
const PVZ_TARIFF_CODES = new Set<number>([
  CDEK_TARIFFS.WAREHOUSE_TO_PVZ,
  CDEK_TARIFFS.ECONOMY_PVZ,
  CDEK_TARIFFS.EXPRESS_PVZ,
  CDEK_TARIFFS.DOOR_TO_PVZ,
])

/** Если СДЭК вернёт новые коды тарифов до ПВЗ — подстраховка по названию. */
function looksLikeDeliveryToPickup(t: CdekTariff): boolean {
  if (PVZ_TARIFF_CODES.has(t.tariff_code)) return true
  const name = `${t.tariff_name || ''} ${t.tariff_description || ''}`.toLowerCase()
  if (name.includes('пвз') || name.includes('постамат') || name.includes('склад получ')) {
    return true
  }
  return false
}

export function filterCdekPvzTariffs(tariffs: CdekTariff[]): CdekTariff[] {
  const eligible = withoutExcluded(tariffs)
  if (!eligible.length) return []
  const byCode = eligible.filter((t) => PVZ_TARIFF_CODES.has(t.tariff_code))
  if (byCode.length > 0) return byCode
  const heuristic = eligible.filter(looksLikeDeliveryToPickup)
  return heuristic.length > 0 ? heuristic : eligible
}

/**
 * Тарифы СДЭК с доставкой курьером до двери (склад отправителя → адрес получателя).
 */
const COURIER_TARIFF_CODES = new Set<number>([
  CDEK_TARIFFS.WAREHOUSE_TO_DOOR,
  CDEK_TARIFFS.ECONOMY_DOOR,
  CDEK_TARIFFS.EXPRESS_DOOR,
  CDEK_TARIFFS.COURIER_TO_DOOR,
])

function looksLikeCourierToDoor(t: CdekTariff): boolean {
  if (COURIER_TARIFF_CODES.has(t.tariff_code)) return true
  const name = `${t.tariff_name || ''} ${t.tariff_description || ''}`.toLowerCase()
  if (name.includes('дверь') && !name.includes('пвз') && !name.includes('постамат')) {
    return true
  }
  return false
}

export function filterCdekCourierTariffs(tariffs: CdekTariff[]): CdekTariff[] {
  const eligible = withoutExcluded(tariffs)
  if (!eligible.length) return []
  const byCode = eligible.filter((t) => COURIER_TARIFF_CODES.has(t.tariff_code))
  if (byCode.length > 0) return byCode
  const heuristic = eligible.filter(looksLikeCourierToDoor)
  return heuristic.length > 0 ? heuristic : eligible
}
