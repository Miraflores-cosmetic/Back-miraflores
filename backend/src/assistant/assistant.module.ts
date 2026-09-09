import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { OrdersModule } from '../orders/orders.module';
import { PromoModule } from '../promo/promo.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StaffModule } from '../staff/staff.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';
import { AssistantAdminController } from './assistant-admin.controller';
import { AssistantService } from './assistant.service';
import { AssistantToolsService } from './assistant-tools.service';
import { GptunnelClient } from './gptunnel.client';

@Module({
  imports: [
    PrismaModule,
    StaffModule,
    DashboardModule,
    OrdersModule,
    CatalogModule,
    UserGroupsModule,
    DiscountsModule,
    PromoModule,
  ],
  controllers: [AssistantAdminController],
  providers: [AssistantService, AssistantToolsService, GptunnelClient],
})
export class AssistantModule {}
