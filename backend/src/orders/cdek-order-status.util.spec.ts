import { describe, expect, it } from 'vitest';
import {
  cdekTrackingFromEntity,
  isCdekDelivered,
  parseCdekGetOrderResponse,
} from './cdek-order-status.util';

describe('cdek-order-status.util', () => {
  it('parseCdekGetOrderResponse reads entity envelope', () => {
    const entity = parseCdekGetOrderResponse({
      entity: {
        uuid: 'u1',
        cdek_number: '1100123456',
        statuses: [{ code: 'ACCEPTED', date_time: '2026-01-01T10:00:00+03:00' }],
      },
    });
    expect(entity?.cdek_number).toBe('1100123456');
    expect(cdekTrackingFromEntity(entity)).toBe('1100123456');
  });

  it('isCdekDelivered when DELIVERED in history', () => {
    const entity = {
      statuses: [
        { code: 'ACCEPTED', date_time: '2026-01-01T10:00:00+03:00' },
        { code: 'DELIVERED', date_time: '2026-01-02T12:00:00+03:00' },
      ],
    };
    expect(isCdekDelivered(entity)).toBe(true);
  });

  it('isCdekDelivered when POSTOMAT_RECEIVED', () => {
    expect(
      isCdekDelivered({
        statuses: [{ code: 'POSTOMAT_RECEIVED', date_time: '2026-01-02T12:00:00+03:00' }],
      }),
    ).toBe(true);
  });

  it('isCdekDelivered false without delivered code', () => {
    expect(
      isCdekDelivered({
        statuses: [{ code: 'TAKEN_BY_COURIER', date_time: '2026-01-01T10:00:00+03:00' }],
      }),
    ).toBe(false);
  });
});