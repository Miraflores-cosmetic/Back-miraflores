import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  CatalogVisibilityMode,
  CatalogVisibilityTarget,
  GroupCategoryPriceType,
} from '@prisma/client';
import { UserGroupsAdminService } from './user-groups-admin.service';

function makeService() {
  const prisma = {
    userGroup: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    groupCategoryPrice: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    groupVariantPrice: { findMany: vi.fn() },
    catalogGroupVisibility: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    category: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    product: { findMany: vi.fn(), findUnique: vi.fn() },
    productVariant: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
  const commerceContext = { refreshDefaults: vi.fn() };
  const catalogVisibility = { invalidateCache: vi.fn() };
  const svc = new UserGroupsAdminService(
    prisma as never,
    commerceContext as never,
    catalogVisibility as never,
  );
  return { svc, prisma, commerceContext, catalogVisibility };
}

describe('UserGroupsAdminService guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects deactivating system group', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findUnique.mockResolvedValue({
      id: 'ug_guest',
      slug: 'guests',
      isDefaultGuest: true,
      isDefaultRegistered: false,
    });
    await expect(svc.update('ug_guest', { active: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects slug change on system group', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findUnique.mockResolvedValue({
      id: 'ug_guest',
      slug: 'guests',
      isDefaultGuest: true,
      isDefaultRegistered: false,
    });
    await expect(svc.update('ug_guest', { slug: 'new-slug' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects category price on non-leaf category', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findUnique.mockResolvedValue({ id: 'g1', assignable: true });
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-parent' });
    prisma.category.findFirst.mockResolvedValue({ id: 'child' });
    await expect(
      svc.upsertCategoryPrice('g1', 'cat-parent', {
        type: GroupCategoryPriceType.PERCENT_OFF,
        value: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createGroupVisibility binds groupId for HIDE_FROM_GROUP', async () => {
    const { svc, prisma, catalogVisibility } = makeService();
    prisma.userGroup.findUnique.mockResolvedValue({ id: 'g1' });
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.catalogGroupVisibility.create.mockResolvedValue({
      id: 'vis1',
      mode: CatalogVisibilityMode.HIDE_FROM_GROUP,
      groupId: 'g1',
      targetType: CatalogVisibilityTarget.PRODUCT,
      targetId: 'p1',
    });
    await svc.createGroupVisibility('g1', {
      mode: CatalogVisibilityMode.HIDE_FROM_GROUP,
      targetType: CatalogVisibilityTarget.PRODUCT,
      targetId: 'p1',
    });
    expect(prisma.catalogGroupVisibility.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ groupId: 'g1' }),
      }),
    );
    expect(catalogVisibility.invalidateCache).toHaveBeenCalled();
  });

  it('listGroupVisibility enriches targetLabel', async () => {
    const { svc, prisma } = makeService();
    prisma.userGroup.findUnique.mockResolvedValue({ id: 'g1' });
    prisma.catalogGroupVisibility.findMany.mockResolvedValue([
      {
        id: 'v1',
        mode: CatalogVisibilityMode.HIDE_FROM_GROUP,
        groupId: 'g1',
        targetType: CatalogVisibilityTarget.PRODUCT,
        targetId: 'p1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', name: 'Крем' }]);
    const res = await svc.listGroupVisibility('g1');
    expect(res.items[0]?.targetLabel).toBe('Крем');
  });
});
