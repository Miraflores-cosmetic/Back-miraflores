// ============================================
// CDEK API — клиентская библиотека (BFF /api/cdek/service)
// ============================================

import {
  CdekCity,
  CdekDeliveryPoint,
  CdekCalculatorRequest,
  CdekTariffListResponse,
  CdekTariffResponse,
  CdekOrderRequest,
  CdekOrderResponse,
  CdekOrderInfo,
  CdekOrderUpdateRequest,
  CdekDeleteResponse,
  CdekRefusalResponse,
  CDEK_EXCLUDED_TARIFF_CODES,
  CDEK_TARIFFS,
} from '@/lib/shipping/types'

const API_BASE = '/api/cdek/service'

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_API_URL || ''
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(errorData.error || `HTTP Error: ${response.status}`)
  }
  return response.json()
}

/**
 * Получить список городов
 * GET /v2/location/cities
 */
export async function getCities(params?: {
  country_codes?: string
  region_code?: number
  fias_region_guid?: string
  city?: string
  postal_code?: string
  code?: number
  size?: number
  page?: number
}): Promise<CdekCity[]> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)
  url.searchParams.set('method', 'location/cities')

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    })
  }

  const response = await fetch(url.toString())
  return handleResponse<CdekCity[]>(response)
}

/**
 * Получить список пунктов выдачи
 * GET /v2/deliverypoints
 */
export async function getDeliveryPoints(params: {
  city_code?: number
  city_uuid?: string
  postal_code?: string
  type?: 'PVZ' | 'POSTAMAT' | 'ALL'
  country_code?: string
  region_code?: number
  is_handout?: boolean
  is_reception?: boolean
  is_dressing_room?: boolean
  have_cashless?: boolean
  have_cash?: boolean
  allowed_cod?: boolean
  weight_max?: number
  size?: number
  page?: number
  latitude?: number
  longitude?: number
  radius?: number
}): Promise<CdekDeliveryPoint[]> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)
  url.searchParams.set('action', 'offices')

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  })

  const response = await fetch(url.toString())
  return handleResponse<CdekDeliveryPoint[]>(response)
}

/**
 * Расчет по всем доступным тарифам
 * POST /v2/calculator/tarifflist
 */
export async function calculateTariffList(
  request: CdekCalculatorRequest,
): Promise<CdekTariffListResponse> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'calculator/tarifflist',
      data: request,
    }),
  })

  return handleResponse<CdekTariffListResponse>(response)
}

/**
 * Расчет по конкретному тарифу
 * POST /v2/calculator/tariff
 */
export async function calculateTariff(
  request: CdekCalculatorRequest & { tariff_code: number },
): Promise<CdekTariffResponse> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'calculator/tariff',
      data: request,
    }),
  })

  return handleResponse<CdekTariffResponse>(response)
}

/**
 * Быстрый расчет доставки для корзины
 */
export async function calculateDelivery(params: {
  fromCityCode: number
  toCityCode: number
  weight: number // в граммах
  length?: number
  width?: number
  height?: number
  tariffCode?: number
}): Promise<{
  tariffs: CdekTariffListResponse['tariff_codes']
  cheapest?: CdekTariffListResponse['tariff_codes'][0]
  fastest?: CdekTariffListResponse['tariff_codes'][0]
}> {
  const request: CdekCalculatorRequest = {
    type: 1,
    currency: 1,
    from_location: { code: params.fromCityCode },
    to_location: { code: params.toCityCode },
    packages: [
      {
        weight: params.weight,
        length: params.length || 20,
        width: params.width || 20,
        height: params.height || 10,
      },
    ],
  }

  const result = await calculateTariffList(request)

  const tariffs = (result.tariff_codes || []).filter(
    (t) => !CDEK_EXCLUDED_TARIFF_CODES.has(t.tariff_code),
  )
  const cheapest = tariffs.length
    ? tariffs.reduce((min, t) => (t.delivery_sum < min.delivery_sum ? t : min), tariffs[0])
    : undefined
  const fastest = tariffs.length
    ? tariffs.reduce((min, t) => (t.period_min < min.period_min ? t : min), tariffs[0])
    : undefined

  return { tariffs, cheapest, fastest }
}

/**
 * Создать заказ на доставку
 * POST /v2/orders
 */
export async function createOrder(request: CdekOrderRequest): Promise<CdekOrderResponse> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'orders',
      data: request,
    }),
  })

  return handleResponse<CdekOrderResponse>(response)
}

/**
 * Получить информацию о заказе по UUID
 * GET /v2/orders/{uuid}
 */
export async function getOrder(uuid: string): Promise<CdekOrderInfo> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)
  url.searchParams.set('action', 'order')
  url.searchParams.set('uuid', uuid)

  const response = await fetch(url.toString())
  return handleResponse<CdekOrderInfo>(response)
}

/**
 * Изменить заказ
 * PATCH /v2/orders
 */
export async function updateOrder(request: CdekOrderUpdateRequest): Promise<CdekOrderResponse> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)

  const response = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'orders',
      data: request,
    }),
  })

  return handleResponse<CdekOrderResponse>(response)
}

/**
 * Удалить заказ
 * DELETE /v2/orders/{uuid}
 */
export async function deleteOrder(uuid: string): Promise<CdekDeleteResponse> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)
  url.searchParams.set('action', 'delete-order')
  url.searchParams.set('uuid', uuid)

  const response = await fetch(url.toString(), {
    method: 'DELETE',
  })

  return handleResponse<CdekDeleteResponse>(response)
}

/**
 * Зарегистрировать отказ от заказа
 * POST /v2/orders/{uuid}/refusal
 */
export async function refuseOrder(uuid: string): Promise<CdekRefusalResponse> {
  const url = new URL(`${getBaseUrl()}${API_BASE}`)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'refusal',
      uuid,
    }),
  })

  return handleResponse<CdekRefusalResponse>(response)
}

/**
 * Создать заказ для интернет-магазина (упрощенный интерфейс)
 */
export async function createShopOrder(params: {
  orderNumber: string
  tariffCode?: number
  deliveryPointCode?: string
  recipient: {
    name: string
    phone: string
    email?: string
  }
  address: {
    cityCode: number
    address: string
    postalCode?: string
  }
  items: Array<{
    name: string
    sku: string
    price: number
    weight: number
    quantity: number
  }>
  comment?: string
}): Promise<CdekOrderResponse> {
  const totalWeight = params.items.reduce((sum, item) => sum + item.weight * item.quantity, 0)

  const request: CdekOrderRequest = {
    type: 1,
    number: params.orderNumber,
    tariff_code: params.tariffCode || CDEK_TARIFFS.WAREHOUSE_TO_PVZ,
    comment: params.comment,
    delivery_point: params.deliveryPointCode,
    recipient: {
      name: params.recipient.name,
      phones: [{ number: params.recipient.phone }],
      email: params.recipient.email,
    },
    to_location: {
      code: params.address.cityCode,
      address: params.address.address,
      postal_code: params.address.postalCode,
    },
    packages: [
      {
        number: `${params.orderNumber}-1`,
        weight: totalWeight,
        items: params.items.map((item) => ({
          name: item.name,
          ware_key: item.sku,
          payment: { value: 0 },
          cost: item.price,
          weight: item.weight,
          amount: item.quantity,
        })),
      },
    ],
  }

  return createOrder(request)
}

export { CDEK_TARIFFS }
