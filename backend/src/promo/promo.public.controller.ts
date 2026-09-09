import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { ValidatePromoDto } from './dto/promo.dto';
import { PromoPublicService } from './promo.service';

@Public()
@UseGuards(ThrottlerGuard)
@Controller('promo')
export class PromoPublicController {
  constructor(private readonly promo: PromoPublicService) {}

  /** Drawer preview — client subtotal OK. Rate-limit против перебора кодов. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('validate')
  validate(@Req() req: { user?: JwtPayload }, @Body() dto: ValidatePromoDto) {
    const buyerUserId =
      req.user?.role === UserRole.USER && req.user.sub?.trim()
        ? req.user.sub.trim()
        : undefined;
    return this.promo.validate(
      dto.code,
      dto.subtotal,
      {
        email: dto.email,
        guestId: dto.guestId,
        userId: buyerUserId,
      },
      buyerUserId,
    );
  }
}
