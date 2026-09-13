// ============================================
// Yandex Delivery + CDEK shipping types
// ============================================

// ——— Яндекс Доставка (b2b.taxi.yandex.net) ———

export interface YandexRoutePoint {
  id: number
  coordinates: [number, number] // [долгота, широта]
  fullname: string
  country: string
  city: string
  street?: string
  building?: string
  porch?: string
  sfloor?: string
  sflat?: string
}

export interface YandexCargoItem {
  size: { length: number; width: number; height: number }
  weight: number
  quantity: number
  pickup_point: number
  dropoff_point: number
}

export interface YandexOfferRequirements {
  taxi_classes: string[]
  cargo_type?: string
  cargo_loaders?: number
  pro_courier?: boolean
  cargo_options?: string[]
  skip_door_to_door?: boolean
  due?: string
  rental_duration?: number
}

export interface YandexCalculateRequest {
  items: YandexCargoItem[]
  route_points: YandexRoutePoint[]
  requirements: YandexOfferRequirements
}

export interface YandexCalculatedOfferPrice {
  total_price: string
  total_price_with_vat: string
  base_price: string
  currency: string
  surge_ratio?: number
}

export interface YandexCalculatedOffer {
  price: YandexCalculatedOfferPrice
  taxi_class: string
  description?: string
  payload: string
  offer_ttl: string
  pickup_interval?: { from: string; to: string }
  delivery_interval?: { from: string; to: string }
}

export interface YandexCalculateResponse {
  offers: YandexCalculatedOffer[]
  delivery_days?: number
  error?: string
  _pricing_source?: string
}

export interface YandexClaimCreateRequest {
  offer_payload: string
  route_points: YandexRoutePoint[]
  recipient_name: string
  recipient_phone: string
  comment?: string
}

export interface YandexClaimCreateResponse {
  id: string
  status?: string
}

export interface YandexPickupPointAddress {
  geoId?: number
  country?: string
  region?: string
  subRegion?: string
  sub_region?: string
  locality?: string
  street?: string
  house?: string
  full_address?: string
  postal_code?: string
  comment?: string
  district?: string
  area?: string
  borough?: string
  dependent_locality?: string
}

export interface YandexPickupPoint {
  id: string
  operator_station_id?: string
  operatorStationId?: string
  name: string
  type: 'pickup_point' | 'terminal' | 'warehouse'
  position?: { latitude: number; longitude: number }
  address?: YandexPickupPointAddress
  instruction?: string
  payment_methods?: string[]
  available_for_dropoff?: boolean
}

export interface YandexPickupPointsResponse {
  points: YandexPickupPoint[]
}

// ——— CDEK ———

export interface CdekAuthResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
  jti: string
}

export interface CdekCity {
  code: number
  city_uuid: string
  city: string
  fias_guid?: string
  kladr_code?: string
  country_code: string
  country: string
  region: string
  region_code?: number
  fias_region_guid?: string
  sub_region?: string
  longitude?: number
  latitude?: number
  time_zone?: string
  payment_limit?: number
}

export interface CdekRegion {
  region_code: number
  region: string
  country_code: string
  country: string
}

export interface CdekDeliveryPoint {
  code: string
  name: string
  uuid?: string
  address_comment?: string
  nearest_station?: string
  nearest_metro_station?: string
  work_time: string
  phones?: CdekPhone[]
  email?: string
  note?: string
  type: 'PVZ' | 'POSTAMAT'
  owner_code?: string
  take_only?: boolean
  is_handout?: boolean
  is_reception?: boolean
  is_dressing_room?: boolean
  have_cashless?: boolean
  have_cash?: boolean
  allowed_cod?: boolean
  site?: string
  office_image_list?: CdekOfficeImage[]
  work_time_list?: CdekWorkTime[]
  work_time_exceptions?: CdekWorkTimeException[]
  weight_min?: number
  weight_max?: number
  location: CdekLocation
  fulfillment?: boolean
  dimensions?: CdekDimensions[]
}

export interface CdekPhone {
  number: string
  additional?: string
}

export interface CdekOfficeImage {
  url: string
  number?: number
}

export interface CdekWorkTime {
  day: number
  time: string
}

export interface CdekWorkTimeException {
  date: string
  time?: string
  is_working: boolean
}

export interface CdekLocation {
  country_code: string
  region_code?: number
  region?: string
  city_code?: number
  city?: string
  fias_guid?: string
  postal_code?: string
  longitude: number
  latitude: number
  address: string
  address_full?: string
}

export interface CdekDimensions {
  width: number
  height: number
  depth: number
}

export interface CdekCalculatorRequest {
  type?: number
  date?: string
  currency?: number
  tariff_code?: number
  from_location: CdekCalculatorLocation
  to_location: CdekCalculatorLocation
  packages: CdekPackage[]
  services?: CdekService[]
}

export interface CdekCalculatorLocation {
  code?: number
  postal_code?: string
  country_code?: string
  city?: string
  address?: string
}

export interface CdekPackage {
  height: number
  length: number
  width: number
  weight: number
}

export interface CdekService {
  code: string
  parameter?: string
}

export interface CdekTariffListResponse {
  tariff_codes: CdekTariff[]
}

export interface CdekTariff {
  tariff_code: number
  tariff_name: string
  tariff_description?: string
  delivery_mode: number
  delivery_sum: number
  period_min: number
  period_max: number
  calendar_min?: number
  calendar_max?: number
}

export interface CdekTariffResponse {
  delivery_sum: number
  period_min: number
  period_max: number
  weight_calc: number
  services?: CdekServiceCost[]
  total_sum: number
  currency: string
}

