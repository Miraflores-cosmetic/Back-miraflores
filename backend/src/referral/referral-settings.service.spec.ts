import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralSettingsService } from './referral-settings.service';

describe('ReferralSettingsService', () => {
  let prisma: {
    referralSettings: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    referralSettingsRevision: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    runInRlsTransaction: ReturnType<typeof vi.fn>;
  };
  let svc: ReferralSettingsService;

  const baseRow = {
    id: 'default',
    enabled: false,
    enabledAt: null as Date | null,
    earnPercent: 5,
    earnMode: 'FIRST_GOODS_ORDER',
    earnWindowMaxOrders: 0,
    earnWindowDays: 90,
    linkTtlDays: 60,
    minOrderRub: 0,
    quarantineMode: 'DELIVERED',
    quarantineDays: 7,
    inviteeBonusEnabled: false,
    inviteeBonusRub: 0,
    spendCapPercent: 100,
    monthlyEarnCapRub: 0,
    shareText: 'Закажи: {link}',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = {
      referralSettings: {
        findUnique: vi.fn().mockResolvedValue(baseRow),
        upsert: vi.fn().mockResolvedValue(baseRow),
        update: vi.fn(),
      },
      referralSettingsRevision: {
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
      runInRlsTransaction: vi.fn(async (_c, fn) => fn()),
    };
    svc = new ReferralSettingsService(prisma as never);
  });

  it('ensureDefaults кеширует findUnique без повторных чтений', async () => {
    await svc.ensureDefaults();
    await svc.ensureDefaults();
    expect(prisma.referralSettings.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.referralSettings.upsert).not.toHaveBeenCalled();
  });

  it('ensureDefaults upsert только если строки нет', async () => {
    prisma.referralSettings.findUnique.mockResolvedValue(null);
    await svc.ensureDefaults();
    expect(prisma.referralSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it('update пишет кеш — следующий ensureDefaults без DB', async () => {
    prisma.referralSettings.update.mockResolvedValue({
      ...baseRow,
      earnPercent: 9,
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    await svc.update({ earnPercent: 9 });
    prisma.referralSettings.findUnique.mockClear();
    const row = await svc.ensureDefaults();
    expect(row.earnPercent).toBe(9);
    expect(prisma.referralSettings.findUnique).not.toHaveBeenCalled();
  });

  it('enabled false→true ставит enabledAt + revision', async () => {
    prisma.referralSettings.update.mockImplementation(
      async (args: { data: { enabledAt?: Date; enabled?: boolean } }) => ({
        ...baseRow,
        ...args.data,
        enabledAt: args.data.enabledAt ?? null,
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    );

    const out = await svc.update(
      { enabled: true },
      { userId: 'admin1', email: 'a@x.co' },
    );
    expect(prisma.referralSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: true,
          enabledAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.referralSettingsRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'admin1',
          actorEmail: 'a@x.co',
          snapshot: expect.objectContaining({ enabled: false, earnPercent: 5 }),
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
    prisma.referralSettings.findUnique.mockResolvedValue(stamped);
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
    expect(prisma.referralSettingsRevision.create).toHaveBeenCalled();
  });

  it('re-enable false→true сохраняет прежний enabledAt', async () => {
    const stamped = {
      ...baseRow,
      enabled: false,
      enabledAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    prisma.referralSettings.findUnique.mockResolvedValue(stamped);
    prisma.referralSettings.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        ...stamped,
        ...args.data,
        updatedAt: new Date(),
      }),
    );

    await svc.update({ enabled: true });
    const data = prisma.referralSettings.update.mock.calls[0][0].data;
    expect(data.enabled).toBe(true);
    expect(data.enabledAt).toBeUndefined();
  });

  it('listRevisions отдаёт snapshot', async () => {
    prisma.referralSettingsRevision.findMany.mockResolvedValue([
      {
        id: 'r1',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        actorUserId: 'a1',
        actorEmail: 'a@x.co',
        snapshot: { enabled: false, earnPercent: 5 },
      },
    ]);
    const out = await svc.listRevisions({ limit: 10 });
    expect(out.items).toEqual([
      {
        id: 'r1',
        createdAt: '2026-03-01T00:00:00.000Z',
        actorUserId: 'a1',
        actorEmail: 'a@x.co',
        snapshot: { enabled: false, earnPercent: 5 },
      },
    ]);
  });
});
