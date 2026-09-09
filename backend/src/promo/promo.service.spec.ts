import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const promoCode = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const promoCodeRedemption = {
  count: vi.fn(),
  findFirst: vi.fn(),
};

vi.mock('../prisma/prisma.service', () => ({
  PrismaService: class {
    promoCode = promoCode;
    promoCodeRedemption = promoCodeRedemption;
    $transaction = (...args: unknown[]) => {
      if (typeof args[0] === 'function') {
        return (args[0] as (t: unknown) => unknown)({
          promoCode,
          promoCodeRedemption,
        });
      }
      return Promise.all(args[0] as Promise<unknown>[]);
    };
  },
}));

import {
  computePromoDiscount,
  PromoAdminService,
  PromoPublicService,
} from './promo.service';

function baseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    code: 'SALE10',
    type: 'PERCENT',
    value: 10,
    active: true,
    startsAt: null,
    endsAt: null,
    maxUses: null,
    oneShot: false,
    minOrderAmount: null,
    ...over,
  };
}

describe('computePromoDiscount', () => {
  it('PERCENT / FIXED', () => {
    expect(computePromoDiscount('PERCENT', 10, 2000)).toBe(200);
    expect(computePromoDiscount('FIXED', 150, 2000)).toBe(150);
  });

  it('неизвестный type не fallback на FIXED', () => {
    expect(() => computePromoDiscount('BOGUS', 150, 2000)).toThrow(BadRequestException);
  });
});

const commerceContext = {
  resolveFromUserId: vi.fn().mockResolvedValue({
    allowPromoCodes: true,
    kind: 'guest',
    groupId: 'g1',
  }),
};

describe('PromoPublicService', () => {
  let service: PromoPublicService;

  beforeEach(() => {
    promoCode.findUnique.mockReset();
    promoCodeRedemption.count.mockReset();
    promoCodeRedemption.findFirst.mockReset();
    promoCodeRedemption.count.mockResolvedValue(0);
    promoCodeRedemption.findFirst.mockResolvedValue(null);
    commerceContext.resolveFromUserId.mockResolvedValue({
      allowPromoCodes: true,
      kind: 'guest',
      groupId: 'g1',
    });
    service = new PromoPublicService(
      {
        promoCode,
        promoCodeRedemption,
      } as never,
      commerceContext as never,
    );
  });

  it('блокирует validate если allowPromoCodes=false', async () => {
    commerceContext.resolveFromUserId.mockResolvedValue({
      allowPromoCodes: false,
      kind: 'registered_group',
      groupId: 'g2',
    });
    await expect(service.validate('sale10', 2000)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('PERCENT считает скидку от subtotal', async () => {
    promoCode.findUnique.mockResolvedValue(baseRow());
    const res = await service.validate('sale10', 2000);
    expect(res.discountAmount).toBe(200);
    expect(res.total).toBe(1800);
  });

  it('minOrderAmount блокирует маленькую корзину', async () => {
    promoCode.findUnique.mockResolvedValue(
      baseRow({ code: 'BIG', type: 'FIXED', value: 100, minOrderAmount: 5000 }),
    );
    await expect(service.validate('BIG', 1000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('startsAt в будущем — отклоняет', async () => {
    promoCode.findUnique.mockResolvedValue(
      baseRow({
        code: 'LATER',
        type: 'FIXED',
        value: 50,
        startsAt: new Date(Date.now() + 86_400_000),
      }),
    );
    await expect(service.validate('LATER', 1000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('endsAt в прошлом — отклоняет', async () => {
    promoCode.findUnique.mockResolvedValue(
      baseRow({
        code: 'OLD',
        type: 'FIXED',
        value: 50,
        endsAt: new Date(Date.now() - 86_400_000),
      }),
    );
    await expect(service.validate('OLD', 1000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('окно дат действует сейчас — ок', async () => {
    promoCode.findUnique.mockResolvedValue(
      baseRow({
        code: 'NOW',
        type: 'FIXED',
        value: 100,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      }),
    );
    const res = await service.validate('NOW', 1000);
    expect(res.discountAmount).toBe(100);
  });

  it('checkout oneShot требует email и смотрит историю', async () => {
    promoCode.findUnique.mockResolvedValue(
      baseRow({ code: 'ONCE', type: 'FIXED', value: 100, oneShot: true }),
    );
    await expect(service.validate('ONCE', 1000)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.applyForCheckout('ONCE', 1000, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );

    promoCodeRedemption.findFirst.mockResolvedValue({ id: 'r1' });
    await expect(
      service.applyForCheckout('ONCE', 1000, { email: 'a@b.c' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maxUses исчерпан', async () => {
    promoCode.findUnique.mockResolvedValue(
      baseRow({ code: 'LIM', type: 'FIXED', value: 50, maxUses: 2 }),
    );
    promoCodeRedemption.count.mockResolvedValue(2);
    await expect(service.validate('LIM', 1000)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PromoAdminService', () => {
  let service: PromoAdminService;
  let prisma: {
    promoCode: typeof promoCode;
    promoCodeRedemption: typeof promoCodeRedemption;
    $transaction: (arg: unknown) => Promise<unknown>;
  };

  beforeEach(() => {
    promoCode.findUnique.mockReset();
    promoCode.findMany.mockReset();
    promoCode.count.mockReset();
    promoCode.create.mockReset();
    promoCode.update.mockReset();
    prisma = {
      promoCode,
      promoCodeRedemption,
      $transaction: async (arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return (arg as (t: typeof prisma) => unknown)(prisma);
      },
    };
    service = new PromoAdminService(prisma as never);
  });

  it('list фильтрует active', async () => {
    promoCode.count.mockResolvedValue(1);
    promoCode.findMany.mockResolvedValue([
      { ...baseRow({ active: false }), _count: { redemptions: 0 } },
    ]);
    await service.list({ active: false });
    expect(promoCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: false }),
      }),
    );
  });

  it('create нормализует код и пишет type', async () => {
    promoCode.create.mockResolvedValue(baseRow({ code: 'ABC' }));
    await service.create({
      code: ' abc ',
      type: 'FIXED',
      value: 200,
    });
    expect(promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'ABC',
        type: 'FIXED',
        value: 200,
        active: true,
      }),
    });
  });

  it('create отклоняет endsAt < startsAt', async () => {
    await expect(
      service.create({
        code: 'X',
        type: 'PERCENT',
        value: 10,
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(promoCode.create).not.toHaveBeenCalled();
  });

  it('delete с историей — только active=false', async () => {
    promoCode.findUnique.mockResolvedValue({
      ...baseRow(),
      _count: { redemptions: 2 },
    });
    promoCode.update.mockResolvedValue(baseRow({ active: false }));
    const res = await service.delete('p1');
    expect(res).toEqual(
      expect.objectContaining({ ok: true, deactivated: true }),
    );
    expect(promoCode.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { active: false },
    });
    expect(promoCode.delete).not.toHaveBeenCalled();
  });

  it('delete без истории — hard delete', async () => {
    promoCode.findUnique.mockResolvedValue({
      ...baseRow(),
      _count: { redemptions: 0 },
    });
    promoCode.delete.mockResolvedValue(baseRow());
    const res = await service.delete('p1');
    expect(res).toEqual({ ok: true, deactivated: false });
    expect(promoCode.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });
});
