import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CommerceContext, CommerceContextKind } from './commerce-context.types';
import {
  UserGroupsSharedCacheService,
  type DefaultGroupsCache,
} from './user-groups-shared-cache.service';

@Injectable()
export class CommerceContextService implements OnModuleInit {
  private readonly logger = new Logger(CommerceContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sharedCache: UserGroupsSharedCacheService,
  ) {}

  async onModuleInit() {
    await this.sharedCache.getDefaults(() => this.loadDefaultsFromDb());
  }

  async refreshDefaults(): Promise<void> {
    this.sharedCache.invalidate();
  }

  /** Buyer JWT sub for role USER; staff/admin tokens → guest catalog context. */
  async resolveFromUserId(userId?: string | null): Promise<CommerceContext> {
    if (!userId?.trim()) {
      return this.guestContext();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId.trim() },
      select: {
        id: true,
        role: true,
        isActive: true,
        groupId: true,
        group: {
          select: {
            id: true,
            name: true,
            slug: true,
            active: true,
            allowCatalogDiscounts: true,
            allowPromoCodes: true,
            priceRounding: true,
          },
        },
      },
    });

    if (!user || user.role !== UserRole.USER || !user.isActive) {
      return this.guestContext();
    }

    await this.ensureDefaults();
    const registeredDefault = (await this.sharedCache.getDefaults(() => this.loadDefaultsFromDb()))!
      .registered;

    if (user.groupId && user.group?.active) {
      const kind: CommerceContextKind = 'registered_group';
      return {
        kind,
        groupId: user.group.id,
        groupName: user.group.name,
        groupSlug: user.group.slug,
        allowCatalogDiscounts: user.group.allowCatalogDiscounts,
        allowPromoCodes: user.group.allowPromoCodes,
        priceRounding: user.group.priceRounding,
        isGuest: false,
        isRegistered: true,
        userId: user.id,
        userGroupId: user.groupId,
      };
    }

    return {
      kind: 'registered_default',
      groupId: registeredDefault.id,
      groupName: registeredDefault.name,
      groupSlug: registeredDefault.slug,
      allowCatalogDiscounts: registeredDefault.allowCatalogDiscounts,
      allowPromoCodes: registeredDefault.allowPromoCodes,
      priceRounding: registeredDefault.priceRounding,
      isGuest: false,
      isRegistered: true,
      userId: user.id,
      userGroupId: null,
    };
  }

  async guestContext(): Promise<CommerceContext> {
    await this.ensureDefaults();
    const g = (await this.sharedCache.getDefaults(() => this.loadDefaultsFromDb()))!.guest;
    return {
      kind: 'guest',
      groupId: g.id,
      groupName: g.name,
      groupSlug: g.slug,
      allowCatalogDiscounts: g.allowCatalogDiscounts,
      allowPromoCodes: g.allowPromoCodes,
      priceRounding: g.priceRounding,
      isGuest: true,
      isRegistered: false,
    };
  }

  private async ensureDefaults(): Promise<void> {
    const defaults = await this.sharedCache.getDefaults(() => this.loadDefaultsFromDb());
    if (!defaults) {
      throw new Error('UserGroup defaults missing: seed isDefaultGuest / isDefaultRegistered');
    }
  }

  private async loadDefaultsFromDb(): Promise<DefaultGroupsCache | null> {
    const guestRows = await this.prisma.userGroup.findMany({
      where: { isDefaultGuest: true },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        allowCatalogDiscounts: true,
        allowPromoCodes: true,
        priceRounding: true,
      },
    });
    const registeredRows = await this.prisma.userGroup.findMany({
      where: { isDefaultRegistered: true },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        allowCatalogDiscounts: true,
        allowPromoCodes: true,
        priceRounding: true,
      },
    });
    if (guestRows.length > 1) {
      this.logger.warn(
        `Multiple isDefaultGuest groups (${guestRows.length}); using ${guestRows[0]!.id}`,
      );
    }
    if (registeredRows.length > 1) {
      this.logger.warn(
        `Multiple isDefaultRegistered groups (${registeredRows.length}); using ${registeredRows[0]!.id}`,
      );
    }
    const guest = guestRows[0];
    const registered = registeredRows[0];
    if (!guest || !registered) {
      return null;
    }
    return {
      guest: {
        id: guest.id,
        name: guest.name,
        slug: guest.slug,
        allowCatalogDiscounts: guest.allowCatalogDiscounts,
        allowPromoCodes: guest.allowPromoCodes,
        priceRounding: guest.priceRounding,
      },
      registered: {
        id: registered.id,
        name: registered.name,
        slug: registered.slug,
        allowCatalogDiscounts: registered.allowCatalogDiscounts,
        allowPromoCodes: registered.allowPromoCodes,
        priceRounding: registered.priceRounding,
      },
    };
  }
}
