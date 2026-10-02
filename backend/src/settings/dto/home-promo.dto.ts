import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Только относительные пути витрины (без javascript: / внешних URL). */
export const HOME_PROMO_HREF_PATTERN = /^\/[a-zA-Z0-9/_-]*$/;

export const HOME_PROMO_MAX_ITEMS = 5;

export class UpsertHomePromoBannerDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  imageUrl!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(HOME_PROMO_HREF_PATTERN, {
    message: 'href должен быть относительным путём (например /catalog)',
  })
  href!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  alt?: string;

  @IsOptional()
  @IsBoolean()
  notch?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReplaceHomePromoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  titleLeft!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  titleRight!: string;

  @IsArray()
  @ArrayMaxSize(HOME_PROMO_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => UpsertHomePromoBannerDto)
  items!: UpsertHomePromoBannerDto[];
}
