import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { YourichClient } from './yourich.client';
import { YourichPromoSyncService } from './yourich-promo-sync.service';
import { YourichPromoSyncWorker } from './yourich-promo-sync.worker';
import { YourichSyncService } from './yourich-sync.service';
import { YourichSyncWorker } from './yourich-sync.worker';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [
    YourichClient,
    YourichSyncService,
    YourichSyncWorker,
    YourichPromoSyncService,
    YourichPromoSyncWorker,
  ],
  exports: [YourichClient, YourichSyncService, YourichPromoSyncService],
})
export class YourichModule {}
