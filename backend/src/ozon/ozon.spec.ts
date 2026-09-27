import { describe, expect, it } from 'vitest';
import {
  decryptOzonSecret,
  encryptOzonSecret,
  signOzonOAuthState,
  verifyOzonOAuthState,
} from './ozon-crypto';
import {
  formatOzonWorkingHours,
  nearestPointIds,
  normalizeOzonPointInfo,
} from './ozon-points.util';
import { estimateOzonDelivery, ozonBillableKg, ozonPvzTariffRub } from './ozon-tariff';

describe('ozon tariff', () => {
  it('сетка ПВЗ по оплачиваемому весу', () => {
    expect(ozonPvzTariffRub(0.3)).toBe(49);
    expect(ozonPvzTariffRub(1)).toBe(79);
    expect(ozonPvzTariffRub(4.9)).toBe(169);
    expect(ozonPvzTariffRub(50)).toBe(799);
  });

  it('пустой вариант — дефолт «средняя баночка» + упаковка, а не 0.6 кг', () => {
    // 120 г + 40 г упаковки; объём 45×45×140 мм × 1.25 ≈ 0.35 л → 0.07 кг
    expect(ozonBillableKg([{ qty: 1 }])).toBeCloseTo(0.16);
    // 2 × 1500 г + 40 г; объём 2 л × 1.25 / 5 = 0.5 кг
    expect(
      ozonBillableKg([{ qty: 2, weightGrams: 1500, lengthMm: 100, widthMm: 100, heightMm: 100 }]),
    ).toBeCloseTo(3.04);
  });

  it('курьер ×1.8 и сроки', () => {
    const line = [{ qty: 1, weightGrams: 200, lengthMm: 100, widthMm: 80, heightMm: 50 }];
    expect(estimateOzonDelivery(line, 'pvz')).toMatchObject({ cost: 49, daysMin: 3, daysMax: 6 });
    expect(estimateOzonDelivery(line, 'courier')).toMatchObject({ cost: 88, daysMin: 2 });
    expect(estimateOzonDelivery([], 'pvz')).toBeNull();
  });
});

describe('ozon crypto', () => {
  it('refresh token: round-trip и неверный ключ', () => {
    const enc = encryptOzonSecret('refresh-abc', 'secret-1');
    expect(enc).not.toContain('refresh-abc');
    expect(decryptOzonSecret(enc, 'secret-1')).toBe('refresh-abc');
    expect(decryptOzonSecret(enc, 'secret-2')).toBeNull();
    expect(decryptOzonSecret('garbage', 'secret-1')).toBeNull();
  });

  it('OAuth state: подпись, подмена, срок', () => {
    const state = signOzonOAuthState('user-1', 'jwt');
    expect(verifyOzonOAuthState(state, 'jwt')).toBe('user-1');
    expect(verifyOzonOAuthState(state, 'other')).toBeNull();
    const [body, sig] = state.split('.');
    expect(verifyOzonOAuthState(`${body}x.${sig}`, 'jwt')).toBeNull();
    expect(verifyOzonOAuthState(signOzonOAuthState('u', 'jwt', -10), 'jwt')).toBeNull();
  });
});

describe('ozon points', () => {
  it('ближайшие точки в радиусе, по возрастанию расстояния', () => {
    const center = { lat: 55.75, lon: 37.62 };
    const ids = nearestPointIds(
      [
        { map_point_id: 1, coordinate: { lat: 55.8, long: 37.62 } },
        { map_point_id: 2, coordinate: { lat: 55.751, long: 37.621 } },
        { map_point_id: 3, coordinate: { lat: 59.93, long: 30.33 } },
        { map_point_id: 4 },
      ],
      center,
      25,
      10,
    );
    expect(ids).toEqual(['2', '1']);
  });

  it('нормализует point/info и пропускает выключенные', () => {
    const p = normalizeOzonPointInfo({
      enabled: true,
      delivery_method: {
        map_point_id: 1011,
        name: 'Ozon ПВЗ',
        address: 'Москва, Тверская, 1',
        address_details: { city: 'Москва', region: 'Москва', street: 'ул. Тверская', house: '1', postal_code: '125009' },
        coordinates: { lat: 55.76, long: 37.61 },
        delivery_type: { name: 'PickPoint' },
        working_hours: [
          { date: '2026-09-25', periods: [{ min: { hours: 10, minutes: 0 }, max: { hours: 21, minutes: 0 } }] },
          { date: '2026-09-26', periods: [{ min: { hours: 10, minutes: 0 }, max: { hours: 21, minutes: 0 } }] },
        ],
      },
    });
    expect(p).toMatchObject({
      id: '1011',
      address: 'ул. Тверская, 1',
      city: 'Москва',
      postalCode: '125009',
      lat: 55.76,
      lon: 37.61,
      workingHours: 'Ежедневно 10:00–21:00',
    });
    expect(normalizeOzonPointInfo({ enabled: false, delivery_method: { map_point_id: 1 } })).toBeNull();
    expect(formatOzonWorkingHours([])).toBeNull();
  });
});
