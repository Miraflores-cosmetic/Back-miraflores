import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ReferralSettingsService } from './referral-settings.service';

/**
 * Публичные knobs для витрины (guest): TTL attribution `?mf=`.
 * Admin: `settings/admin/referral`.
 */
@Public()
@Controller('settings')
export class ReferralPublicController {
  constructor(private readonly settings: ReferralSettingsService) {}

  @Get('referral')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  async getPublic() {
    const row = await this.settings.ensureDefaults();
    const days = Math.min(3650, Math.max(1, Math.floor(row.linkTtlDays) || 60));
    return { linkTtlDays: days };
  }
}
