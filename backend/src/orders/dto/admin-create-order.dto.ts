import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
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
import { OrderAffiliateDto, ShippingAddressDto } from './create-order.dto';

export class AdminCreateOrderLineDto {
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

  /** Ручной override цены за единицу (₽). Без поля — цена из каталога. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  unitPrice?: number | null;
}

export type AdminCreateOrderPayMode =
  | 'awaiting_link'
  | 'mark_paid'
  | 'awaiting';

export class AdminCreateOrderDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AdminCreateOrderLineDto)
  lines!: AdminCreateOrderLineDto[];

  @IsEmail()
  @MaxLength(320)
  email!: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNote?: string | null;

  /** Привязка к существующему покупателю (опционально). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  giftCertificateCode?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderAffiliateDto)
  affiliate?: OrderAffiliateDto | null;

  /**
   * Обязателен на create / полном preview.
   * На шаге «Скидки» можно опустить вместе с previewAllowMissingShipping.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;

  /** CDEK | YANDEX | OZON — обязателен для physical-заказа. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  shippingMethod?: string;

  /** Стоимость доставки (₽), задаёт staff; без HMAC quote. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  shippingCost?: number;

  /** Добавить подарки благодарности по порогу (default true). */
  @IsOptional()
  @IsBoolean()
  attachGratitude?: boolean;

  @IsIn(['awaiting_link', 'mark_paid', 'awaiting'])
  payMode!: AdminCreateOrderPayMode;

  /** Письмо клиенту после mark_paid / ссылки (default true). */
  @IsOptional()
  @IsBoolean()
  notifyCustomer?: boolean;

  /**
   * Клиентский ключ анти-дубля (wizard session).
   * Повтор POST с тем же ключом возвращает тот же заказ.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string | null;

  /**
   * Только preview: не требовать shippingMethod/address (шаг «Скидки»).
   * Create игнорирует флаг.
   */
  @IsOptional()
  @IsBoolean()
  previewAllowMissingShipping?: boolean;
}
