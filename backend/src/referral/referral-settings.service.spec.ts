import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralSettingsService } from './referral-settings.service';

describe('ReferralSettingsService', () => {
  let prisma: {
    referralSettings: {
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let svc: ReferralSettingsService;

  const baseRow = {
    id: 'default',
    enabled: false,
    enabledAt: null as Date | null,
    earnPercent: 5,
    earnMode: 'EVERY',
    linkTtlDays: 60,
    minOrderRub: 0,
    quarantineMode: 'DELIVERED',
    quarantineDays: 7,
    inviteeBonusEnabled: false,
    inviteeBonusRub: 0,
    spendCapPercent: 100,
    shareText: 'Закажи: {link}',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = {
      referralSettings: {
        upsert: vi.fn().mockResolvedValue(baseRow),
        update: vi.fn(),
      },
    };
    svc = new ReferralSettingsService(prisma as never);
  });

  it('enabled false→true ставит enabledAt', async () => {
    prisma.referralSettings.update.mockImplementation(
      async (args: { data: { enabledAt?: Date; enabled?: boolean } }) => ({
        ...baseRow,
        ...args.data,
        enabledAt: args.data.enabledAt ?? null,
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    );

    const out = await svc.update({ enabled: true });
    expect(prisma.referralSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: true,
          enabledAt: expect.any(Date),
        }),
      }),
    );
    expect(out.enabled).toBe(true);
    expect(out.enabledAt).toBeTruthy();
  });

  it('повторный enabled=true не сбрасывает enabledAt', async () => {
    const stamped = {
      ...baseRow,
      enabled: true,
      enabledAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    prisma.referralSettings.upsert.mockResolvedValue(stamped);
    prisma.referralSettings.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        ...stamped,
        ...args.data,
        updatedAt: new Date(),
      }),
    );

    await svc.update({ enabled: true, earnPercent: 7 });
    const data = prisma.referralSettings.update.mock.calls[0][0].data;
    expect(data.enabled).toBe(true);
    expect(data.enabledAt).toBeUndefined();
    expect(data.earnPercent).toBe(7);
  });
});
