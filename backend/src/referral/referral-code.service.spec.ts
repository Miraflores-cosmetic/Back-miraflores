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
  };
  let svc: ReferralCodeService;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    svc = new ReferralCodeService(prisma as never);
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
    it('меняет код, сохраняет active', async () => {
      // 1) user lookup  2) allocateUniqueCode collision check
      prisma.user.findFirst
        .mockResolvedValueOnce({
          id: 'u1',
          isActive: true,
          referralCodeActive: false,
        })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({});

      const out = await svc.regenerateForUser('u1');
      expect(out.active).toBe(false);
      expect(out.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { referralCode: out.code },
      });
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
        })
        .mockResolvedValueOnce(null) // alloc 1 free
        .mockResolvedValueOnce(null); // alloc 2 free
      prisma.user.update
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        )
        .mockResolvedValueOnce({});

      const out = await svc.regenerateForUser('u1');
      expect(out.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
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
