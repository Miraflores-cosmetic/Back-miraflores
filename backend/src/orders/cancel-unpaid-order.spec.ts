import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { cancelUnpaidOrderInTx } from './cancel-unpaid-order';
import { reserveStockForLines } from './order-stock';
import { createStatefulStockTx } from './order-stock.test-helpers';

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  releaseGiftCertificateForOrder: vi.fn(async () => undefined),
}));

import { releaseGiftCertificateForOrder } from '../gift-certificates/gift-certificate-hold.util';

describe('cancelUnpaidOrderInTx', () => {
  const orderId = 'order-1';

  const buildTx = () => ({
    payment: {
      findMany: vi.fn().mockResolvedValue([
        { externalId: ' yk_ext_1 ', provider: 'yookassa' },
        { externalId: null, provider: 'yookassa' },
        { externalId: 'yk_ext_2', provider: 'yandexpay' },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promoCodeRedemption: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    order: {
      update: vi.fn().mockResolvedValue({
        id: orderId,
        status: OrderStatus.CANCELLED,
      }),
    },
    orderEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    productVariant: { update: vi.fn() },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('снимает reserve, gift, promo, отменяет PENDING-платежи и пишет CANCELLED', async () => {
    const tx = buildTx();

    const result = await cancelUnpaidOrderInTx(tx as never, {
      orderId,
      fromStatus: OrderStatus.AWAITING_PAYMENT,
      items: [{ variantId: 'v1', qty: 2 }],
      message: 'Отмена админом',
      actorUserId: 'admin1',
      reason: 'admin',
    });

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(releaseGiftCertificateForOrder).toHaveBeenCalledWith(tx, orderId, {
      note: 'Возврат при отмене заказа',
    });
    expect(tx.promoCodeRedemption.deleteMany).toHaveBeenCalledWith({
      where: { orderId },
    });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.CANCELED },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId,
        type: 'CANCELLED',
        message: 'Отмена админом',
        actorUserId: 'admin1',
        meta: { from: OrderStatus.AWAITING_PAYMENT, reason: 'admin' },
      }),
    });
    expect(result).toEqual({
      id: orderId,
      status: OrderStatus.CANCELLED,
      pendingExternalIds: ['yk_ext_1', 'yk_ext_2'],
      pendingPayments: [
        { provider: 'yookassa', externalId: 'yk_ext_1' },
        { provider: 'yandexpay', externalId: 'yk_ext_2' },
      ],
    });
  });

  it('использует giftNote и дефолтное сообщение', async () => {
    const tx = buildTx();
    tx.payment.findMany.mockResolvedValue([]);

    await cancelUnpaidOrderInTx(tx as never, {
      orderId,
      fromStatus: OrderStatus.NEW,
      items: [],
      giftNote: '  Кастомная заметка  ',
    });

    expect(releaseGiftCertificateForOrder).toHaveBeenCalledWith(tx, orderId, {
      note: 'Кастомная заметка',
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ message: 'Заказ отменён' }),
    });
  });

  it('вызывает referralWallet.releaseSpendInTx при abandon/cancel', async () => {
    const tx = buildTx();
    tx.payment.findMany.mockResolvedValue([]);
    const referralWallet = {
      releaseSpendInTx: vi.fn(async () => true),
    };

    await cancelUnpaidOrderInTx(tx as never, {
      orderId,
      fromStatus: OrderStatus.AWAITING_PAYMENT,
      items: [],
      reason: 'abandon',
      referralWallet: referralWallet as never,
    });

    expect(referralWallet.releaseSpendInTx).toHaveBeenCalledWith(tx, orderId, {
      note: 'Возврат реф. баланса при отмене заказа',
    });
  });

  it('integration: reserve → cancel освобождает stockReserve', async () => {
    const stateful = createStatefulStockTx({
      v1: { stock: 10, stockReserve: 0 },
    });
    const items = [{ variantId: 'v1', qty: 4 }];
    await reserveStockForLines(stateful as never, items);
    expect(stateful.getVariant('v1')).toEqual({ stock: 10, stockReserve: 4 });

    const tx = {
      ...stateful,
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      promoCodeRedemption: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      order: {
        update: vi.fn().mockResolvedValue({
          id: orderId,
          status: OrderStatus.CANCELLED,
        }),
      },
      orderEvent: { create: vi.fn().mockResolvedValue({}) },
    };

    await cancelUnpaidOrderInTx(tx as never, {
      orderId,
      fromStatus: OrderStatus.AWAITING_PAYMENT,
      items,
    });

    expect(stateful.getVariant('v1')).toEqual({ stock: 10, stockReserve: 0 });
    expect(stateful.getAvailable('v1')).toBe(10);
  });
});
