import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NewsletterAdminService } from './newsletter-admin.service';

@Controller('newsletter/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class NewsletterAdminController {
  constructor(private readonly newsletter: NewsletterAdminService) {}

  @Get('stats')
  stats() {
    return this.newsletter.getStats();
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="newsletter-subscribers.csv"',
  )
  exportCsv() {
    return this.newsletter.exportCsv();
  }
}
