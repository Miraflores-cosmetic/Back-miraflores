import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { OrdersAdminService } from './orders-admin.service';

const releaseGiftCertificateForOrder = vi.fn(async () => true);
const revokeGiftCertificatesIssuedByPurchaseOrder = vi.fn(async () => 1);

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  releaseGiftCertificateForOrder: (...args: unknown[]) =>
    releaseGiftCertificateForOrder(...args),
}));

vi.mock('../gift-certificates/gift-certificate-purchase.util', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../gift-certificates/gift-certificate-purchase.util')
  >();
  return {
    ...actual,
    revokeGiftCertificatesIssuedByPurchaseOrder: (...args: unknown[]) =>
      revokeGiftCertificatesIssuedByPurchaseOrder(...args),
  };
});

const order = {
  findUnique: vi.fn(),
  update: vi.fn(),
};
const giftCertificate = {
  findMany: vi.fn().mockResolvedValue([]),
};
const payment = {
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
};
const orderEvent = {
  create: vi.fn(),
};
const promoCodeRedemption = {
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
};
const productVariant = {
  update: vi.fn(),
};
const $executeRaw = vi.fn();
const $queryRaw = vi.fn().mockResolvedValue([{ id: 'o1' }]);

const tx = {
  order,
  payment,
  orderEvent,
  promoCodeRedemption,
  productVariant,
  giftCertificate,
  $executeRaw,
  $queryRaw,
};

const detailOrder = {
  id: 'o1',
  number: 'JCOS-1',
  status: OrderStatus.CANCELLED,
  email: 'a@b.com',
  phone: '+7900',
  customerName: 'Ann',
  customerNote: null,
  shippingAddress: null,
  shippingMethod: null,
  shippingCost: 0,
  subtotal: 100,
  discountTotal: 0,
  total: 100,
  refundedAmount: 0,
  promoCode: 'SALE' as string | null,
  guestId: null,
  userId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: null,
  items: [{ id: 'i1', title: 'X', sku: 's', qty: 1, unitPrice: 100, lineTotal: 100 }],
  payments: [],
  shipments: [],
  events: [],
  promoRedemption: { id: 'r1' } as { id: string } | null,
};

const prisma = {
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  order: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};

const lifecycle = {
  addEvent: vi.fn(async () => ({})),
  notifyCustomer: vi.fn(async () => undefined),
  notifyOrderRefund: vi.fn(async () => undefined),
  notifyOrderCancelled: vi.fn(async () => undefined),
};

const yookassa = {
  isConfigured: vi.fn(() => false),
  createRefund: vi.fn(),
  cancelPaymentsBestEffort: vi.fn(async () => undefined),
};

