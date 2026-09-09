import {
  GroupCategoryPriceType,
  PriceRounding,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateUserGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug: lowercase latin, digits, hyphens',
  })
  slug!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCatalogDiscounts?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPromoCodes?: boolean;

  @IsOptional()
  @IsEnum(PriceRounding)
  priceRounding?: PriceRounding;
}

export class UpdateUserGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCatalogDiscounts?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPromoCodes?: boolean;

  @IsOptional()
  @IsEnum(PriceRounding)
  priceRounding?: PriceRounding;
}

export class AssignGroupMemberDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}

export class UpsertGroupVariantPriceDto {
  @IsInt()
  @Min(0)
  price!: number;
}

export class GroupVariantPriceBulkItemDto {
  @IsString()
  variantId!: string;

  @IsInt()
  @Min(0)
  price!: number;
}

export class ReplaceGroupVariantPricesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupVariantPriceBulkItemDto)
  items!: GroupVariantPriceBulkItemDto[];
}

export class UpsertGroupCategoryPriceDto {
  @IsEnum(GroupCategoryPriceType)
  type!: GroupCategoryPriceType;

  @IsInt()
  @Min(0)
  value!: number;
}

export class GroupCategoryPriceBulkItemDto {
  @IsString()
  categoryId!: string;

  @IsEnum(GroupCategoryPriceType)
  type!: GroupCategoryPriceType;

  @IsInt()
  @Min(0)
  value!: number;
}

export class ReplaceGroupCategoryPricesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupCategoryPriceBulkItemDto)
  items!: GroupCategoryPriceBulkItemDto[];
}

export class UpdateUserGroupAssignmentDto {
  @IsOptional()
  @IsString()
  groupId?: string | null;
}
