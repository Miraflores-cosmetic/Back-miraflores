import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReferralAdminController } from './referral-admin.controller';
import { ReferralCodeService } from './referral-code.service';
import { ReferralSettingsService } from './referral-settings.service';
import { ReferralWalletService } from './referral-wallet.service';
import { ReferralWalletWorker } from './referral-wallet.worker';

@Module({
  imports: [PrismaModule],
  controllers: [ReferralAdminController],
  providers: [
    ReferralSettingsService,
    ReferralCodeService,
    ReferralWalletService,
    ReferralWalletWorker,
  ],
  exports: [
    ReferralSettingsService,
    ReferralCodeService,
    ReferralWalletService,
  ],
})
export class ReferralModule {}
