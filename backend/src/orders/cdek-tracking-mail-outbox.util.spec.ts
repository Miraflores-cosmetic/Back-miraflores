import { describe, expect, it } from 'vitest';
import {
  isTrackingMailSettled,
  parseCdekTrackingMailMeta,
} from './cdek-tracking-mail-outbox.util';

describe('cdek-tracking-mail-outbox.util', () => {
  it('pending не settled, sent settled', () => {
    expect(
      isTrackingMailSettled({
        source: 'cdek_sync',
        tracking: '1',
        mailStatus: 'pending',
      }),
    ).toBe(false);
    expect(
      isTrackingMailSettled({
        source: 'cdek_sync',
        tracking: '1',
        mailStatus: 'sent',
      }),
    ).toBe(true);
  });

  it('legacy TRACKING_SENT { tracking } — settled', () => {
    expect(isTrackingMailSettled({ tracking: '1' })).toBe(true);
  });

  it('admin_manual failed — не settled', () => {
    expect(
      isTrackingMailSettled({
        tracking: '1',
        source: 'admin_manual',
        mailStatus: 'failed',
      }),
    ).toBe(false);
  });

  it('parse meta', () => {
    const m = parseCdekTrackingMailMeta({
      source: 'cdek_sync',
      tracking: '1100',
      mailStatus: 'failed',
    });
    expect(m?.mailStatus).toBe('failed');
  });
});