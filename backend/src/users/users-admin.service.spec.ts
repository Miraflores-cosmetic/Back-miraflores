import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersAdminService } from './users-admin.service';

vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('hashed'),
}));

function makePrisma() {
  return {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userAddress: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    userQuizResult: {
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    quizEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    order: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    newsletterSubscriber: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(makePrisma());
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
}

describe('UsersAdminService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: UsersAdminService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new UsersAdminService(
      prisma as never,
      { updateUserGroup: vi.fn() } as never,
      { ensureForUser: vi.fn() } as never,
    );
  });

  it('listRetailUsers возвращает page/limit и orderCount', async () => {
    prisma.$transaction.mockResolvedValue([
      1,
      [
        {
          id: 'u1',
          email: 'a@b.c',
          displayName: 'Анна',
          isActive: true,
          createdAt: new Date('2026-01-01'),
          _count: { orders: 3 },
        },
      ],
    ]);

    const res = await svc.listRetailUsers({ page: 1, limit: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'Анна',
      orderCount: 3,
    });
  });

  it('getRetailUser → NotFound для админа / неактивного', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(svc.getRetailUser('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getRetailUser включает quiz saved + funnel', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'Анна',
      phone: null,
      birthday: null,
      marketingConsent: false,
      marketingConsentAt: null,
      privacyConsentAt: null,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      _count: { orders: 0 },
      addresses: [],
    });
    prisma.userQuizResult.findUnique.mockResolvedValue({
      version: 1,
      zone: 'face',
      answers: { skin_age: 'young', spf: 'yes', skin_issues: ['comedones'], skin_tasks: ['dryness'], swelling: 'no' },
      result: { priority: 1, blockKeys: ['step_1_spf'] },
      completedAt: new Date('2026-08-01T12:00:00.000Z'),
      updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    });
    prisma.quizEvent.findMany.mockResolvedValue([
      {
        type: 'quiz_complete',
        zone: 'face',
        stepKey: 'result',
        sessionId: 's1',
        meta: { blockKeys: ['step_1_spf'] },
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
      },
      {
        type: 'step_view',
        zone: 'face',
        stepKey: 'age',
        sessionId: 's1',
        meta: null,
        createdAt: new Date('2026-08-01T11:55:00.000Z'),
      },
      {
        type: 'quiz_start',
        zone: null,
        stepKey: null,
        sessionId: 's1',
        meta: null,
        createdAt: new Date('2026-08-01T11:50:00.000Z'),
      },
    ]);

    const res = await svc.getRetailUser('u1');
    expect(res.quiz.saved?.result.blockKeys).toEqual(['step_1_spf']);
    expect(res.quiz.stats.sessionsCount).toBe(1);
    expect(res.quiz.stats.eventsCount).toBe(3);
    expect(res.quiz.funnel.find((s) => s.key === 'start')?.viewed).toBe(true);
    expect(res.quiz.funnel.find((s) => s.key === 'age')?.viewed).toBe(true);
    expect(res.quiz.funnel.find((s) => s.key === 'result')?.completed).toBe(true);
  });

  it('deleteRetailUser деактивирует и анонимизирует PII', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.user.update.mockResolvedValue({});

    await expect(svc.deleteRetailUser('u1')).resolves.toEqual({ ok: true });
    expect(prisma.userAddress.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
    expect(prisma.userQuizResult.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          isActive: false,
          email: 'deleted-u1@deleted.jcos.local',
          displayName: null,
          phone: null,
          marketingConsent: false,
          marketingConsentAt: null,
          marketingConsentVersion: null,
          passwordHash: 'hashed',
        }),
      }),
    );
  });

  it('deleteRetailUser отклоняет уже удалённого', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', isActive: false });
    await expect(svc.deleteRetailUser('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateRetailUserProfile обновляет поля и нормализует телефон', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'old@x.co' });
    const updatedAt = new Date('2026-11-09T10:00:00.000Z');
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          update: vi.fn().mockResolvedValue({
            id: 'u1',
            email: 'new@x.co',
            displayName: 'Анна',
            phone: '+79991234567',
            birthday: new Date('1990-05-01T12:00:00.000Z'),
            updatedAt,
          }),
        },
        newsletterSubscriber: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const res = await svc.updateRetailUserProfile('u1', {
      email: 'New@x.co',
      displayName: 'Анна',
      phone: '8 (999) 123-45-67',
      birthday: '1990-05-01',
    });

    expect(res).toMatchObject({
      email: 'new@x.co',
      displayName: 'Анна',
      phone: '+79991234567',
      birthday: '1990-05-01',
    });
  });

  it('updateRetailUserProfile → Conflict при занятом email', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'old@x.co' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    await expect(
      svc.updateRetailUserProfile('u1', {
        email: 'taken@x.co',
        displayName: null,
        phone: null,
        birthday: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
