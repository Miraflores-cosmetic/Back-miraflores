import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralCodeService } from './referral-code.service';

describe('ReferralCodeService', () => {
  let prisma: {
    user: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    referralCodeAlias: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let settings: { ensureDefaults: ReturnType<typeof vi.fn> };
  let svc: ReferralCodeService;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      referralCodeAlias: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn(async (fn: (t: typeof prisma) => unknown) => fn(prisma)),
    };
    settings = {
      ensureDefaults: vi.fn().mockResolvedValue({ linkTtlDays: 60 }),
    };
    svc = new ReferralCodeService(prisma as never, settings as never);
  });

  describe('setActive', () => {
    it('ставит referralCodeActive', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      await svc.setActive('u1', false);
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', role: UserRole.USER },
        data: { referralCodeActive: false },
      });
    });

    it('404 если пользователь не найден', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.setActive('missing', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('regenerateForUser', () => {
    it('меняет код и пишет alias со grace', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce({
          id: 'u1',
          isActive: true,
          referralCodeActive: false,
          referralCode: 'OLDCODE1',
        })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({});
      prisma.referralCodeAlias.upsert.mockResolvedValue({});

      const out = await svc.regenerateForUser('u1', { grace: true });
      expect(out.active).toBe(false);
      expect(out.grace).toBe(true);
      expect(out.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(prisma.referralCodeAlias.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code: 'OLDCODE1' },
          create: expect.objectContaining({
            userId: 'u1',
            code: 'OLDCODE1',
            expiresAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.referralCodeAlias.deleteMany).not.toHaveBeenCalled();
    });

    it('grace:false — без alias, deleteMany aliases пользователя', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce({
          id: 'u1',
          isActive: true,
          referralCodeActive: true,
          referralCode: 'OLDCODE1',
        })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({});

      const out = await svc.regenerateForUser('u1', { grace: false });
      expect(out.grace).toBe(false);
      expect(prisma.referralCodeAlias.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(prisma.referralCodeAlias.upsert).not.toHaveBeenCalled();
    });

    it('404 для неактивного / не USER', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(svc.regenerateForUser('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('P2002 на update → retry allocate', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce({
          id: 'u1',
          isActive: true,
          referralCodeActive: true,
          referralCode: 'OLDCODE1',
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.user.update
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        )
        .mockResolvedValueOnce({});
      prisma.referralCodeAlias.upsert.mockResolvedValue({});

      const out = await svc.regenerateForUser('u1', { grace: true });
      expect(out.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveByCode', () => {
    it('live code', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      await expect(svc.resolveByCode('anna1')).resolves.toEqual({
        userId: 'u1',
        code: 'ANNA1',
        matchedByCodeAlias: false,
      });
    });

    it('alias в grace', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.referralCodeAlias.findFirst.mockResolvedValue({ userId: 'u1' });
      await expect(svc.resolveByCode('OLDCODE1')).resolves.toEqual({
        userId: 'u1',
        code: 'OLDCODE1',
        matchedByCodeAlias: true,
      });
    });

    it('истёкший / неизвестный → null', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.referralCodeAlias.findFirst.mockResolvedValue(null);
      await expect(svc.resolveByCode('GONE1234')).resolves.toBeNull();
    });
  });

  describe('ensureForUser', () => {
    it('возвращает существующий код без create', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        referralCode: 'EXISTING1',
        referralCodeActive: true,
        role: UserRole.USER,
        isActive: true,
      });
      const out = await svc.ensureForUser('u1');
      expect(out).toEqual({
        code: 'EXISTING1',
        created: false,
        active: true,
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('404 если пользователь неактивен', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        referralCode: null,
        referralCodeActive: true,
        role: UserRole.USER,
        isActive: false,
      });
      await expect(svc.ensureForUser('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('allocateUniqueCode', () => {
    it('бросает если все коды заняты', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'taken' });
      await expect(svc.allocateUniqueCode()).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
