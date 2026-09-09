import { Module } from '@nestjs/common';
import { DiscountsModule } from '../discounts/discounts.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogCategoriesAdminService } from './catalog-categories.admin.service';
import { CatalogCollectionsAdminService } from './catalog-collections.admin.service';
import { CatalogProductSetsAdminService } from './catalog-product-sets.admin.service';
import { CatalogProductsAdminService } from './catalog-products.admin.service';
import { CatalogPublicController } from './catalog.public.controller';
import { CatalogPublicService } from './catalog.public.service';
import { CatalogTagsAdminService } from './catalog-tags.admin.service';

@Module({
  imports: [StorageModule, DiscountsModule, SettingsModule, UserGroupsModule],
  controllers: [CatalogAdminController, CatalogPublicController],
  providers: [
    CatalogCategoriesAdminService,
    CatalogTagsAdminService,
    CatalogProductsAdminService,
    CatalogCollectionsAdminService,
    CatalogProductSetsAdminService,
    CatalogPublicService,
  ],
  exports: [CatalogPublicService, CatalogProductsAdminService],
})
export class CatalogModule {}
