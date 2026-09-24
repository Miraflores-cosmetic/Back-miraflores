import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { applyPaidInTx } from './mark-order-paid';

vi.mock('./order-stock', () => ({
  commitStockOnPaid: vi.fn(async () => undefined),
}));

vi.mock('../gift-certificates/gift-certificate-purchase.util', () => ({
  ensureGiftPurchaseIssue: vi.fn(async () => []),
}));

import { commitStockOnPaid } from './order-stock';

describe('applyPaidInTx', () => {
  const lifecycle = {
    addEvent: vi.fn(async () => ({
      id: 'e1',
      createdAt: new Date(),
      orderId: 'o1',
      meta: null,
      type: 'PAID',
      message: 'x',
      actorUserId: null,
    })),
  };

  const orderRow = {
    id: 'o1',
    number: 'JCOS-1',
    email: 'a@b.co',
    total: 1000,
    status: OrderStatus.AWAITING_PAYMENT,
    promoCode: null as string | null,
    discountTotal: 0,
    giftPurchaseDenominationId: null as string | null,
    giftPurchaseRecipientEmail: null as string | null,
    userId: null as string | null,
    guestId: 'g1',
    promoRedemption: null as { id: string } | null,
    items: [{ variantId: 'v1', qty: 2, sku: 'SKU' }],
  };

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'o1' }]),
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    promoCode: { findFirst: vi.fn() },
    promoCodeRedemption: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 'o1' }]);
    tx.order.findUnique.mockResolvedValue({ ...orderRow });
    tx.order.update.mockResolvedValue({});
    tx.payment.findFirst.mockResolvedValue(null);
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
  });

  it('admin: stock + PAID + MARK_PAID + manual payment', async () => {
    const res = await applyPaidInTx(tx as never, lifecycle, 'o1', {
      kind: 'admin',
      actorUserId: 'admin1',
    });

    expect(res).toEqual({
      kind: 'paid',
      number: 'JCOS-1',
      email: 'a@b.co',
      orderId: 'o1',
      isGiftPurchase: false,
    });
    expect(commitStockOnPaid).toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.PAID, adminViewedAt: expect.any(Date) },
      }),
    );
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'manual' }),
      }),
    );
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'MARK_PAID', actorUserId: 'admin1' }),
    );
  });

  it('yookassa: PAID event + upsert payment', async () => {
    const remote = {
      id: 'yk_1',
      amount: { value: '1000.00' },
      paid: true,
      status: 'succeeded',
    };
    const res = await applyPaidInTx(tx as never, lifecycle, 'o1', {
      kind: 'yookassa',
      remote,
    });

    expect(res.kind).toBe('paid');
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.PAID, adminViewedAt: null },
      }),
    );
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalId: 'yk_1',
          status: PaymentStatus.SUCCEEDED,
        }),
      }),
    );
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'PAID' }),
    );
  });

  it('yookassa: amount mismatch → late, без PAID', async () => {
    const res = await applyPaidInTx(tx as never, lifecycle, 'o1', {
      kind: 'yookassa',
      remote: { id: 'yk_1', amount: { value: '50.00' }, paid: true },
    });

    expect(res.kind).toBe('late');
    expect(commitStockOnPaid).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'NOTE' }),
    );
  });

  it('yookassa: CANCELLED → late', async () => {
    tx.order.findUnique.mockResolvedValue({
      ...orderRow,
      status: OrderStatus.CANCELLED,
    });
    const res = await applyPaidInTx(tx as never, lifecycle, 'o1', {
      kind: 'yookassa',
      remote: { id: 'yk_1', amount: { value: '1000.00' } },
    });
    expect(res.kind).toBe('late');
    expect(commitStockOnPaid).not.toHaveBeenCalled();
  });

  it('admin: не-оплачиваемый статус → BadRequest', async () => {
    tx.order.findUnique.mockResolvedValue({
      ...orderRow,
      status: OrderStatus.PAID,
    });
    const already = await applyPaidInTx(tx as never, lifecycle, 'o1', {
      kind: 'admin',
      actorUserId: 'a',
    });
    expect(already.kind).toBe('already');

    tx.order.findUnique.mockResolvedValue({
      ...orderRow,
      status: OrderStatus.CANCELLED,
    });
    await expect(
      applyPaidInTx(tx as never, lifecycle, 'o1', {
        kind: 'admin',
        actorUserId: 'a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404', async () => {
    tx.order.findUnique.mockResolvedValue(null);
    await expect(
      applyPaidInTx(tx as never, lifecycle, 'missing', {
        kind: 'admin',
        actorUserId: 'a',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
