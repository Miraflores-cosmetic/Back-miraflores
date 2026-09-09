import { Module } from '@nestjs/common';
import { DiscountsModule } from '../discounts/discounts.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderPayTokenService } from '../orders/order-pay-token.service';
import { YooKassaService } from '../orders/yookassa.service';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { FavoritesService } from './favorites.service';
import { QuizResultService } from './quiz-result.service';

@Module({
  imports: [PrismaModule, UserGroupsModule, DiscountsModule],
  controllers: [AccountController],
  providers: [
    AccountService,
    FavoritesService,
    QuizResultService,
    OrderPayTokenService,
    YooKassaService,
  ],
})
export class AccountModule {}
