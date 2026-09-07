import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateOrderLineDto {
  @IsString()
  @MinLength(1)
  variantId!: string;

  @IsOptional()
  @IsString()
  shadeId?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  qty!: number;
}

/** Снимок расчёта доставки внутри shippingAddress JSON. */
export class ShippingCarrierQuoteDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999_999)
  tariffId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  tariffName?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  daysMin?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  daysMax?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  cost?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  method?: string | null;

  @IsOptional()
  @IsBoolean()
  freePvz?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string | null;
}

export class ShippingAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  apartment?: string;

  /** Область / край */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  /** Район города */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  /** Код ПВЗ СДЭК (или id пункта Яндекс) — для создания отправления */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pvzCode?: string;

  /** Телефон получателя (из адреса); заказный phone — с формы checkout */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  /** ФИО получателя из адреса (если доставка «другому») */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientName?: string;

  /** Расширенный снимок тарифа / сроков (не влияет на HMAC cost). */
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingCarrierQuoteDto)
  carrierQuote?: ShippingCarrierQuoteDto;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];

  @IsEmail()
  @MaxLength(320)
  email!: string;

  /** RU / E.164: цифры, пробелы, (), -, опциональный +. */
  @IsString()
  @MinLength(10)
  @MaxLength(40)
  @Matches(/^\+?[\d\s()\-]{10,40}$/, {
    message: 'Некорректный телефон',
  })
  phone!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName!: string;

  /** Комментарий покупателя к заказу (опционально). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNote?: string | null;

  /**
   * Браузерный guest-id (обязателен и для USER).
   * Create/payToken завязаны на guestId, не на JWT — см. OrdersPublicService.create.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  guestId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string | null;

  /** Подарочный сертификат (взаимоисключающе с promoCode). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  giftCertificateCode?: string | null;

  /** UUID/cuid от клиента — повтор create с тем же ключом возвращает тот же заказ. */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  /** Адрес доставки (город + улица обязательны). */
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  /**
   * Подписанный Nest shipping quote (`POST /orders/shipping-quote`).
   * Стоимость доставки берётся только из него — не с клиента.
   * Не нужен для digital-only gift-denom корзины.
   */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  shippingQuote?: string;

  /** Перевозчик: CDEK | YANDEX (обязан совпасть с quote). Не нужен для gift-denom-only. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  shippingMethod?: string;

  /** @deprecated Игнорируется — cost только из shippingQuote. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  shippingCost?: number;
}
