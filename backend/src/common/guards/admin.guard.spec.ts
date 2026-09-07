import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AdminGuard } from './admin.guard';
import type { JwtPayload } from '../decorators/current-user.decorator';

function makeContext(user?: JwtPayload, path = '/api/v1/orders/admin'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        originalUrl: path,
      }),
    }),
  } as ExecutionContext;
}

describe('AdminGuard', () => {
  const staffAccess = {
    isStaffAccountActive: vi.fn(),
    canAccessApiPath: vi.fn(),
  };
  let guard: AdminGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new AdminGuard(staffAccess as never);
    staffAccess.isStaffAccountActive.mockResolvedValue(true);
    staffAccess.canAccessApiPath.mockResolvedValue(true);
  });

  it('без user → UnauthorizedException', async () => {
    await expect(guard.canActivate(makeContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('без sub → UnauthorizedException', async () => {
    await expect(
      guard.canActivate(makeContext({ sub: '', role: UserRole.ADMIN } as JwtPayload)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('не staff role → ForbiddenException', async () => {
    await expect(
      guard.canActivate(makeContext({ sub: 'u1', role: UserRole.USER } as JwtPayload)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deactivated staff → ForbiddenException', async () => {
    staffAccess.isStaffAccountActive.mockResolvedValue(false);
    await expect(
      guard.canActivate(makeContext({ sub: 'm1', role: UserRole.MODERATOR } as JwtPayload)),
    ).rejects.toMatchObject({ message: 'Учётная запись деактивирована' });
  });

  it('ADMIN → allow без ACL check', async () => {
    await expect(
      guard.canActivate(makeContext({ sub: 'a1', role: UserRole.ADMIN } as JwtPayload)),
    ).resolves.toBe(true);
    expect(staffAccess.canAccessApiPath).not.toHaveBeenCalled();
  });

  it('MODERATOR с grant → allow', async () => {
    staffAccess.canAccessApiPath.mockResolvedValue(true);
    await expect(
      guard.canActivate(
        makeContext({ sub: 'm1', role: UserRole.MODERATOR } as JwtPayload, '/api/v1/orders/admin'),
      ),
    ).resolves.toBe(true);
    expect(staffAccess.canAccessApiPath).toHaveBeenCalledWith(
      'm1',
      UserRole.MODERATOR,
      '/api/v1/orders/admin',
      undefined,
      undefined,
    );
  });

  it('MODERATOR передаёт tokenVersion в StaffAccessService', async () => {
    staffAccess.canAccessApiPath.mockResolvedValue(true);
    await guard.canActivate(
      makeContext(
        { sub: 'm1', role: UserRole.MODERATOR, tv: 3 } as JwtPayload,
        '/api/v1/orders/admin',
      ),
    );
    expect(staffAccess.isStaffAccountActive).toHaveBeenCalledWith('m1', 3);
    expect(staffAccess.canAccessApiPath).toHaveBeenCalledWith(
      'm1',
      UserRole.MODERATOR,
      '/api/v1/orders/admin',
      3,
      undefined,
    );
  });

  it('MODERATOR без grant → ForbiddenException', async () => {
    staffAccess.canAccessApiPath.mockResolvedValue(false);
    await expect(
      guard.canActivate(
        makeContext(
          { sub: 'm1', role: UserRole.MODERATOR } as JwtPayload,
          '/api/v1/catalog/admin/products',
        ),
      ),
    ).rejects.toMatchObject({ message: 'Нет доступа к этому разделу админки' });
  });

  it('MODERATOR mark-paid без orders_finance → deny через StaffAccessService', async () => {
    staffAccess.canAccessApiPath.mockResolvedValue(false);
    await expect(
      guard.canActivate(
        makeContext(
          { sub: 'm1', role: UserRole.MODERATOR } as JwtPayload,
          '/api/v1/orders/admin/x/mark-paid',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
