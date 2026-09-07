import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { StaffAccessService } from './staff-access.service';

function makePrisma(snapshot: {
  role: UserRole;
  isActive: boolean;
  staffDeletedAt?: Date | null;
  adminSections?: string[];
  tokenVersion?: number;
} | null) {
  return {
    runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => fn()),
    user: {
      findUnique: vi.fn(async () =>
        snapshot
          ? {
              role: snapshot.role,
              isActive: snapshot.isActive,
              staffDeletedAt: snapshot.staffDeletedAt ?? null,
              adminSections: snapshot.adminSections ?? [],
              staffDisplayName: null,
              staffAvatarUrl: null,
              tokenVersion: snapshot.tokenVersion ?? 0,
            }
          : null,
      ),
    },
  };
}

describe('StaffAccessService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: StaffAccessService;

  beforeEach(() => {
    prisma = makePrisma({
      role: UserRole.MODERATOR,
      isActive: true,
      adminSections: ['orders'],
    });
    svc = new StaffAccessService(prisma as never, {
      get: vi.fn(() => undefined),
    } as unknown as ConfigService);
  });

  it('ADMIN effectiveSections — все секции из пакета', () => {
    const sections = svc.effectiveSections(UserRole.ADMIN, []);
    expect(sections).toContain('dashboard');
    expect(sections).toContain('orders_finance');
    expect(sections).toContain('assistant');
    expect(sections.length).toBeGreaterThan(10);
  });

  it('MODERATOR effectiveSections — dashboard + grants', () => {
    expect(svc.effectiveSections(UserRole.MODERATOR, ['catalog', 'dashboard'])).toEqual([
      'dashboard',
      'catalog',
    ]);
  });

  it('moderator matrix: orders vs catalog API', async () => {
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin/abc'),
    ).toBe(true);
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/catalog/admin/products'),
    ).toBe(false);
  });

  it('orders_finance split: mark-paid/refund vs packing', async () => {
    prisma = makePrisma({
      role: UserRole.MODERATOR,
      isActive: true,
      adminSections: ['orders'],
    });
    svc = new StaffAccessService(prisma as never);

    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin/x/mark-paid'),
    ).toBe(false);
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin/x/refund'),
    ).toBe(false);
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin/x/packing'),
    ).toBe(true);

    prisma = makePrisma({
      role: UserRole.MODERATOR,
      isActive: true,
      adminSections: ['orders_finance'],
    });
    svc = new StaffAccessService(prisma as never);

    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin/x/mark-paid'),
    ).toBe(true);
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin/x/packing'),
    ).toBe(false);
  });

  it('certificates_finance split: issue/revoke vs denoms mutate', async () => {
    prisma = makePrisma({
      role: UserRole.MODERATOR,
      isActive: true,
      adminSections: ['certificates'],
    });
    svc = new StaffAccessService(prisma as never);

    expect(
      await svc.canAccessApiPath(
        'm1',
        UserRole.MODERATOR,
        '/api/v1/gift-certificates/admin/issue',
        undefined,
        'POST',
      ),
    ).toBe(false);
    expect(
      await svc.canAccessApiPath(
        'm1',
        UserRole.MODERATOR,
        '/api/v1/gift-certificates/admin/denominations',
        undefined,
        'POST',
      ),
    ).toBe(true);
    expect(
      await svc.canAccessApiPath(
        'm1',
        UserRole.MODERATOR,
        '/api/v1/gift-certificates/admin',
        undefined,
        'GET',
      ),
    ).toBe(true);

    prisma = makePrisma({
      role: UserRole.MODERATOR,
      isActive: true,
      adminSections: ['certificates_finance'],
    });
    svc = new StaffAccessService(prisma as never);

    expect(
      await svc.canAccessApiPath(
        'm1',
        UserRole.MODERATOR,
        '/api/v1/gift-certificates/admin/issue',
        undefined,
        'POST',
      ),
    ).toBe(true);
    expect(
      await svc.canAccessApiPath(
        'm1',
        UserRole.MODERATOR,
        '/api/v1/gift-certificates/admin/c1/revoke',
        undefined,
        'POST',
      ),
    ).toBe(true);
    expect(
      await svc.canAccessApiPath(
        'm1',
        UserRole.MODERATOR,
        '/api/v1/gift-certificates/admin/denominations',
        undefined,
        'POST',
      ),
    ).toBe(false);
    expect(
      await svc.canAccessApiPath(
        'm1',
        UserRole.MODERATOR,
        '/api/v1/gift-certificates/admin/denominations',
        undefined,
        'GET',
      ),
    ).toBe(true);
  });

  it('staff CRUD API — только ADMIN', async () => {
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/settings/admin/staff'),
    ).toBe(false);

    prisma = makePrisma({ role: UserRole.ADMIN, isActive: true, adminSections: [] });
    svc = new StaffAccessService(prisma as never);
    expect(
      await svc.canAccessApiPath('a1', UserRole.ADMIN, '/api/v1/settings/admin/staff'),
    ).toBe(true);
  });

  it('staff-profile доступен модератору (dashboard)', async () => {
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/settings/admin/staff-profile'),
    ).toBe(true);
  });

  it('unmapped API path → deny', async () => {
    prisma = makePrisma({ role: UserRole.ADMIN, isActive: true, adminSections: [] });
    svc = new StaffAccessService(prisma as never);
    expect(
      await svc.canAccessApiPath('a1', UserRole.ADMIN, '/api/v1/settings/applicable-gift'),
    ).toBe(false);
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/public/foo'),
    ).toBe(false);
  });

  it('deactivated staff → inactive + deny API', async () => {
    prisma = makePrisma({
      role: UserRole.MODERATOR,
      isActive: false,
      adminSections: ['orders'],
    });
    svc = new StaffAccessService(prisma as never);

    expect(await svc.isStaffAccountActive('m1')).toBe(false);
    expect(
      await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin'),
    ).toBe(false);
  });

  it('invalidateStaffAccessCache сбрасывает snapshot', async () => {
    await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    svc.invalidateStaffAccessCache('m1');
    await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('tokenVersion mismatch → cache miss без invalidateStaffAccessCache', async () => {
    await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin', 1);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    await svc.canAccessApiPath('m1', UserRole.MODERATOR, '/api/v1/orders/admin', 2);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
