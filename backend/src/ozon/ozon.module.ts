import { Module } from '@nestjs/common';
import { OzonAdminController } from './ozon-admin.controller';
import { OzonAuthService } from './ozon-auth.service';
import { OzonCatalogDimsService } from './ozon-catalog-dims.service';
import { OzonHealthService } from './ozon-health.service';
import { OzonPointsService } from './ozon-points.service';
import { OzonReconciliationService } from './ozon-reconciliation.service';
import { OzonPublicController } from './ozon.public.controller';

@Module({
  controllers: [OzonPublicController, OzonAdminController],
  providers: [
    OzonAuthService,
    OzonPointsService,
    OzonHealthService,
    OzonCatalogDimsService,
    OzonReconciliationService,
  ],
  exports: [OzonAuthService],
})
export class OzonModule {}