export interface CdekServiceCost {
  code: string
  sum: number
}

export interface CdekOrderRequest {
  type?: number
  number?: string
  tariff_code: number
  comment?: string
  developer_key?: string
  shipment_point?: string
  delivery_point?: string
  date_invoice?: string
  shipper_name?: string
  shipper_address?: string
  delivery_recipient_cost?: CdekMoney
  delivery_recipient_cost_adv?: CdekThreshold[]
  sender?: CdekContact
  seller?: CdekSeller
  recipient: CdekContact
  from_location?: CdekOrderLocation
  to_location: CdekOrderLocation
  packages: CdekOrderPackage[]
  services?: CdekService[]
  print?: string
}

export interface CdekMoney {
  value: number
  vat_sum?: number
  vat_rate?: number
}

export interface CdekThreshold {
  threshold: number
  sum: number
  vat_sum?: number
  vat_rate?: number
}

export interface CdekContact {
  company?: string
  name: string
  email?: string
  phones: CdekPhone[]
  passport_series?: string
  passport_number?: string
  passport_date_of_issue?: string
  passport_organization?: string
  tin?: string
  passport_date_of_birth?: string
  contragent_type?: string
}

export interface CdekSeller {
  name?: string
  inn?: string
  phone?: string
  ownership_form?: number
  address?: string
}

export interface CdekOrderLocation {
  code?: number
  fias_guid?: string
  postal_code?: string
  longitude?: number
  latitude?: number
  country_code?: string
  region?: string
  region_code?: number
  sub_region?: string
  city?: string
  kladr_code?: string
  address: string
}

export interface CdekOrderPackage {
  number: string
  weight: number
  length?: number
  width?: number
  height?: number
  comment?: string
  items: CdekOrderItem[]
}

export interface CdekOrderItem {
  name: string
  ware_key: string
  payment: CdekMoney
  cost: number
  weight: number
  weight_gross?: number
  amount: number
  delivery_amount?: number
  name_i18n?: string
  brand?: string
  country_code?: string
  material?: number
  wifi_gsm?: boolean
  url?: string
}

export interface CdekOrderResponse {
  entity?: {
    uuid: string
    is_return?: boolean
    is_reverse?: boolean
    type?: number
    cdek_number?: string
    number?: string
  }
  requests: CdekRequestStatus[]
}

export interface CdekRequestStatus {
  request_uuid: string
  type: string
  state: 'ACCEPTED' | 'WAITING' | 'SUCCESSFUL' | 'INVALID'
  date_time: string
  errors?: CdekError[]
  warnings?: CdekWarning[]
}

export interface CdekError {
  code: string
  message: string
}

export interface CdekWarning {
  code: string
  message: string
}

export interface CdekOrderInfo {
  entity: {
    uuid: string
    is_return: boolean
    is_reverse: boolean
    type: number
    cdek_number?: string
    number?: string
    tariff_code: number
    comment?: string
    shipment_point?: string
    delivery_point?: string
    items_cost_currency?: string
    recipient_currency?: string
    date_invoice?: string
    shipper_name?: string
    shipper_address?: string
    delivery_recipient_cost?: CdekMoney
    sender?: CdekContact
    seller?: CdekSeller
    recipient: CdekContact
    from_location?: CdekOrderLocation
    to_location: CdekOrderLocation
    packages: CdekOrderPackageInfo[]
    delivery_detail?: CdekDeliveryDetail
    statuses?: CdekOrderStatus[]
  }
  requests: CdekRequestStatus[]
}

export interface CdekOrderPackageInfo extends CdekOrderPackage {
  package_id?: string
  barcode?: string
}

export interface CdekDeliveryDetail {
  date?: string
  recipient_name?: string
  payment_sum?: number
  delivery_sum?: number
  total_sum?: number
}

export interface CdekOrderStatus {
  code: string
  name: string
  date_time: string
  reason_code?: string
  city?: string
}

export interface CdekOrderUpdateRequest {
  uuid: string
  cdek_number?: string
  tariff_code?: number
  comment?: string
  shipment_point?: string
  delivery_point?: string
  sender?: CdekContact
  recipient?: CdekContact
  from_location?: CdekOrderLocation
  to_location?: CdekOrderLocation
  packages?: CdekOrderPackage[]
}

export interface CdekDeleteResponse {
  entity: {
    uuid: string
  }
  requests: CdekRequestStatus[]
}

export interface CdekRefusalResponse {
  entity: {
    uuid: string
  }
  requests: CdekRequestStatus[]
}

export const CDEK_TARIFFS = {
  COURIER_TO_DOOR: 139,
  WAREHOUSE_TO_DOOR: 137,
  WAREHOUSE_TO_PVZ: 136,
  DOOR_TO_PVZ: 138,
  EXPRESS_DOOR: 184,
  EXPRESS_PVZ: 366,
  ECONOMY_PVZ: 234,
  ECONOMY_DOOR: 233,
  /** Фулфилмент СДЭК — не для обычных отправлений с ПВЗ MSK12. */
  FULFILLMENT_WAREHOUSE: 358,
} as const

/** Не участвуют в расчёте checkout / server reprice. */
export const CDEK_EXCLUDED_TARIFF_CODES: ReadonlySet<number> = new Set([
  CDEK_TARIFFS.FULFILLMENT_WAREHOUSE,
])

export type CdekTariffCode = (typeof CDEK_TARIFFS)[keyof typeof CDEK_TARIFFS]
