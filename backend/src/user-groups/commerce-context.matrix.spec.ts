import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { CommerceContextService } from './commerce-context.service';

const defaults = {
  guest: {
    id: 'ug_guest',
    name: 'Гости',
    slug: 'guests',
    allowCatalogDiscounts: false,
    allowPromoCodes: true,
    priceRounding: 'NEAREST' as const,
  },
  registered: {
    id: 'ug_retail',
    name: 'Розница',
    slug: 'retail-registered',
    allowCatalogDiscounts: true,
    allowPromoCodes: true,
    priceRounding: 'NEAREST' as const,
  },
};

function makeService() {
  const prisma = {
    userGroup: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  const sharedCache = {
    getDefaults: vi.fn(async (loader: () => Promise<typeof defaults | null>) => loader()),
    invalidate: vi.fn(),
  };
  const svc = new CommerceContextService(prisma as never, sharedCache as never);
  return { svc, prisma, sharedCache };
}

describe('CommerceContextService context matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no userId → guest defaults', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findMany.mockImplementation(({ where }: { where: { isDefaultGuest?: boolean } }) => {
      if (where.isDefaultGuest) return [defaults.guest];
      return [defaults.registered];
    });

    const c = await svc.resolveFromUserId(null);
    expect(c.kind).toBe('guest');
    expect(c.groupId).toBe('ug_guest');
    expect(c.isGuest).toBe(true);
    expect(c.allowCatalogDiscounts).toBe(false);
  });

  it('registered user without groupId → registered_default', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findMany.mockImplementation(({ where }: { where: { isDefaultGuest?: boolean } }) => {
      if (where.isDefaultGuest) return [defaults.guest];
      return [defaults.registered];
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: UserRole.USER,
      isActive: true,
      groupId: null,
      group: null,
    });

    const c = await svc.resolveFromUserId('u1');
    expect(c.kind).toBe('registered_default');
    expect(c.groupId).toBe('ug_retail');
    expect(c.userGroupId).toBeNull();
    expect(c.allowCatalogDiscounts).toBe(true);
  });

  it('registered user with active custom group → registered_group', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findMany.mockImplementation(({ where }: { where: { isDefaultGuest?: boolean } }) => {
      if (where.isDefaultGuest) return [defaults.guest];
      return [defaults.registered];
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u2',
      role: UserRole.USER,
      isActive: true,
      groupId: 'ug_wholesale',
      group: {
        id: 'ug_wholesale',
        name: 'Опт',
        slug: 'wholesale',
        active: true,
        allowCatalogDiscounts: false,
        allowPromoCodes: false,
        priceRounding: 'FLOOR',
      },
    });

    const c = await svc.resolveFromUserId('u2');
    expect(c.kind).toBe('registered_group');
    expect(c.groupId).toBe('ug_wholesale');
    expect(c.allowPromoCodes).toBe(false);
    expect(c.priceRounding).toBe('FLOOR');
  });

  it('inactive custom group → falls back to registered_default', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findMany.mockImplementation(({ where }: { where: { isDefaultGuest?: boolean } }) => {
      if (where.isDefaultGuest) return [defaults.guest];
      return [defaults.registered];
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u3',
      role: UserRole.USER,
      isActive: true,
      groupId: 'ug_wholesale',
      group: {
        id: 'ug_wholesale',
        name: 'Опт',
        slug: 'wholesale',
        active: false,
        allowCatalogDiscounts: false,
        allowPromoCodes: false,
        priceRounding: 'FLOOR',
      },
    });

    const c = await svc.resolveFromUserId('u3');
    expect(c.kind).toBe('registered_default');
    expect(c.groupId).toBe('ug_retail');
  });

  it('staff token → guest catalog context', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findMany.mockImplementation(({ where }: { where: { isDefaultGuest?: boolean } }) => {
      if (where.isDefaultGuest) return [defaults.guest];
      return [defaults.registered];
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin1',
      role: UserRole.ADMIN,
      isActive: true,
      groupId: null,
      group: null,
    });

    const c = await svc.resolveFromUserId('admin1');
    expect(c.kind).toBe('guest');
  });
});
