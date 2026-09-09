import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PRODUCT_ATTRIBUTE_KINDS,
  type ProductAttributeKind,
} from '@miraflores/admin-types';

export class UpsertProductAttributeOptionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn([...PRODUCT_ATTRIBUTE_KINDS])
  kind!: ProductAttributeKind;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  label!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReplaceProductAttributeOptionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertProductAttributeOptionDto)
  items!: UpsertProductAttributeOptionDto[];

  /**
   * Разрешить сохранить пустой список (стереть все неиспользуемые опции).
   * Без флага пустой PUT отклоняется — защита от случайного wipe.
   */
  @IsOptional()
  @IsBoolean()
  allowEmpty?: boolean;

  /**
   * Версия каталога с последнего GET. При несовпадении — 409 Conflict.
   * Обязательна, если в каталоге уже есть опции.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}
