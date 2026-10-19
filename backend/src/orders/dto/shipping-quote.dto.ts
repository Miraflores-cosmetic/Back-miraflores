import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateOrderLineDto, ShippingAddressDto, ShippingCarrierQuoteDto } from './create-order.dto';

export class ShippingQuoteRequestDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];

  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  /** CDEK | YANDEX | OZON */
  @IsString()
  @MaxLength(20)
  shippingMethod!: string;

  /**
   * Оценка с клиента (СДЭК/Яндекс BFF). Nest пересчитывает СДЭК на сервере и берёт max(client, server).
   * Для бесплатной доставки до ПВЗ можно 0.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  clientEstimate!: number;

  /** Опциональный снимок тарифа с клиента (СДЭК) — попадает в HMAC quote. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingCarrierQuoteDto)
  carrierQuote?: ShippingCarrierQuoteDto;

  /** Промокод для порога бесплатной доставки (скидка вычитается из subtotal). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  guestId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}
