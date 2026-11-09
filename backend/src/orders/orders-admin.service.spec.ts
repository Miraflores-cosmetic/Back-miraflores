import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { OrdersAdminService } from './orders-admin.service';

const releaseGiftCertificateForOrder = vi.fn(async () => true);
const holdGiftCertificateForOrder = vi.fn(async () => ({
  certificateId: 'gc1',
  code: 'GIFT',
  faceValue: 1000,
  balance: 500,
  applyAmount: 500,
  payableBeforeGift: 500,
  total: 0,
}));
const revokeGiftCertificatesIssuedByPurchaseOrder = vi.fn(async () => 1);

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  releaseGiftCertificateForOrder: (...args: unknown[]) =>
    releaseGiftCertificateForOrder(...args),
  holdGiftCertificateForOrder: (...args: unknown[]) =>
    holdGiftCertificateForOrder(...args),
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
const orderItem = {
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
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
const cartSettings = {
  findUnique: vi.fn().mockResolvedValue({ freeShippingThresholdRub: 10_000 }),
};
const productVariant = {
  update: vi.fn(),
  findUnique: vi.fn(),
};
const $executeRaw = vi.fn();
const $queryRaw = vi.fn().mockResolvedValue([{ id: 'o1' }]);

const tx = {
  order,
  orderItem,
  payment,
  orderEvent,
  promoCodeRedemption,
  productVariant,
  giftCertificate,
  cartSettings,
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
  affiliateLead: null,
  checklistMarks: [],
};

const prisma = {
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
  order: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  payment,
};

const lifecycle = {
  addEvent: vi.fn(async () => ({})),
  notifyCustomer: vi.fn(async () => undefined),
  notifyOrderRefund: vi.fn(async () => undefined),
  notifyOrderCancelled: vi.fn(async () => undefined),
  notifyOrderUpdated: vi.fn(async () => undefined),
};

const yookassa = {
  isConfigured: vi.fn(() => false),
  createRefund: vi.fn(),
  createRedirectPayment: vi.fn(),
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
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
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
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
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

describe('OrdersAdminService.updateShippingAddress', () => {
  let service: OrdersAdminService;

  beforeEach(() => {
    order.findUnique.mockReset();
    order.update.mockReset();
    payment.findMany.mockReset();
    payment.findMany.mockResolvedValue([]);
    payment.updateMany.mockReset();
    orderEvent.create.mockReset();
    $queryRaw.mockReset();
    $queryRaw.mockResolvedValue([{ id: 'o1' }]);
    lifecycle.addEvent.mockClear();
    lifecycle.notifyOrderUpdated.mockClear();
    prisma.$transaction.mockClear();
    prisma.order.findUnique.mockResolvedValue({
      ...detailOrder,
      status: OrderStatus.PAID,
      shippingCost: 200,
      total: 1200,
      shippingMethod: 'CDEK',
      shippingAddress: {
        city: 'Москва',
        address: 'Тверская 1',
        comment: '__JCOS:carrier=cdek|dropoff=pvz|pvz=MSK1__',
        pvzCode: 'MSK1',
      },
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
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
    );
  });

  function baseEditableOrder(over: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      phone: '+7900',
      giftPurchaseDenominationId: null,
      shippingCost: 200,
      subtotal: 1000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      total: 1200,
      shippingMethod: 'CDEK',
      shippingAddress: {
        city: 'Москва',
        address: 'Тверская 1',
        apartment: '',
        region: '',
        district: '',
        postalCode: '',
        comment: '__JCOS:carrier=cdek|dropoff=pvz|pvz=MSK1__',
        pvzCode: 'MSK1',
        phone: '',
        recipientName: '',
        carrierQuote: { tariffId: 1, tariffName: 'test' },
      },
      payments: [],
      shipments: [],
      ...over,
    };
  }

  it('cost-only: меняет сумму, сохраняет carrierQuote', async () => {
    order.findUnique.mockResolvedValue(baseEditableOrder());
    await service.updateShippingAddress('o1', 'admin1', {
      shippingCost: 350,
      notifyCustomer: false,
    });
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shippingCost: 350,
          total: 1350,
          shippingAddress: expect.objectContaining({
            carrierQuote: { tariffId: 1, tariffName: 'test' },
            city: 'Москва',
          }),
        }),
      }),
    );
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: expect.stringMatching(/Стоимость доставки/i),
        meta: expect.objectContaining({ costOnly: true }),
      }),
    );
  });

  it('dropoff=pvz без кода → 400', async () => {
    order.findUnique.mockResolvedValue(baseEditableOrder());
    await expect(
      service.updateShippingAddress('o1', 'admin1', {
        city: 'Москва',
        address: 'Тверская 1',
        comment: '__JCOS:carrier=cdek|dropoff=pvz__',
        pvzCode: '',
        shippingMethod: 'CDEK',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('comment carrier ≠ method → 400', async () => {
    order.findUnique.mockResolvedValue(baseEditableOrder());
    await expect(
      service.updateShippingAddress('o1', 'admin1', {
        city: 'Москва',
        address: 'Тверская 1',
        comment: '__JCOS:carrier=yandex|dropoff=courier|lon=1|lat=2__',
        shippingMethod: 'CDEK',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('адрес + ПВЗ: обновляет method/pvz и сбрасывает quote', async () => {
    order.findUnique.mockResolvedValue(baseEditableOrder());
    await service.updateShippingAddress('o1', 'admin1', {
      city: 'Казань',
      address: 'Баумана 1',
      comment: '__JCOS:carrier=cdek|dropoff=pvz|pvz=KZN9__',
      pvzCode: 'KZN9',
      shippingMethod: 'CDEK',
      shippingCost: 290,
    });
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shippingCost: 290,
          shippingMethod: 'CDEK',
          shippingAddress: expect.objectContaining({
            city: 'Казань',
            pvzCode: 'KZN9',
            carrierQuote: undefined,
          }),
        }),
      }),
    );
  });
});

describe('OrdersAdminService.updateContact', () => {
  let service: OrdersAdminService;

  beforeEach(() => {
    order.findUnique.mockReset();
    order.update.mockReset();
    $queryRaw.mockReset();
    $queryRaw.mockResolvedValue([{ id: 'o1' }]);
    lifecycle.addEvent.mockClear();
    prisma.$transaction.mockClear();
    prisma.order.findUnique.mockResolvedValue({
      ...detailOrder,
      status: OrderStatus.PAID,
      shipments: [],
      payments: [],
      events: [],
      checklistMarks: [],
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
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
    );
  });

  it('обновляет email/phone/имя и синхронизирует тел. в shippingAddress', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.PAID,
      email: 'old@x.co',
      phone: '+79001112233',
      customerName: 'Анна',
      shippingAddress: {
        city: 'Москва',
        address: 'Тверская 1',
        phone: '+79001112233',
        recipientName: 'Анна',
      },
    });

    await service.updateContact('o1', 'admin1', {
      email: 'New@x.co',
      phone: '8 (999) 123-45-67',
      customerName: 'Мария',
    });

    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@x.co',
          phone: '+79991234567',
          customerName: 'Мария',
          shippingAddress: expect.objectContaining({
            phone: '+79991234567',
            recipientName: 'Мария',
          }),
        }),
      }),
    );
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'CONTACT_UPDATED' }),
    );
  });

  it('не перезаписывает другого получателя в адресе', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      phone: '+79001112233',
      customerName: 'Анна',
      shippingAddress: {
        city: 'Москва',
        address: 'Тверская 1',
        phone: '+79001112233',
        recipientName: 'Курьер Иван',
      },
    });

    await service.updateContact('o1', 'admin1', {
      email: 'a@b.com',
      phone: '+79991234567',
      customerName: 'Мария',
    });

    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerName: 'Мария',
          shippingAddress: expect.objectContaining({
            phone: '+79991234567',
            recipientName: 'Курьер Иван',
          }),
        }),
      }),
    );
  });

  it('блокирует SHIPPED', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
      email: 'a@b.com',
      phone: '+79001112233',
      customerName: 'Анна',
      shippingAddress: null,
    });
    await expect(
      service.updateContact('o1', 'admin1', {
        email: 'a@b.com',
        phone: '+79991234567',
        customerName: 'Анна',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OrdersAdminService.updateItems', () => {
  let service: OrdersAdminService;

  beforeEach(() => {
    order.findUnique.mockReset();
    order.update.mockReset();
    orderItem.deleteMany.mockReset();
    orderItem.createMany.mockReset();
    orderItem.deleteMany.mockResolvedValue({ count: 1 });
    orderItem.createMany.mockResolvedValue({ count: 1 });
    payment.findMany.mockReset();
    payment.findMany.mockResolvedValue([]);
    payment.updateMany.mockReset();
    productVariant.findUnique.mockReset();
    $queryRaw.mockReset();
    $queryRaw.mockResolvedValue([{ id: 'o1' }]);
    releaseGiftCertificateForOrder.mockClear();
    releaseGiftCertificateForOrder.mockResolvedValue(true);
    holdGiftCertificateForOrder.mockClear();
    holdGiftCertificateForOrder.mockResolvedValue({
      certificateId: 'gc1',
      code: 'GIFT',
      faceValue: 1000,
      balance: 500,
      applyAmount: 200,
      payableBeforeGift: 200,
      total: 0,
    });
    lifecycle.addEvent.mockClear();
    lifecycle.notifyOrderUpdated.mockClear();
    prisma.$transaction.mockClear();
    prisma.order.findUnique.mockResolvedValue({
      ...detailOrder,
      status: OrderStatus.PAID,
      discountTotal: 0,
      giftCertificateAmount: 0,
      shippingCost: 0,
      total: 1000,
      items: [
        {
          id: 'i1',
          title: 'X',
          sku: 's',
          qty: 1,
          unitPrice: 1000,
          lineTotal: 1000,
        },
      ],
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
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
    );
  });

  function baseItemsOrder(over: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      phone: '+7900',
      giftPurchaseDenominationId: null,
      giftCertificateId: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      shippingCost: 200,
      subtotal: 1000,
      discountTotal: 0,
      total: 1200,
      payments: [],
      items: [
        {
          id: 'i1',
          title: 'Serum',
          sku: 'SKU-1',
          qty: 1,
          unitPrice: 1000,
          lineTotal: 1000,
          variantId: 'v1',
          shadeId: 'sh1',
          isGratitudeGift: false,
        },
      ],
      ...over,
    };
  }

  it('сохраняет shadeId при replace', async () => {
    order.findUnique.mockResolvedValue(baseItemsOrder());
    await service.updateItems('o1', 'admin1', {
      items: [
        {
          variantId: null,
          shadeId: 'sh1',
          qty: 1,
          unitPrice: 1000,
          title: 'Serum',
          sku: 'SKU-1',
        },
      ],
      notifyCustomer: false,
    });
    expect(orderItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            shadeId: 'sh1',
            title: 'Serum',
            unitPrice: 1000,
          }),
        ],
      }),
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 1000,
          total: 1200,
        }),
      }),
    );
  });

  it('clamp: discount + gift к новому subtotal', async () => {
    order.findUnique.mockResolvedValue(
      baseItemsOrder({
        discountTotal: 500,
        giftCertificateAmount: 800,
        giftCertificateId: 'gc1',
        giftCertificateCode: 'GIFT',
        shippingCost: 100,
        total: 0,
        items: [
          {
            id: 'i1',
            title: 'Serum',
            sku: 'SKU-1',
            qty: 2,
            unitPrice: 1000,
            lineTotal: 2000,
            variantId: null,
            shadeId: null,
            isGratitudeGift: false,
          },
        ],
      }),
    );
    // Новый состав: subtotal 400 → discount clamp 400, gift max = 0+100 = 100
    await service.updateItems('o1', 'admin1', {
      items: [
        {
          variantId: null,
          qty: 1,
          unitPrice: 400,
          title: 'Serum',
          sku: 'SKU-1',
        },
      ],
      notifyCustomer: false,
    });
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 400,
          discountTotal: 400,
          giftCertificateAmount: 100,
          // total = 400 - 400 - 100 + 100 = 0
          total: 0,
        }),
      }),
    );
  });

  it('unpaid: пересчёт hold при clamp gift', async () => {
    order.findUnique.mockResolvedValue(
      baseItemsOrder({
        status: OrderStatus.AWAITING_PAYMENT,
        discountTotal: 0,
        giftCertificateAmount: 900,
        giftCertificateId: 'gc1',
        giftCertificateCode: 'GIFT',
        shippingCost: 100,
        subtotal: 1000,
        total: 200,
      }),
    );
    await service.updateItems('o1', 'admin1', {
      items: [
        {
          variantId: null,
          qty: 1,
          unitPrice: 300,
          title: 'Serum',
          sku: 'SKU-1',
        },
      ],
      notifyCustomer: false,
    });
    // maxGift = 300 - 0 + 100 = 400 → gift clamped 400 (from 900)
    expect(releaseGiftCertificateForOrder).toHaveBeenCalledWith(
      tx,
      'o1',
      expect.objectContaining({ note: expect.stringMatching(/состав/i) }),
    );
    expect(holdGiftCertificateForOrder).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        certificateId: 'gc1',
        orderId: 'o1',
        applyAmount: 400,
      }),
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 300,
          giftCertificateAmount: 400,
          total: 0,
        }),
      }),
    );
  });

  it('paid: sync ledger при clamp gift (не только order field)', async () => {
    order.findUnique.mockResolvedValue(
      baseItemsOrder({
        status: OrderStatus.PAID,
        discountTotal: 0,
        giftCertificateAmount: 900,
        giftCertificateId: 'gc1',
        giftCertificateCode: 'GIFT',
        shippingCost: 100,
        subtotal: 1000,
        total: 200,
        payments: [{ status: 'SUCCEEDED', amount: 200 }],
      }),
    );
    await service.updateItems('o1', 'admin1', {
      items: [
        {
          variantId: null,
          qty: 1,
          unitPrice: 300,
          title: 'Serum',
          sku: 'SKU-1',
        },
      ],
      notifyCustomer: false,
    });
    // maxGift = 400 → clamp 400; PAID тоже release+re-hold
    expect(releaseGiftCertificateForOrder).toHaveBeenCalledWith(
      tx,
      'o1',
      expect.objectContaining({ note: expect.stringMatching(/состав/i) }),
    );
    expect(holdGiftCertificateForOrder).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        certificateId: 'gc1',
        orderId: 'o1',
        applyAmount: 400,
      }),
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          giftCertificateAmount: 400,
          total: 0,
        }),
      }),
    );
  });

  it('блокирует пустой состав', async () => {
    await expect(
      service.updateItems('o1', 'admin1', { items: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('блокирует заказ сертификата', async () => {
    order.findUnique.mockResolvedValue(
      baseItemsOrder({ giftPurchaseDenominationId: 'den1' }),
    );
    await expect(
      service.updateItems('o1', 'admin1', {
        items: [
          {
            variantId: null,
            qty: 1,
            unitPrice: 100,
            title: 'X',
            sku: 's',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OrdersAdminService.removePromo', () => {
  let service: OrdersAdminService;

  beforeEach(() => {
    order.findUnique.mockReset();
    order.update.mockReset();
    payment.findMany.mockReset();
    payment.findMany.mockResolvedValue([]);
    payment.updateMany.mockReset();
    promoCodeRedemption.deleteMany.mockReset();
    promoCodeRedemption.deleteMany.mockResolvedValue({ count: 1 });
    $queryRaw.mockReset();
    $queryRaw.mockResolvedValue([{ id: 'o1' }]);
    lifecycle.addEvent.mockClear();
    lifecycle.notifyOrderUpdated.mockClear();
    prisma.$transaction.mockClear();
    prisma.order.findUnique.mockResolvedValue({
      ...detailOrder,
      status: OrderStatus.PAID,
      promoCode: null,
      discountTotal: 0,
      giftCertificateAmount: 0,
      shippingCost: 200,
      subtotal: 1000,
      total: 1200,
      items: [
        {
          id: 'i1',
          title: 'X',
          sku: 's',
          qty: 1,
          unitPrice: 1000,
          lineTotal: 1000,
        },
      ],
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
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
    );
  });

  it('снимает промокод и пересчитывает total', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      giftPurchaseDenominationId: null,
      giftCertificateId: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      shippingCost: 200,
      subtotal: 1000,
      discountTotal: 150,
      promoCode: 'SALE15',
      total: 1050,
      payments: [],
      promoRedemption: { id: 'r1', promoCodeId: 'p1' },
    });

    await service.removePromo('o1', 'admin1', { notifyCustomer: false });

    expect(promoCodeRedemption.deleteMany).toHaveBeenCalledWith({
      where: { orderId: 'o1' },
    });
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promoCode: null,
          discountTotal: 0,
          // 1000 - 0 - 0 + 200
          total: 1200,
        }),
      }),
    );
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'PROMO_REMOVED',
        meta: expect.objectContaining({
          removedCode: 'SALE15',
          removedDiscount: 150,
          previousTotal: 1050,
          newTotal: 1200,
        }),
      }),
    );
  });

  it('ошибка если промокода нет', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.PAID,
      giftPurchaseDenominationId: null,
      giftCertificateAmount: 0,
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 0,
      promoCode: null,
      total: 1000,
      payments: [],
      promoRedemption: null,
    });
    await expect(
      service.removePromo('o1', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('блокирует заказ сертификата', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.PAID,
      giftPurchaseDenominationId: 'den1',
      giftCertificateAmount: 0,
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 100,
      promoCode: 'SALE',
      total: 900,
      payments: [],
      promoRedemption: null,
    });
    await expect(
      service.removePromo('o1', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unpaid: гасит PENDING при росте total и pendingPaymentsCanceled', async () => {
    yookassa.cancelPaymentsBestEffort.mockClear();
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.AWAITING_PAYMENT,
      email: 'a@b.com',
      giftPurchaseDenominationId: null,
      giftCertificateId: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      shippingCost: 200,
      subtotal: 1000,
      discountTotal: 150,
      promoCode: 'SALE15',
      total: 1050,
      payments: [],
      promoRedemption: { id: 'r1', promoCodeId: 'p1' },
    });
    payment.findMany.mockResolvedValue([{ externalId: 'yk-pending-1' }]);

    const res = await service.removePromo('o1', 'admin1', {
      notifyCustomer: false,
    });

    expect(payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderId: 'o1',
          status: 'PENDING',
        }),
        data: { status: 'CANCELED' },
      }),
    );
    expect(yookassa.cancelPaymentsBestEffort).toHaveBeenCalledWith([
      'yk-pending-1',
    ]);
    expect(res.pendingPaymentsCanceled).toBe(true);
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promoCode: null,
          discountTotal: 0,
          total: 1200,
        }),
      }),
    );
  });

  it('unpaid: без PENDING — pendingPaymentsCanceled false', async () => {
    yookassa.cancelPaymentsBestEffort.mockClear();
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.AWAITING_PAYMENT,
      email: 'a@b.com',
      giftPurchaseDenominationId: null,
      giftCertificateId: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 100,
      promoCode: 'SALE',
      total: 900,
      payments: [],
      promoRedemption: null,
    });
    payment.findMany.mockResolvedValue([]);

    const res = await service.removePromo('o1', 'admin1', {
      notifyCustomer: false,
    });

    expect(payment.updateMany).not.toHaveBeenCalled();
    expect(yookassa.cancelPaymentsBestEffort).not.toHaveBeenCalled();
    expect(res.pendingPaymentsCanceled).toBe(false);
  });

  it('notifyCustomer: true → письмо клиенту', async () => {
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      giftPurchaseDenominationId: null,
      giftCertificateId: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 100,
      promoCode: 'SALE',
      total: 900,
      payments: [],
      promoRedemption: { id: 'r1', promoCodeId: 'p1' },
    });

    await service.removePromo('o1', 'admin1', { notifyCustomer: true });

    expect(lifecycle.notifyOrderUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@b.com',
        orderNumber: 'JCOS-1',
        changesSummary: expect.stringMatching(/SALE|промо/i),
      }),
    );
  });

  it('пересчитывает доставку при снятии промо (free PVZ по порогу)', async () => {
    const pvzComment =
      '__VSP:carrier=cdek|lon=|lat=|pvz=MSK45|dropoff=pvz__\nТип доставки: СДЭК ПВЗ. Детали: x';
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-138',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      giftPurchaseDenominationId: null,
      giftCertificateId: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      shippingCost: 708,
      subtotal: 10_200,
      discountTotal: 708,
      promoCode: 'PROMO',
      total: 10_200,
      shippingAddress: {
        comment: pvzComment,
        carrierQuote: { cost: 708, freePvz: false },
      },
      payments: [],
      promoRedemption: { id: 'r1', promoCodeId: 'p1' },
    });

    await service.removePromo('o1', 'admin1', { notifyCustomer: false });

    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          discountTotal: 0,
          shippingCost: 0,
          // 10200 - 0 - 0 + 0
          total: 10_200,
        }),
      }),
    );
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        message: expect.stringMatching(/Доставка 708 → 0/),
      }),
    );
  });

  it('paid + gift: sync ledger при clamp после снятия скидки не нужен если gift ≤ max', async () => {
    releaseGiftCertificateForOrder.mockClear();
    holdGiftCertificateForOrder.mockClear();
    order.findUnique.mockResolvedValue({
      id: 'o1',
      number: 'JCOS-1',
      status: OrderStatus.PAID,
      email: 'a@b.com',
      giftPurchaseDenominationId: null,
      giftCertificateId: 'gc1',
      giftCertificateCode: 'GIFT',
      giftCertificateAmount: 300,
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 100,
      promoCode: 'SALE',
      total: 600,
      payments: [],
      promoRedemption: { id: 'r1', promoCodeId: 'p1' },
    });

    await service.removePromo('o1', 'admin1', { notifyCustomer: false });

    // maxGift растёт (1000), gift 300 остаётся — amount не меняется → без release
    expect(releaseGiftCertificateForOrder).not.toHaveBeenCalled();
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          discountTotal: 0,
          giftCertificateAmount: 300,
          // 1000 - 0 - 300 + 0
          total: 700,
        }),
      }),
    );
  });
});

