import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PromoModule } from '../promo/promo.module';
import { GiftCertificatesModule } from '../gift-certificates/gift-certificates.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { CarrierShipmentService } from './carrier-shipment.service';
import { OrdersAdminController } from './orders-admin.controller';
import { OrdersAdminService } from './orders-admin.service';
import { OrdersExpiryWorker } from './orders-expiry.worker';
import { OrderPayTokenService } from './order-pay-token.service';
import { ShippingQuoteService } from './shipping-quote.service';
import { ShippingServerEstimateService } from './shipping-server-estimate.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersPublicController } from './orders.public.controller';
import { OrdersPublicService } from './orders.public.service';
import { YooKassaService } from './yookassa.service';
import { MailModule } from '../mail/mail.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';

@Module({
  imports: [
    PrismaModule,
    CatalogModule,
    UserGroupsModule,
    PromoModule,
    GiftCertificatesModule,
    SettingsModule,
    MailModule,
  ],
  controllers: [OrdersPublicController, OrdersAdminController],
  providers: [
    OrdersPublicService,
    OrdersAdminService,
    OrderLifecycleService,
    YooKassaService,
    OrderPayTokenService,
    ShippingQuoteService,
    ShippingServerEstimateService,
    CarrierShipmentService,
    OrdersExpiryWorker,
  ],
  exports: [OrdersAdminService],
})
export class OrdersModule {}
