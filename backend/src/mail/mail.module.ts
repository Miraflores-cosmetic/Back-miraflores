import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailNotificationsService } from './email-notifications.service';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [MailService, EmailNotificationsService],
  exports: [MailService, EmailNotificationsService],
})
export class MailModule {}
