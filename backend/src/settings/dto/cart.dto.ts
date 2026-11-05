import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateCartSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  freeShippingThresholdRub!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  progressContentText!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  progressSuccessText!: string;

  @IsString()
  @MaxLength(100_000)
  legalHtml!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sampleRulesArticleSlug?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  sampleVariantNoticeHtml?: string | null;
}

export class DiscardCartUploadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  urls!: string[];
}
