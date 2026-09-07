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
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
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
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    order: {
      findMany: vi.fn().mockResolvedValue([]),
    },
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
};

const storage = {
  saveGalleryMedia: vi.fn(),
  deleteByPublicUrl: vi.fn(async () => undefined),
};

describe('GiftCertificatesAdminService', () => {
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
      storage as never,
    );
  });

  it('createDenomination', async () => {
    prisma.giftCertificateDenomination.create.mockResolvedValue({
      id: 'd1',
      name: '1000 ₽',
      faceValue: 1000,
    });
    const row = await svc.createDenomination({ name: '1000 ₽', faceValue: 1000 });
    expect(row.faceValue).toBe(1000);
    expect(prisma.giftCertificateDenomination.create).toHaveBeenCalled();
  });

  it('issue с denomination создаёт ledger ISSUE', async () => {
    prisma.giftCertificateDenomination.findUnique.mockResolvedValue({
      id: 'd1',
      faceValue: 500,
      validityDays: 365,
      active: true,
    });
    prisma.giftCertificate.findUnique.mockResolvedValue(null);
    prisma.giftCertificate.create.mockResolvedValue({
      id: 'c1',
      code: 'JC-AAAA-BBBB-CCCC',
      faceValue: 500,
      balance: 500,
      status: GiftCertificateStatus.ACTIVE,
      expiresAt: new Date(),
    });
    prisma.giftCertificateLedger.create.mockResolvedValue({});

    const res = await svc.issue('admin1', { denominationId: 'd1', count: 1 });
    expect(res.count).toBe(1);
    expect(prisma.giftCertificateLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'ISSUE',
          amount: 500,
          balanceAfter: 500,
        }),
      }),
    );
  });

  it('adjust не уводит баланс ниже 0', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'c1',
        balance: 100,
        faceValue: 500,
        status: GiftCertificateStatus.ACTIVE,
        expiresAt: null,
      },
    ]);
    await expect(svc.adjust('admin1', 'c1', { delta: -200 })).rejects.toThrow(
      /отрицательным/,
    );
  });

  it('revoke обнуляет баланс', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'c1',
        balance: 300,
        faceValue: 500,
        status: GiftCertificateStatus.ACTIVE,
        expiresAt: null,
      },
    ]);
    prisma.giftCertificate.update.mockResolvedValue({
      id: 'c1',
      code: 'JC-X',
      balance: 0,
      status: GiftCertificateStatus.REVOKED,
      denomination: null,
    });
    prisma.giftCertificateLedger.create.mockResolvedValue({});

    const row = await svc.revoke('admin1', 'c1');
    expect(row.status).toBe(GiftCertificateStatus.REVOKED);
    expect(prisma.giftCertificateLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'REVOKE',
          amount: -300,
          balanceAfter: 0,
        }),
      }),
    );
  });

  it('getCertificate обогащает ledger actor label', async () => {
    prisma.giftCertificate.updateMany.mockResolvedValue({ count: 0 });
    prisma.giftCertificate.findUnique.mockResolvedValue({
      id: 'c1',
      code: 'JC-A',
      balance: 100,
      status: GiftCertificateStatus.ACTIVE,
      denomination: null,
      issuedByUserId: 'admin1',
      purchaseOrderId: null,
    });
    prisma.giftCertificateLedger.count.mockResolvedValue(1);
    prisma.giftCertificateLedger.findMany.mockResolvedValue([
      {
        id: 'l1',
        kind: 'ISSUE',
        amount: 100,
        balanceAfter: 100,
        orderId: null,
        actorUserId: 'admin1',
        note: 'Выпуск',
        createdAt: new Date(),
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'admin1',
        email: 'ops@jcos.beauty',
        displayName: null,
        staffDisplayName: 'Оператор',
      },
    ]);
    prisma.order.findMany.mockResolvedValue([]);

    const row = await svc.getCertificate('c1');
    expect(row.issuedBy).toMatchObject({ label: 'Оператор' });
    expect(row.ledger?.[0]).toMatchObject({
      actorUserId: 'admin1',
      actor: { id: 'admin1', email: 'ops@jcos.beauty', label: 'Оператор' },
    });
  });
});
