import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SIDE_MAX_MM, SIDE_MIN_MM, WEIGHT_MAX_G, WEIGHT_MIN_G } from '../ozon-package';

export class OzonPickupPointsQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  radiusKm?: number;
}

export class OzonEstimateLineDto {
  @IsString()
  @MaxLength(64)
  variantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  qty!: number;
}

export class OzonEstimateRequestDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OzonEstimateLineDto)
  lines!: OzonEstimateLineDto[];

  @IsIn(['pvz', 'courier'])
  dropoff!: 'pvz' | 'courier';
}

export class OzonDimsApplyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  variantIds!: string[];
}

export class OzonVariantDimsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(WEIGHT_MIN_G)
  @Max(WEIGHT_MAX_G)
  weightGrams?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SIDE_MIN_MM)
  @Max(SIDE_MAX_MM)
  lengthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SIDE_MIN_MM)
  @Max(SIDE_MAX_MM)
  widthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SIDE_MIN_MM)
  @Max(SIDE_MAX_MM)
  heightMm?: number;
}

export class OzonReconciliationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days?: number;
}
