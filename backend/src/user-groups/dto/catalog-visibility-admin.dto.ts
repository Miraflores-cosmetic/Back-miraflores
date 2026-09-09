import {
  CatalogVisibilityMode,
  CatalogVisibilityTarget,
} from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateCatalogVisibilityDto {
  @IsEnum(CatalogVisibilityMode)
  mode!: CatalogVisibilityMode;

  @IsOptional()
  @IsString()
  groupId?: string | null;

  @IsEnum(CatalogVisibilityTarget)
  targetType!: CatalogVisibilityTarget;

  @IsString()
  @MinLength(1)
  targetId!: string;
}

export class UpdateCatalogVisibilityDto {
  @IsOptional()
  @IsEnum(CatalogVisibilityMode)
  mode?: CatalogVisibilityMode;

  @IsOptional()
  @IsString()
  groupId?: string | null;

  @IsOptional()
  @IsEnum(CatalogVisibilityTarget)
  targetType?: CatalogVisibilityTarget;

  @IsOptional()
  @IsString()
  targetId?: string;
}
