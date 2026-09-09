import { Module } from '@nestjs/common';
import { DiscountsAdminController } from './discounts-admin.controller';
import { DiscountsAdminService } from './discounts-admin.service';
import { DiscountsPublicService } from './discounts-public.service';

@Module({
  controllers: [DiscountsAdminController],
  providers: [DiscountsAdminService, DiscountsPublicService],
  exports: [DiscountsPublicService, DiscountsAdminService],
})
export class DiscountsModule {}
