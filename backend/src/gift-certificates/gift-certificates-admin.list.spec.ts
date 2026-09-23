import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GiftCertificateStatus } from '@prisma/client';
import { GiftCertificatesAdminService } from './gift-certificates-admin.service';

function makePrisma() {
  return {
    giftCertificateDenomination: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    giftCertificate: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    giftCertificateLedger: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)(prisma);
      }
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    }),
  };
}

let prisma: ReturnType<typeof makePrisma>;
const mail = {
  isConfigured: vi.fn(() => false),
  sendRaw: vi.fn(async () => undefined),
  sendGiftCertificateIssued: vi.fn(async () => undefined),
};

describe('GiftCertificatesAdminService — list/expire/concurrency', () => {
  let svc: GiftCertificatesAdminService;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
    mail.isConfigured.mockReturnValue(false);
    prisma.$transaction = vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => unknown)(prisma);
      }
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    });
    svc = new GiftCertificatesAdminService(
      prisma as never,
      mail as never,
      { deleteByPublicUrl: vi.fn(), saveGalleryMedia: vi.fn() } as never,
    );
  });

  it('listCertificates помечает просроченные ACTIVE → EXPIRED до выборки', async () => {
    prisma.giftCertificate.updateMany.mockResolvedValue({ count: 2 });
    prisma.giftCertificate.count.mockResolvedValue(0);
    prisma.giftCertificate.findMany.mockResolvedValue([]);

    await svc.listCertificates({ status: GiftCertificateStatus.ACTIVE });

    expect(prisma.giftCertificate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: GiftCertificateStatus.ACTIVE,
          expiresAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        data: { status: GiftCertificateStatus.EXPIRED },
      }),
    );
    expect(prisma.giftCertificate.findMany).toHaveBeenCalled();
  });

  it('adjust и revoke берут строку под FOR UPDATE', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'c1',
        balance: 500,
        faceValue: 500,
        status: GiftCertificateStatus.ACTIVE,
        expiresAt: null,
      },
    ]);
    prisma.giftCertificate.update.mockResolvedValue({
      id: 'c1',
      balance: 400,
      status: GiftCertificateStatus.ACTIVE,
      denomination: null,
    });
    prisma.giftCertificateLedger.create.mockResolvedValue({});

    await svc.adjust('admin1', 'c1', { delta: -100 });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    const adjustSql = String(prisma.$queryRaw.mock.calls[0]?.[0] ?? '');
    expect(adjustSql).toMatch(/FOR UPDATE/i);

    prisma.$queryRaw.mockClear();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'c1',
        balance: 400,
        faceValue: 500,
        status: GiftCertificateStatus.ACTIVE,
        expiresAt: null,
      },
    ]);
    prisma.giftCertificate.update.mockResolvedValue({
      id: 'c1',
      balance: 0,
      status: GiftCertificateStatus.REVOKED,
      denomination: null,
    });

    await svc.revoke('admin1', 'c1');
    const revokeSql = String(prisma.$queryRaw.mock.calls[0]?.[0] ?? '');
    expect(revokeSql).toMatch(/FOR UPDATE/i);
  });

  it('deleteDenomination: soft vs hard', async () => {
    prisma.giftCertificateDenomination.findUnique.mockResolvedValue({
      id: 'd1',
      name: '1000',
      _count: { certificates: 3 },
    });
    prisma.giftCertificateDenomination.update.mockResolvedValue({
      id: 'd1',
      active: false,
      _count: { certificates: 3 },
    });
    const soft = await svc.deleteDenomination('d1');
    expect(soft).toMatchObject({ ok: true, deleted: false, deactivated: true });

    prisma.giftCertificateDenomination.findUnique.mockResolvedValue({
      id: 'd2',
      name: 'empty',
      _count: { certificates: 0 },
    });
    prisma.giftCertificateDenomination.delete.mockResolvedValue({});
    const hard = await svc.deleteDenomination('d2');
    expect(hard).toEqual({ ok: true, deleted: true, deactivated: false });
  });
});
