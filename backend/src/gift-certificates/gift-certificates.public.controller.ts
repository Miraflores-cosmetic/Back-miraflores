import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GiftCertificatesPublicService } from './gift-certificates.public.service';
import { PurchaseGiftCertificateDto } from './dto/purchase-gift-certificate.dto';

class ValidateGiftCertificateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  /** Сумма к оплате до сертификата (после каталожных скидок и промо), ₽. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  payableBeforeGift!: number;
}

@Public()
@Controller('gift-certificates')
export class GiftCertificatesPublicController {
  constructor(private readonly gifts: GiftCertificatesPublicService) {}

  @Get('denominations')
  listDenominations() {
    return this.gifts.listActiveDenominations();
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('validate')
  validate(@Body() dto: ValidateGiftCertificateDto) {
    return this.gifts.validate(dto.code, dto.payableBeforeGift);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('purchase')
  purchase(
    @Body() dto: PurchaseGiftCertificateDto,
    @CurrentUser() user?: { sub?: string; role?: string },
  ) {
    const userId =
      user?.role === 'USER' && user.sub ? user.sub : null;
    return this.gifts.createPurchase(dto, userId);
  }
}
