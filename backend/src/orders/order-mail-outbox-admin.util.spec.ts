import { describe, expect, it } from 'vitest';
import { summarizeAdminOrderMailOutbox } from './order-mail-outbox-admin.util';

describe('summarizeAdminOrderMailOutbox', () => {
  it('показывает failed tracking', () => {
    const s = summarizeAdminOrderMailOutbox([
      {
        type: 'TRACKING_SENT',
        meta: {
          source: 'cdek_sync',
          tracking: 'T1',
          mailStatus: 'failed',
          attempt: 3,
          nextRetryAt: '2099-01-01T00:00:00.000Z',
          lastError: 'smtp failed',
        },
      },
    ]);
    expect(s.tracking).toMatchObject({ mailStatus: 'failed', attempt: 3 });
    expect(s.delivered).toBeNull();
  });
});