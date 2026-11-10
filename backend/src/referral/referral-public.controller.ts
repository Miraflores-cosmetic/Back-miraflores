import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { TrackReferralVisitDto } from './dto/track-referral-visit.dto';
import { ReferralSettingsService } from './referral-settings.service';
import { ReferralVisitService } from './referral-visit.service';

/**
 * Публичные knobs для витрины (guest): TTL attribution + invitee banner + visit beacon.
 * Admin: `settings/admin/referral`.
 */
@Public()
@Controller('settings')
export class ReferralPublicController {
  constructor(
    private readonly settings: ReferralSettingsService,
    private readonly visits: ReferralVisitService,
  ) {}

  @Get('referral')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  async getPublic() {
    const row = await this.settings.ensureDefaults();
    const days = Math.min(3650, Math.max(1, Math.floor(row.linkTtlDays) || 60));
    return {
      linkTtlDays: days,
      enabled: row.enabled,
      inviteeBonusEnabled: row.inviteeBonusEnabled,
      inviteeBonusRub: Math.max(0, Math.floor(row.inviteeBonusRub) || 0),
      earnPercent: Math.max(0, Math.floor(row.earnPercent) || 0),
      quarantineMode: row.quarantineMode,
      quarantineDays: Math.max(1, Math.floor(row.quarantineDays) || 7),
    };
  }

  /**
   * Beacon клика ?mf=: агрегат по дню (Москва) × код.
   * Всегда 200 {ok:true} — невалидный код / ошибка БД не ломают витрину.
   */
  @Post('referral/visit')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  trackVisit(@Body() dto: TrackReferralVisitDto) {
    return this.visits.trackVisit(dto.code);
  }
}
