import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';
import { PromoAdminController } from './promo-admin.controller';
import { PromoPublicController } from './promo.public.controller';
import { PromoAdminService, PromoPublicService } from './promo.service';

@Module({
  imports: [PrismaModule, UserGroupsModule],
  controllers: [PromoAdminController, PromoPublicController],
  providers: [PromoAdminService, PromoPublicService],
  exports: [PromoPublicService, PromoAdminService],
})
export class PromoModule {}
