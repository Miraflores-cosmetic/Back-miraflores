import { describe, expect, it } from 'vitest';
import {
  isDeliveredMailSettled,
  parseCdekDeliveredMailMeta,
} from './cdek-delivered-mail-outbox.util';

describe('cdek-delivered-mail-outbox.util', () => {
  it('pending не settled', () => {
    expect(
      isDeliveredMailSettled({
        source: 'cdek_sync',
        cdekStatus: 'DELIVERED',
        from: 'SHIPPED',
        to: 'DELIVERED',
        mailStatus: 'pending',
      }),
    ).toBe(false);
  });

  it('ручной DELIVERED без source — settled', () => {
    expect(
      isDeliveredMailSettled({ from: 'SHIPPED', to: 'DELIVERED' }),
    ).toBe(true);
  });

  it('parse meta', () => {
    const m = parseCdekDeliveredMailMeta({
      source: 'cdek_sync',
      cdekStatus: 'POSTOMAT_RECEIVED',
      from: 'SHIPPED',
      to: 'DELIVERED',
      mailStatus: 'failed',
    });
    expect(m?.cdekStatus).toBe('POSTOMAT_RECEIVED');
  });
});