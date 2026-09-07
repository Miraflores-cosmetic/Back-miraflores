import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountService } from './account.service';

function makeTx() {
  return {
    userAddress: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userAddress: tx.userAddress,
    order: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
}

describe('AccountService', () => {
  let tx: ReturnType<typeof makeTx>;
  let prisma: ReturnType<typeof makePrisma>;
  let payTokens: {
    issue: ReturnType<typeof vi.fn>;
    awaitingTtlMinutes: ReturnType<typeof vi.fn>;
  };
  let svc: AccountService;

  beforeEach(() => {
    tx = makeTx();
    prisma = makePrisma(tx);
    payTokens = {
      issue: vi.fn().mockReturnValue('tok'),
      awaitingTtlMinutes: vi.fn().mockReturnValue(60),
    };
    svc = new AccountService(prisma as never, payTokens as never, {
      cancelPaymentsBestEffort: vi.fn(async () => undefined),
    } as never);
  });

  it('updateProfile нормализует phone в E.164', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      displayName: null,
      phone: '+79001234567',
      marketingConsent: false,
      marketingConsentAt: null,
      createdAt: new Date(),
    });
    await svc.updateProfile('u1', { phone: '8 (900) 123-45-67' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: '+79001234567' }),
      }),
    );
  });

  it('updateProfile отклоняет некорректный phone', async () => {
    await expect(
      svc.updateProfile('u1', { phone: '123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createAddress: первый адрес становится default', async () => {
    tx.userAddress.count.mockResolvedValue(0);
    tx.userAddress.create.mockResolvedValue({
      id: 'a1',
      isDefault: true,
      city: 'Москва',
      address: 'Тверская 1',
    });

    await svc.createAddress('u1', {
      city: 'Москва',
      address: 'Тверская 1',
      isDefault: false,
    });

    expect(tx.userAddress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true }),
      }),
    );
  });

  it('updateAddress isDefault:true снимает default с остальных', async () => {
    prisma.userAddress.findUnique.mockResolvedValue({
      id: 'a2',
      userId: 'u1',
      isDefault: false,
    });
    tx.userAddress.update.mockResolvedValue({
      id: 'a2',
      isDefault: true,
      city: 'Москва',
      address: 'Арбат 2',
    });

    await svc.updateAddress('u1', 'a2', {
      city: 'Москва',
      address: 'Арбат 2',
      isDefault: true,
    });

    expect(tx.userAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isDefault: true },
      data: { isDefault: false },
    });
    expect(tx.userAddress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true }),
      }),
    );
  });

  it('updateAddress isDefault:false снимает default и промоутит другой', async () => {
    prisma.userAddress.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      isDefault: true,
    });
    tx.userAddress.update
      .mockResolvedValueOnce({
        id: 'a1',
        isDefault: false,
        city: 'Москва',
        address: 'Тверская 1',
      })
      .mockResolvedValueOnce({ id: 'a2', isDefault: true });
    tx.userAddress.findFirst.mockResolvedValue({ id: 'a2', userId: 'u1' });

    const res = await svc.updateAddress('u1', 'a1', {
      city: 'Москва',
      address: 'Тверская 1',
      isDefault: false,
    });

    expect(res.isDefault).toBe(false);
    expect(tx.userAddress.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ isDefault: false }),
      }),
    );
    expect(tx.userAddress.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'a2' },
        data: { isDefault: true },
      }),
    );
  });

  it('updateAddress → NotFound для чужого адреса', async () => {
    prisma.userAddress.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'other',
      isDefault: true,
    });
    await expect(
      svc.updateAddress('u1', 'a1', { city: 'X', address: 'Y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOrder отдаёт payToken для AWAITING_PAYMENT', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      number: 'J-1',
      status: 'AWAITING_PAYMENT',
      email: 'a@b.c',
      phone: '+79001112233',
      customerName: 'Ann',
      shippingAddress: { city: 'Москва', address: 'Тверская 1' },
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 0,
      total: 1000,
      refundedAmount: 0,
      promoCode: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      guestId: 'guest-1',
      createdAt: new Date(),
      items: [],
    });

    const res = await svc.getOrder('u1', 'o1');
    expect(res.payToken).toBe('tok');
    expect(res.canCancel).toBe(true);
    expect(res.payExpiresAt).toBeTruthy();
    expect(payTokens.issue).toHaveBeenCalledWith('o1', 'guest-1');
    expect(res.shippingAddress).toEqual(
      expect.objectContaining({ city: 'Москва', address: 'Тверская 1' }),
    );
  });

  it('getOrder → NotFound если заказ не найден', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(svc.getOrder('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