describe('OrdersAdminService.cancel', () => {
  let service: OrdersAdminService;

  beforeEach(() => {
    order.findUnique.mockReset();
    order.update.mockReset();
    payment.updateMany.mockReset();
    orderEvent.create.mockReset();
    productVariant.update.mockReset();
    $executeRaw.mockReset();
    $queryRaw.mockReset();
    $queryRaw.mockResolvedValue([{ id: 'o1' }]);
    releaseGiftCertificateForOrder.mockClear();
    releaseGiftCertificateForOrder.mockResolvedValue(true);
    lifecycle.addEvent.mockClear();
    lifecycle.notifyCustomer.mockClear();
    prisma.$transaction.mockClear();
    prisma.order.findUnique.mockResolvedValue({ ...detailOrder });
    service = new OrdersAdminService(
      prisma as never,
      lifecycle as never,
      yookassa as never,
      {
        isCdekConfigured: () => false,
        register: vi.fn(),
      } as never,
      { get: vi.fn().mockReturnValue('http://localhost:5173') } as never,
    );
  });

  it('ставит CANCELLED и возвращает полный detail', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.NEW,
      promoCode: 'SALE',
      email: 'a@b.com',
      items: [{ variantId: 'v1', qty: 2 }],
      promoRedemption: { id: 'r1', promoCodeId: 'p1' },
    });
    order.update.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.CANCELLED,
      promoCode: 'SALE',
      promoRedemption: { id: 'r1', promoCodeId: 'p1' },
    });
    const res = await service.cancel('o1', 'admin1');
    expect($queryRaw).toHaveBeenCalled();
    expect($executeRaw).toHaveBeenCalled();
    expect(releaseGiftCertificateForOrder).toHaveBeenCalledWith(
      tx,
      'o1',
      expect.objectContaining({ note: expect.stringMatching(/отмене/i) }),
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.CANCELLED },
      }),
    );
    expect(orderEvent.create).toHaveBeenCalled();
    expect(res.promoReleased).toBe(true);
    expect(res.status).toBe(OrderStatus.CANCELLED);
    expect(res.items).toHaveLength(1);
    expect(res.actions).toBeDefined();
  });

  it('блокирует PAID — нужен refund', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      promoCode: null,
      email: 'a@b.com',
      items: [],
      promoRedemption: null,
    });
    await expect(service.cancel('o1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('не трогает уже CANCELLED', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.CANCELLED,
      promoCode: null,
      email: 'a@b.com',
      items: [],
      promoRedemption: null,
    });
    prisma.order.findUnique.mockResolvedValue({
      ...detailOrder,
      promoCode: null,
      promoRedemption: null,
    });
    const res = await service.cancel('o1');
    expect(order.update).not.toHaveBeenCalled();
    expect(res.status).toBe(OrderStatus.CANCELLED);
    expect(res.promoReleased).toBe(false);
  });

  it('блокирует SHIPPED', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.SHIPPED,
      promoCode: null,
      email: 'a@b.com',
      items: [],
      promoRedemption: null,
    });
    await expect(service.cancel('o1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404', async () => {
    order.findUnique.mockResolvedValue(null);
    await expect(service.cancel('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrdersAdminService.refund + gift RELEASE', () => {
  let service: OrdersAdminService;

  beforeEach(() => {
    order.findUnique.mockReset();
    order.update.mockReset();
    payment.updateMany.mockReset();
    productVariant.update.mockReset();
    giftCertificate.findMany.mockReset();
    giftCertificate.findMany.mockResolvedValue([]);
    $executeRaw.mockReset();
    $queryRaw.mockReset();
    $queryRaw.mockResolvedValue([{ id: 'o1' }]);
    releaseGiftCertificateForOrder.mockClear();
    releaseGiftCertificateForOrder.mockResolvedValue(true);
    revokeGiftCertificatesIssuedByPurchaseOrder.mockClear();
    revokeGiftCertificatesIssuedByPurchaseOrder.mockResolvedValue(1);
    lifecycle.addEvent.mockClear();
    lifecycle.notifyCustomer.mockClear();
    lifecycle.notifyOrderRefund.mockClear();
    prisma.order.update.mockClear();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    prisma.order.findUnique.mockResolvedValue({
      ...detailOrder,
      status: OrderStatus.REFUNDED,
      promoCode: null,
      promoRedemption: null,
    });
    service = new OrdersAdminService(
      prisma as never,
      lifecycle as never,
      yookassa as never,
      {
        isCdekConfigured: () => false,
        register: vi.fn(),
      } as never,
      { get: vi.fn().mockReturnValue('http://localhost:5173') } as never,
    );
  });

  it('полный refund карты → RELEASE сертификата', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      total: 3000,
      refundedAmount: 0,
      giftCertificateAmount: 2000,
      items: [{ variantId: 'v1', qty: 1 }],
      payments: [{ id: 'p1', amount: 3000, status: 'SUCCEEDED', provider: 'yookassa' }],
    });
    order.update.mockResolvedValue({});

    await service.refund('o1', 'admin1', { amount: 3000 });

    expect(releaseGiftCertificateForOrder).toHaveBeenCalledWith(
      tx,
      'o1',
      expect.objectContaining({ note: expect.stringMatching(/refund/i) }),
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.REFUNDED,
          refundedAmount: 3000,
        }),
      }),
    );
  });

  it('частичный refund при gift → запрет (политика: только full)', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      total: 3000,
      refundedAmount: 0,
      giftCertificateAmount: 2000,
      items: [{ variantId: 'v1', qty: 1 }],
      payments: [{ id: 'p1', amount: 3000, status: 'SUCCEEDED', provider: 'yookassa' }],
    });
    order.update.mockResolvedValue({});

    await expect(
      service.refund('o1', 'admin1', { amount: 1000 }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/только полный возврат/i),
    });

    expect(releaseGiftCertificateForOrder).not.toHaveBeenCalled();
    expect(order.update).not.toHaveBeenCalled();
  });

  it('gift-only (total 0) → RELEASE при refund 0', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      total: 0,
      refundedAmount: 0,
      giftCertificateAmount: 5000,
      items: [{ variantId: 'v1', qty: 1 }],
      payments: [],
    });
    order.update.mockResolvedValue({});

    await service.refund('o1', 'admin1', {});

    expect(releaseGiftCertificateForOrder).toHaveBeenCalled();
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.REFUNDED,
          refundedAmount: 0,
        }),
      }),
    );
  });

  it('gift purchase order → revoke issued codes on full refund', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o-purchase',
      number: 'JCOS-GC-1',
      status: OrderStatus.PAID,
      email: 'buyer@b.com',
      total: 5000,
      refundedAmount: 0,
      giftCertificateAmount: 0,
      giftPurchaseDenominationId: 'denom1',
      items: [{ variantId: null, qty: 1 }],
      payments: [
        {
          id: 'p1',
          provider: 'yookassa',
          externalId: 'yk-1',
          amount: 5000,
          status: 'SUCCEEDED',
        },
      ],
    });
    order.update.mockResolvedValue({});
    // pre-check before PSP: unused codes
    giftCertificate.findMany.mockResolvedValue([
      {
        id: 'c1',
        code: 'JC-OK',
        faceValue: 5000,
        balance: 5000,
        status: 'ACTIVE',
      },
    ]);

    await service.refund('o-purchase', 'admin1', {});

    expect(releaseGiftCertificateForOrder).not.toHaveBeenCalled();
    expect(revokeGiftCertificatesIssuedByPurchaseOrder).toHaveBeenCalledWith(
      expect.anything(),
      'o-purchase',
      expect.objectContaining({
        actorUserId: 'admin1',
        note: expect.stringContaining('возврате'),
      }),
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.REFUNDED,
          refundedAmount: 5000,
        }),
      }),
    );
  });

  it('gift purchase after redeem → block refund (no clawback)', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o-purchase',
      number: 'JCOS-GC-2',
      status: OrderStatus.PAID,
      email: 'buyer@b.com',
      total: 5000,
      refundedAmount: 0,
      giftCertificateAmount: 0,
      giftPurchaseDenominationId: 'denom1',
      items: [{ variantId: null, qty: 1 }],
      payments: [
        {
          id: 'p1',
          provider: 'yookassa',
          externalId: 'yk-2',
          amount: 5000,
          status: 'SUCCEEDED',
        },
      ],
    });
    giftCertificate.findMany.mockResolvedValue([
      {
        id: 'c1',
        code: 'JC-SPENT',
        faceValue: 5000,
        balance: 1000,
        status: 'ACTIVE',
      },
    ]);

    await expect(
      service.refund('o-purchase', 'admin1', { providerRefund: true }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/уже использованы/i),
    });

    expect(revokeGiftCertificatesIssuedByPurchaseOrder).not.toHaveBeenCalled();
    expect(order.update).not.toHaveBeenCalled();
  });
});
