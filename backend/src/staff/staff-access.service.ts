import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALL_STAFF_SECTIONS_WITH_DASHBOARD,
  ADMIN_SECTION_DASHBOARD,
  normalizeStoredAdminSections,
  resolveAdminSectionFromApiPath,
  type AdminSectionId,
} from '@miraflores/admin-sections';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StaffAccessSnapshot, StaffContext } from './staff.types';
import {
  createStaffAccessCacheStore,
  InMemoryStaffAccessCache,
  type RedisStaffAccessCache,
  type StaffAccessCacheStore,
} from './staff-access-cache';

@Injectable()
export class StaffAccessService implements OnModuleInit, OnModuleDestroy {
  private static readonly ACCESS_CACHE_TTL_MS = 30_000;

  private readonly logger = new Logger(StaffAccessService.name);
  private cache: StaffAccessCacheStore = new InMemoryStaffAccessCache();
  private redisCache?: RedisStaffAccessCache;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { store, redis } = await createStaffAccessCacheStore(
      this.config.get<string>('REDIS_URL'),
    );
    this.cache = store;
    this.redisCache = redis;
    if (!redis) {
      this.logger.log('Staff ACL cache: in-memory (set REDIS_URL for horizontal scale)');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisCache?.onModuleDestroy();
  }

  invalidateStaffAccessCache(userId: string): void {
    void this.cache.delete(userId);
  }

  effectiveSections(
    role: UserRole,
    adminSections: readonly string[],
  ): AdminSectionId[] {
    if (role === UserRole.ADMIN) {
      return [...ALL_STAFF_SECTIONS_WITH_DASHBOARD];
    }
    if (role === UserRole.MODERATOR) {
      return [ADMIN_SECTION_DASHBOARD, ...normalizeStoredAdminSections(adminSections)];
    }
    return [];
  }

  private async loadStaffAccessSnapshot(
    userId: string,
    tokenVersion?: number,
  ): Promise<StaffAccessSnapshot | null> {
    const now = Date.now();
    const cached = await this.cache.get(userId);
    if (cached && now - cached.at < StaffAccessService.ACCESS_CACHE_TTL_MS) {
      if (
        tokenVersion === undefined ||
        cached.data.tokenVersion === tokenVersion
      ) {
        return cached.data;
      }
      void this.cache.delete(userId);
    }

    const user = await this.prisma.runInRlsTransaction(
      { userId, bypass: true },
      () =>
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            role: true,
            isActive: true,
            staffDeletedAt: true,
            adminSections: true,
            staffDisplayName: true,
            staffAvatarUrl: true,
            tokenVersion: true,
          },
        }),
    );
    if (
      !user ||
      user.staffDeletedAt ||
      (user.role !== UserRole.ADMIN && user.role !== UserRole.MODERATOR)
    ) {
      return null;
    }

    const data: StaffAccessSnapshot = {
      role: user.role,
      isActive: user.isActive,
      staffDeletedAt: user.staffDeletedAt,
      adminSections: user.adminSections,
      staffDisplayName: user.staffDisplayName,
      staffAvatarUrl: user.staffAvatarUrl,
      tokenVersion: user.tokenVersion ?? 0,
    };
    await this.cache.set(userId, { at: now, data }, StaffAccessService.ACCESS_CACHE_TTL_MS);
    return data;
  }

  async getStaffContext(
    userId: string,
    role: UserRole,
    tokenVersion?: number,
  ): Promise<StaffContext | null> {
    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) return null;
    const snapshot = await this.loadStaffAccessSnapshot(userId, tokenVersion);
    if (!snapshot?.isActive) return null;
    return {
      isSuperAdmin: snapshot.role === UserRole.ADMIN,
      sections: this.effectiveSections(snapshot.role, snapshot.adminSections),
      staffDisplayName: snapshot.staffDisplayName,
      staffAvatarUrl: snapshot.staffAvatarUrl,
    };
  }

  async canAccessApiPath(
    userId: string,
    role: string,
    pathOnly: string,
    tokenVersion?: number,
    method?: string,
  ): Promise<boolean> {
    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) return false;

    const target = resolveAdminSectionFromApiPath(pathOnly, method);
    if (target == null) return false;
    if (target === 'staff') return role === UserRole.ADMIN;

    const snapshot = await this.loadStaffAccessSnapshot(userId, tokenVersion);
    if (!snapshot?.isActive) return false;
    if (role === UserRole.ADMIN) return snapshot.role === UserRole.ADMIN;

    const sections = this.effectiveSections(UserRole.MODERATOR, snapshot.adminSections);
    if (target === 'certificates_read') {
      return (
        sections.includes('certificates') || sections.includes('certificates_finance')
      );
    }
    return sections.includes(target);
  }

  async isStaffAccountActive(userId: string, tokenVersion?: number): Promise<boolean> {
    const snapshot = await this.loadStaffAccessSnapshot(userId, tokenVersion);
    if (!snapshot || snapshot.staffDeletedAt) return false;
    return snapshot.isActive;
  }
}
