import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DiscountScope } from '@prisma/client';

export const PROMO_TYPES = ['PERCENT', 'FIXED'] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

export class CreatePromoCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsIn(PROMO_TYPES)
  type!: PromoType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  value!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @IsBoolean()
  oneShot?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minOrderAmount?: number | null;

  /** null / omit = весь заказ */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsEnum(DiscountScope)
  scope?: DiscountScope | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}

export class UpdatePromoCodeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsIn(PROMO_TYPES)
  type?: PromoType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  value?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @IsBoolean()
  oneShot?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minOrderAmount?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsEnum(DiscountScope)
  scope?: DiscountScope | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}

export class ValidatePromoLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  variantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  qty!: number;
}

export class ValidatePromoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  subtotal!: number;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  guestId?: string;

  /** Для scoped-промо: позиции корзины (сервер сам посчитает eligible subtotal). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ValidatePromoLineDto)
  lines?: ValidatePromoLineDto[];
}
