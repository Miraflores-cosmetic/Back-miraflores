import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NewsletterPublicController } from './newsletter.public.controller';
import { NewsletterPublicService } from './newsletter.public.service';

@Module({
  imports: [PrismaModule],
  controllers: [NewsletterPublicController],
  providers: [NewsletterPublicService],
  exports: [NewsletterPublicService],
})
export class NewsletterModule {}
