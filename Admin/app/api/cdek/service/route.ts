import { NextRequest, NextResponse } from 'next/server'

// ============================================
// CONFIG
// ============================================

const CDEK_API_URL = 'https://api.cdek.ru/v2'
const CDEK_ACCOUNT = process.env.CDEK_ACCOUNT!
const CDEK_SECURE = process.env.CDEK_SECURE!

// ============================================
// TOKEN CACHE
// ============================================

let cachedToken: string | null = null
let tokenExpiry = 0

async function getCdekToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(`${CDEK_API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CDEK_ACCOUNT,
        client_secret: CDEK_SECURE,
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!res.ok) throw new Error(await res.text())

    const data = await res.json()
    if (!data.access_token || typeof data.access_token !== 'string') {
      throw new Error('Invalid token response from CDEK API')
    }

    const token: string = data.access_token
    cachedToken = token
    tokenExpiry = Date.now() + data.expires_in * 1000

    return token
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================
// SAFE REQUEST WITH TIMEOUT
// ============================================

async function cdekRequest(endpoint: string, options: {
  method?: string
  body?: any
  params?: Record<string, any>
} = {}) {
  const token = await getCdekToken()

  const url = new URL(`${CDEK_API_URL}/${endpoint}`)
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    return await fetch(url.toString(), {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================
// RESPONSE
// ============================================

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// ============================================
// CITIES CACHE (24H)
// ============================================

let citiesCache: any[] | null = null
let citiesCacheTime = 0

// ============================================
// GET
// ============================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const method = searchParams.get('method')
  const action = searchParams.get('action')

  try {
    // ✅ CITIES WITH CACHE
    if (method === 'location/cities') {
      const cityFilter = searchParams.get('city')?.toLowerCase()

      // Если кеш есть и нужна фильтрация — фильтруем из кеша
      if (citiesCache && Date.now() - citiesCacheTime < 86400000) {
        if (cityFilter) {
          const filtered = citiesCache.filter((c: any) =>
            c.city?.toLowerCase().includes(cityFilter)
          )
          return json(filtered)
        }
        return json(citiesCache)
      }

      const res = await cdekRequest('location/cities', {
        params: {
          size: 10000,
          country_codes: searchParams.get('country_codes') || 'RU',
        },
      })

      const data = await res.json()
      const list = Array.isArray(data) ? data : data.items || []

      citiesCache = list
      citiesCacheTime = Date.now()

      if (cityFilter) {
        const filtered = list.filter((c: any) =>
          c.city?.toLowerCase().includes(cityFilter)
        )
        return json(filtered)
      }

      return json(list)
    }

    // ✅ DELIVERY POINTS
    if (method === 'deliverypoints' || action === 'offices') {
      return handleDeliveryPoints(searchParams)
    }

    // ✅ ORDERS (read) — только через Nest admin register-carrier / кабинет СДЭК
    if (action === 'order') {
      return json(
        {
          error:
            'Чтение заказа СДЭК через публичный BFF отключено. Используйте админку заказов.',
        },
        403,
      )
    }

    return json({ error: 'Unknown request' }, 400)
  } catch (e) {
    console.error('GET ERROR', e)
    return json({ error: 'Server error' }, 500)
  }
}

// ============================================
// DELIVERY POINTS (PARALLEL + FAST)
// ============================================

async function handleDeliveryPoints(searchParams: URLSearchParams) {
  const cityCode = searchParams.get('city_code')
  const cityUuid = searchParams.get('city_uuid')
  const latitude = searchParams.get('latitude')
  const longitude = searchParams.get('longitude')
  const radius = searchParams.get('radius')
  const size = Number(searchParams.get('size') || 150)

  // Если нет ни города, ни координат — возвращаем пустоту
  if (!cityCode && !cityUuid && !(latitude && longitude)) return json([])

  const requests: Promise<Response>[] = []

  // 1. Поиск по коду города (приоритет для Москвы и некоторых других)
  if (cityCode) {
    requests.push(cdekRequest('deliverypoints', { params: { city_code: cityCode, size } }))
    requests.push(cdekRequest('deliverypoints', { params: { city_code: cityCode, type: 'PVZ', size } }))
    requests.push(cdekRequest('deliverypoints', { params: { city_code: cityCode, type: 'POSTAMAT', size } }))
  }

  // 2. Поиск по UUID города (приоритет для ЕКБ и многих региональных городов)
  // ВАЖНО: Делаем ОТДЕЛЬНЫМ запросом, так как совмещение с city_code может давать 0
  if (cityUuid) {
    requests.push(cdekRequest('deliverypoints', { params: { city_uuid: cityUuid, size } }))
  }

  // 3. Поиск по координатам (только если переданы и нет кодов города, либо как фоллбек)
  // Примечание: API СДЭК v2 официально требует radius при передаче координат
  if (latitude && longitude) {
    requests.push(cdekRequest('deliverypoints', {
      params: {
        latitude,
        longitude,
        radius: radius || 50,
        size
      }
    }))
  }

  const results = await Promise.allSettled(requests)
  const all: any[] = []

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      const data = await r.value.json()
      const list = Array.isArray(data) ? data : data.items || []
      all.push(...list)
    }
  }

  // Дедупликация по коду или UUID самого ПВЗ
  const uniq = new Map()
  for (const p of all) {
    const key = p.code || p.uuid
    if (key) uniq.set(key, p)
  }

  return json([...uniq.values()])
}

// ============================================
// POST / PATCH / DELETE (ОСТАВЛЕНЫ)
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = body.action as string
    const data = body.data

    // Калькулятор тарифов (список всех доступных)
    if (action === 'calculator/tarifflist') {
      const res = await cdekRequest('calculator/tarifflist', {
        method: 'POST',
        body: data,
      })
      const result = await res.json()
      console.log('CDEK calculator/tarifflist result:', JSON.stringify(result).slice(0, 500))
      return json(result, res.status)
    }

    // Калькулятор конкретного тарифа
    if (action === 'calculator/tariff') {
      const res = await cdekRequest('calculator/tariff', {
        method: 'POST',
        body: data,
      })
      const result = await res.json()
      return json(result, res.status)
    }

    // Создание / отказ — только Nest CarrierShipmentService (admin JWT)
    if (action === 'orders' || action === 'refusal') {
      return json(
        {
          error:
            'Создание и отказ заказа СДЭК через публичный BFF отключены. Используйте «Создать в СДЭК» в карточке заказа.',
        },
        403,
      )
    }

    return json({ error: 'Unknown POST action' }, 400)
  } catch (e) {
    console.error('CDEK POST ERROR', e)
    return json({ error: 'Server error' }, 500)
  }
}

export async function PATCH() {
  return json({ ok: true })
}

export async function DELETE() {
  return json({ ok: true })
}
