import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Согласовано с Front ReviewModal maxLength={2000}. */
export const REVIEW_TEXT_MAX_LENGTH = 2000;
/** Public create и admin без медиа. */
export const REVIEW_TEXT_MIN_LENGTH = 10;
export const REVIEW_REJECTION_REASON_MIN = 3;
export const REVIEW_REJECTION_REASON_MAX = 1000;

export class CreateReviewAdminDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(REVIEW_TEXT_MAX_LENGTH, {
    message: `Текст отзыва — максимум ${REVIEW_TEXT_MAX_LENGTH} символов`,
  })
  text?: string;

  @IsOptional()
  @IsString()
  authorName?: string | null;

  @IsOptional()
  @IsString()
  image1Url?: string | null;

  @IsOptional()
  @IsString()
  image2Url?: string | null;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateReviewAdminDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(REVIEW_TEXT_MAX_LENGTH, {
    message: `Текст отзыва — максимум ${REVIEW_TEXT_MAX_LENGTH} символов`,
  })
  text?: string;

  @IsOptional()
  @IsString()
  authorName?: string | null;

  @IsOptional()
  @IsString()
  image1Url?: string | null;

  @IsOptional()
  @IsString()
  image2Url?: string | null;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class RejectReviewAdminDto {
  @IsString()
  @MinLength(REVIEW_REJECTION_REASON_MIN, {
    message: `Причина — минимум ${REVIEW_REJECTION_REASON_MIN} символа`,
  })
  @MaxLength(REVIEW_REJECTION_REASON_MAX, {
    message: `Причина — максимум ${REVIEW_REJECTION_REASON_MAX} символов`,
  })
  reason!: string;
}

export class ReorderReviewsAdminDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  orderedIds!: string[];
}

export class BulkReviewIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

export class BulkRejectReviewsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];

  @IsString()
  @MinLength(REVIEW_REJECTION_REASON_MIN, {
    message: `Причина — минимум ${REVIEW_REJECTION_REASON_MIN} символа`,
  })
  @MaxLength(REVIEW_REJECTION_REASON_MAX, {
    message: `Причина — максимум ${REVIEW_REJECTION_REASON_MAX} символов`,
  })
  reason!: string;
}

export class CreateReviewPublicDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating!: number;

  @IsString()
  @MinLength(REVIEW_TEXT_MIN_LENGTH, {
    message: `Текст отзыва — минимум ${REVIEW_TEXT_MIN_LENGTH} символов`,
  })
  @MaxLength(REVIEW_TEXT_MAX_LENGTH, {
    message: `Текст отзыва — максимум ${REVIEW_TEXT_MAX_LENGTH} символов`,
  })
  text!: string;

  @IsOptional()
  @IsString()
  orderId?: string | null;

  @IsOptional()
  @IsString()
  authorName?: string | null;
}
