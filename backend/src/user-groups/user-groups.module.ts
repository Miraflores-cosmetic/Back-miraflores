import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogVisibilityService } from './catalog-visibility.service';
import { CommerceContextService } from './commerce-context.service';
import { GroupPricingService } from './group-pricing.service';
import {
  CatalogVisibilityAdminController,
  UserGroupsAdminController,
} from './user-groups-admin.controller';
import { UserGroupsAdminService } from './user-groups-admin.service';
import { UserGroupsSharedCacheService } from './user-groups-shared-cache.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserGroupsAdminController, CatalogVisibilityAdminController],
  providers: [
    UserGroupsSharedCacheService,
    CommerceContextService,
    GroupPricingService,
    CatalogVisibilityService,
    UserGroupsAdminService,
  ],
  exports: [
    UserGroupsSharedCacheService,
    CommerceContextService,
    GroupPricingService,
    CatalogVisibilityService,
    UserGroupsAdminService,
  ],
})
export class UserGroupsModule {}
