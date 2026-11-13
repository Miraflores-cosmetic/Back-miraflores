import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscountsModule } from '../discounts/discounts.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderPayTokenService } from '../orders/order-pay-token.service';
import { YooKassaService } from '../orders/yookassa.service';
import { YandexPayService } from '../orders/yandex-pay.service';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { FavoritesService } from './favorites.service';
import { QuizResultService } from './quiz-result.service';
import { OrderChatModule } from '../order-chat/order-chat.module';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    UserGroupsModule,
    DiscountsModule,
    OrderChatModule,
    ReferralModule,
  ],
  controllers: [AccountController],
  providers: [
    AccountService,
    FavoritesService,
    QuizResultService,
    OrderPayTokenService,
    YooKassaService,
    YandexPayService,
  ],
})
export class AccountModule {}
