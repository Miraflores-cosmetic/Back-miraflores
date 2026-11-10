import {
  BadRequestException,
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
import { ReferralVisitService } from './referral-visit.service';
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
    private readonly visits: ReferralVisitService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(
    @Body() dto: UpdateReferralSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.settings.update(dto, {
      userId: user.sub,
      email: user.email ?? null,
    });
  }

  /** Σ available + pending — обязательства перед реферерами. */
  @Get('liability')
  liability() {
    return this.wallet.getLiability();
  }

  /** Touch outbox после MAX попыток (DEAD) — счётчик + список. */
  @Get('touches/dead')
  listDeadTouches(@Query('limit') limitRaw?: string) {
    const limit = Math.min(50, Math.max(1, Math.floor(Number(limitRaw) || 20)));
    return this.wallet.listDeadTouches({ limit });
  }

  /** Ручной retry DEAD outbox. */
  @Post('touches/:orderId/requeue')
  requeueDeadTouch(@Param('orderId') orderId: string) {
    return this.wallet.requeueDeadTouch(orderId);
  }

  /** Очередь address-match hold (подозрение self-ref). */
  @Get('address-matches')
  listAddressMatches(@Query('limit') limitRaw?: string) {
    const limit = Math.min(50, Math.max(1, Math.floor(Number(limitRaw) || 20)));
    return this.wallet.listAddressMatchSuspects({ limit });
  }

  /**
   * Снять addressMatchSuspect и POSTED earn/invitee (ручное подтверждение).
   * Дубль: POST orders/admin/:id/referral/approve-address (ACL orders).
   */
  @Post('orders/:orderId/approve-address')
  approveAddress(@Param('orderId') orderId: string) {
    return this.wallet.approveAddressMatch(orderId);
  }

  /**
   * Отклонить self-ref: VOID PENDING earn + invitee.
   * Дубль: POST orders/admin/:id/referral/reject-address (ACL orders).
   */
  @Post('orders/:orderId/reject-address')
  rejectAddress(@Param('orderId') orderId: string) {
    return this.wallet.rejectAddressMatch(orderId);
  }

  /** История смен настроек (снимок до изменения). */
  @Get('revisions')
  listRevisions(@Query('limit') limitRaw?: string) {
    const limit = Math.min(50, Math.max(1, Math.floor(Number(limitRaw) || 20)));
    return this.settings.listRevisions({ limit });
  }

  /**
   * Рефереры: earned / invitees / GMV + сортировка.
   * sort=earned|invitees|gmv|id, dir=asc|desc, offset=.
   */
  @Get('referrers')
  listReferrers(
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
    @Query('offset') offsetRaw?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    const limit = Math.min(50, Math.max(1, Math.floor(Number(limitRaw) || 20)));
    const offset = Math.max(0, Math.floor(Number(offsetRaw) || 0));
    return this.wallet.listReferrers({
      q,
      limit,
      cursor: cursor ?? null,
      offset,
      sort: sort as 'id' | 'earned' | 'invitees' | 'gmv' | undefined,
      dir: dir as 'asc' | 'desc' | undefined,
    });
  }

  /**
   * Воронка ?mf=: клик → sticky → заказ → оплата.
   * period=today|yesterday|last_7|week|month|custom (+ from/to YYYY-MM-DD).
   */
  @Get('funnel')
  async funnel(
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('topLimit') topLimitRaw?: string,
  ) {
    try {
      return await this.visits.getFunnel({
        period,
        from,
        to,
        topLimit: Math.floor(Number(topLimitRaw) || 20),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(msg);
    }
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
   * Новый код. Body `{ grace?: boolean }`.
   * Default `false` — отозвать aliases (утечка). `grace: true` — alias на linkTtlDays.
   * Дубль: POST users/admin/:id/referral/regenerate (ACL users).
   */
  @Post('users/:userId/regenerate')
  regenerate(
    @Param('userId') userId: string,
    @Body() body?: { grace?: boolean },
  ) {
    return this.codes.regenerateForUser(userId, {
      grace: body?.grace === true,
    });
  }
}
