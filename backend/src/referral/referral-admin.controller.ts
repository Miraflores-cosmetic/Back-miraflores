import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdjustReferralBalanceDto } from './dto/adjust-referral-balance.dto';
import { UpdateReferralSettingsDto } from './dto/update-referral-settings.dto';
import { ReferralCodeService } from './referral-code.service';
import { ReferralSettingsService } from './referral-settings.service';
import { ReferralWalletService } from './referral-wallet.service';
import { SetReferralActiveDto } from '../users/dto/referral-admin.dto';

/**
 * ACL: `/settings/admin/*` → секция `settings` (@miraflores/admin-sections).
 * Смена % / quarantineMode / quarantineDays не ретроактивна (snapshot в earn.note).
 */
@Controller('settings/admin/referral')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ReferralAdminController {
  constructor(
    private readonly settings: ReferralSettingsService,
    private readonly wallet: ReferralWalletService,
    private readonly codes: ReferralCodeService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(@Body() dto: UpdateReferralSettingsDto) {
    return this.settings.update(dto);
  }

  /** Рефереры: code, available, pending, earnedGross, earnedNet. */
  @Get('referrers')
  listReferrers(
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.min(50, Math.max(1, Math.floor(Number(limitRaw) || 20)));
    return this.wallet.listReferrers({ q, limit, cursor: cursor ?? null });
  }

  /**
   * Ручная корректировка (ADJUST).
   * Idempotency-Key header или body.idempotencyKey — иначе hash(actor+user+amount+note+60s).
   */
  @Post('users/:userId/adjust')
  adjust(
    @Param('userId') userId: string,
    @Body() dto: AdjustReferralBalanceDto,
    @CurrentUser() user: JwtPayload,
    @Headers('idempotency-key') idempotencyHeader?: string,
  ) {
    return this.wallet.adminAdjust({
      userId,
      amount: dto.amount,
      note: dto.note,
      actorUserId: user.sub,
      clientIdempotencyKey:
        idempotencyHeader?.trim() || dto.idempotencyKey?.trim() || null,
    });
  }

  /** Вкл/выкл referralCode (не ensure). ACL: settings. */
  @Put('users/:userId/active')
  setActive(
    @Param('userId') userId: string,
    @Body() dto: SetReferralActiveDto,
  ) {
    return this.codes.setActive(userId, dto.active).then(() => ({
      userId,
      active: dto.active,
    }));
  }

  /**
   * Новый код (старый ?mf= инвалиден). ACL: settings (тот же staff, что disable).
   * Дубль: POST users/admin/:id/referral/regenerate (ACL users) — для карточки пользователя.
   */
  @Post('users/:userId/regenerate')
  regenerate(@Param('userId') userId: string) {
    return this.codes.regenerateForUser(userId);
  }
}