describe('OrdersAdminService.create pay modes', () => {
  let service: OrdersAdminService;
  const createAdmin = vi.fn();
  const markPaidSpy = vi.fn();
  const checkoutSpy = vi.fn();

  beforeEach(() => {
    createAdmin.mockReset();
    createAdmin.mockResolvedValue({
      id: 'o-new',
      number: 'JCOS-42',
      status: 'AWAITING_PAYMENT',
      email: 'a@b.com',
      phone: '+7999',
      subtotal: 1000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      total: 1000,
      promoCode: null,
      giftCertificateCode: null,
    });
    prisma.order.findUnique.mockResolvedValue({ ...detailOrder, id: 'o-new' });

    service = new OrdersAdminService(
      prisma as never,
      lifecycle as never,
      yookassa as never,
      {
        isCdekConfigured: () => false,
        register: vi.fn(),
      } as never,
      { get: vi.fn().mockReturnValue('http://localhost:5173') } as never,
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
    );

    markPaidSpy.mockReset();
    checkoutSpy.mockReset();
    markPaidSpy.mockResolvedValue({ ...detailOrder, id: 'o-new', status: OrderStatus.PAID });
    checkoutSpy.mockResolvedValue({
      ...detailOrder,
      id: 'o-new',
      checkout: {
        amount: 1000,
        confirmationUrl: 'https://pay.example/link',
        paymentId: 'yk1',
      },
    });
    vi.spyOn(service, 'markPaid').mockImplementation(markPaidSpy as never);
    vi.spyOn(service, 'createCheckoutPayment').mockImplementation(
      checkoutSpy as never,
    );
    vi.spyOn(service, 'getById').mockResolvedValue({
      ...detailOrder,
      id: 'o-new',
    } as never);
  });

  const dtoBase = {
    lines: [{ variantId: 'v1', qty: 1 }],
    email: 'a@b.com',
    phone: '+79991234567',
    customerName: 'Иван',
    shippingAddress: { city: 'Москва', address: 'Тверская 1' },
    shippingMethod: 'CDEK',
    shippingCost: 0,
    attachGratitude: false,
  };

  it('awaiting: только create, без mark-paid / link', async () => {
    const res = await service.create(
      { ...dtoBase, payMode: 'awaiting' },
      'staff1',
    );
    expect(createAdmin).toHaveBeenCalled();
    expect(markPaidSpy).not.toHaveBeenCalled();
    expect(checkoutSpy).not.toHaveBeenCalled();
    expect(res.paymentLink).toBeNull();
    expect(res.paymentError).toBeNull();
    expect(res.order.id).toBe('o-new');
  });

  it('mark_paid без orders_finance → Forbidden до create', async () => {
    await expect(
      service.create(
        { ...dtoBase, payMode: 'mark_paid' },
        'staff1',
        { canOrdersFinance: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it('mark_paid: вызывает markPaid с notifyCustomer', async () => {
    await service.create(
      { ...dtoBase, payMode: 'mark_paid', notifyCustomer: false },
      'staff1',
      { canOrdersFinance: true },
    );
    expect(markPaidSpy).toHaveBeenCalledWith('o-new', 'staff1', {
      notifyCustomer: false,
    });
    expect(checkoutSpy).not.toHaveBeenCalled();
  });

  it('awaiting_link: createCheckoutPayment и paymentLink', async () => {
    const res = await service.create(
      { ...dtoBase, payMode: 'awaiting_link', notifyCustomer: true },
      'staff1',
    );
    expect(checkoutSpy).toHaveBeenCalledWith('o-new', 'staff1', {
      notifyCustomer: true,
      reuseExisting: true,
    });
    expect(res.paymentLink).toBe('https://pay.example/link');
    expect(res.paymentError).toBeNull();
  });

  it('awaiting_link: ЮKassa down → заказ есть, paymentError, без throw', async () => {
    checkoutSpy.mockRejectedValueOnce(
      new BadRequestException('ЮKassa не настроена'),
    );
    const res = await service.create(
      { ...dtoBase, payMode: 'awaiting_link' },
      'staff1',
    );
    expect(createAdmin).toHaveBeenCalled();
    expect(res.order.id).toBe('o-new');
    expect(res.paymentLink).toBeNull();
    expect(res.paymentError).toMatch(/ЮKassa/i);
  });
});

describe('OrdersAdminService.createCheckoutPayment reuseExisting', () => {
  let service: OrdersAdminService;

  beforeEach(() => {
    yookassa.isConfigured.mockReturnValue(true);
    yookassa.createRedirectPayment.mockReset();
    yookassa.cancelPaymentsBestEffort.mockClear();
    payment.create.mockClear();
    lifecycle.addEvent.mockClear();
    lifecycle.notifyOrderUpdated.mockClear();

    service = new OrdersAdminService(
      prisma as never,
      lifecycle as never,
      yookassa as never,
      {
        isCdekConfigured: () => false,
        register: vi.fn(),
      } as never,
      { get: vi.fn().mockReturnValue('http://localhost:5173') } as never,
      {
        applyRetentionForOrder: vi.fn(),
        seedCustomerNoteFromOrder: vi.fn(),
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
    );

    vi.spyOn(service, 'getById').mockResolvedValue({
      ...detailOrder,
      id: 'o-link',
      status: OrderStatus.AWAITING_PAYMENT,
      total: 1500,
    } as never);
  });

  it('reuseExisting: возвращает PENDING link без нового ЮKassa', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o-link',
      number: 'JCOS-9',
      status: OrderStatus.AWAITING_PAYMENT,
      email: 'a@b.com',
      total: 1500,
      giftPurchaseDenominationId: null,
      payments: [
        {
          id: 'pay1',
          status: PaymentStatus.PENDING,
          amount: 1500,
          externalId: 'yk-existing',
          confirmationUrl: 'https://pay.example/existing',
        },
      ],
    });

    const res = await service.createCheckoutPayment('o-link', 'staff1', {
      reuseExisting: true,
      notifyCustomer: false,
    });

    expect(res.checkout).toEqual({
      amount: 1500,
      confirmationUrl: 'https://pay.example/existing',
      paymentId: 'yk-existing',
      reused: true,
    });
    expect(yookassa.createRedirectPayment).not.toHaveBeenCalled();
    expect(yookassa.cancelPaymentsBestEffort).not.toHaveBeenCalled();
    expect(payment.create).not.toHaveBeenCalled();
  });

  it('без reuseExisting: cancel PENDING + новый платёж', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o-link',
      number: 'JCOS-9',
      status: OrderStatus.AWAITING_PAYMENT,
      email: 'a@b.com',
      total: 1500,
      giftPurchaseDenominationId: null,
      payments: [
        {
          id: 'pay1',
          status: PaymentStatus.PENDING,
          amount: 1500,
          externalId: 'yk-old',
          confirmationUrl: 'https://pay.example/old',
        },
      ],
    });
    yookassa.createRedirectPayment.mockResolvedValue({
      payment: { id: 'yk-new' },
      confirmationUrl: 'https://pay.example/new',
    });
    payment.create.mockResolvedValue({});

    const res = await service.createCheckoutPayment('o-link', 'staff1', {
      notifyCustomer: false,
    });

    expect(yookassa.cancelPaymentsBestEffort).toHaveBeenCalledWith(['yk-old']);
    expect(yookassa.createRedirectPayment).toHaveBeenCalled();
    expect(res.checkout?.confirmationUrl).toBe('https://pay.example/new');
    expect(res.checkout?.reused).toBe(false);
  });

  it('reuseExisting при другом amount — перевыпускает', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o-link',
      number: 'JCOS-9',
      status: OrderStatus.AWAITING_PAYMENT,
      email: 'a@b.com',
      total: 2000,
      giftPurchaseDenominationId: null,
      payments: [
        {
          id: 'pay1',
          status: PaymentStatus.PENDING,
          amount: 1500,
          externalId: 'yk-old',
          confirmationUrl: 'https://pay.example/old',
        },
      ],
    });
    yookassa.createRedirectPayment.mockResolvedValue({
      payment: { id: 'yk-new' },
      confirmationUrl: 'https://pay.example/new',
    });
    payment.create.mockResolvedValue({});

    await service.createCheckoutPayment('o-link', 'staff1', {
      reuseExisting: true,
      notifyCustomer: false,
    });

    expect(yookassa.createRedirectPayment).toHaveBeenCalled();
    expect(yookassa.cancelPaymentsBestEffort).toHaveBeenCalledWith(['yk-old']);
  });
});
