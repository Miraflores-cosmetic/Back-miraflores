import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReferralAdminController } from './referral-admin.controller';
import { ReferralPublicController } from './referral-public.controller';
import { ReferralCodeService } from './referral-code.service';
import { ReferralSettingsService } from './referral-settings.service';
import { ReferralStickyService } from './referral-sticky.service';
import { ReferralVisitService } from './referral-visit.service';
import { ReferralWalletService } from './referral-wallet.service';
import { ReferralWalletWorker } from './referral-wallet.worker';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [ReferralAdminController, ReferralPublicController],
  providers: [
    ReferralSettingsService,
    ReferralCodeService,
    ReferralStickyService,
    ReferralVisitService,
    ReferralWalletService,
    ReferralWalletWorker,
  ],
  exports: [
    ReferralSettingsService,
    ReferralCodeService,
    ReferralStickyService,
    ReferralVisitService,
    ReferralWalletService,
  ],
})
export class ReferralModule {}
