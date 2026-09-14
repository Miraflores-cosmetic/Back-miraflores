import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NewsletterAdminController } from './newsletter-admin.controller';
import { NewsletterAdminService } from './newsletter-admin.service';
import { NewsletterPublicController } from './newsletter.public.controller';
import { NewsletterPublicService } from './newsletter.public.service';

@Module({
  imports: [PrismaModule],
  controllers: [NewsletterPublicController, NewsletterAdminController],
  providers: [NewsletterPublicService, NewsletterAdminService],
  exports: [NewsletterPublicService],
})
export class NewsletterModule {}
