import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;
}

export class ReorderIdsDto {
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class ReorderCategoriesDto {
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class CreateCatalogTagDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;
}

export class CatalogTagStepInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  description!: string;
}

export class UpdateCatalogTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CatalogTagStepInputDto)
  steps?: CatalogTagStepInputDto[];
}

export class VariantShadeInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;
}

export class VariantInputDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  nationalCatalogName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  volumeMl?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  /** UUID номенклатуры 1С (CommerceML Ид) */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  onecId?: string | null;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  price!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  compareAt?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  orderMinQty?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  orderMaxQty?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  weightGrams?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  lengthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  widthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  heightMm?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  packageVolume?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stockReserve?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Подмножество галереи товара (порядок = порядок в массиве). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productImageIds?: string[];

  /** Оттенки варианта (replace-all при передаче). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantShadeInputDto)
  shades?: VariantShadeInputDto[];
}

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsString()
  @MinLength(1)
  categoryId!: string;

  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  pageShortDescriptionHtml?: string | null;

  @IsOptional()
  @IsString()
  descriptionHtml?: string | null;

  @IsOptional()
  @IsString()
  actionEffectHtml?: string | null;

  @IsOptional()
  @IsString()
  applicationHtml?: string | null;

  @IsOptional()
  @IsString()
  compositionHtml?: string | null;

  @IsOptional()
  @IsString()
  importantNoteHtml?: string | null;

  @IsOptional()
  @IsString()
  mirafloresNoteHtml?: string | null;

  @IsOptional()
  @IsString()
  storageHtml?: string | null;

  @IsOptional()
  @IsString()
  productType?: string | null;

  @IsOptional()
  @IsString()
  purpose?: string | null;

  @IsOptional()
  @IsString()
  shelfLife?: string | null;

  @IsOptional()
  @IsString()
  productTypeOptionId?: string | null;

  @IsOptional()
  @IsString()
  purposeOptionId?: string | null;

  @IsOptional()
  @IsString()
  shelfLifeOptionId?: string | null;

  @IsOptional()
  @IsString()
  storageOptionId?: string | null;

  @IsOptional()
  @IsString()
  extraHtml?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Скрыть из витрины; товар остаётся активным (подарки благодарности и т.п.) */
  @IsOptional()
  @IsBoolean()
  excludeFromCatalog?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  metaTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ogImageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  canonicalPath?: string | null;

  @IsOptional()
  @IsBoolean()
  seoNoIndex?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  catalogTagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collectionIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productSetIds?: string[];

  /** Опционально: варианты можно добавить отдельно через POST products/:id/variants. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantInputDto)
  variants?: VariantInputDto[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryId?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  pageShortDescriptionHtml?: string | null;

  @IsOptional()
  @IsString()
  descriptionHtml?: string | null;

  @IsOptional()
  @IsString()
  actionEffectHtml?: string | null;

  @IsOptional()
  @IsString()
  applicationHtml?: string | null;

  @IsOptional()
  @IsString()
  compositionHtml?: string | null;

  @IsOptional()
  @IsString()
  importantNoteHtml?: string | null;

  @IsOptional()
  @IsString()
  mirafloresNoteHtml?: string | null;

  @IsOptional()
  @IsString()
  storageHtml?: string | null;

  @IsOptional()
  @IsString()
  productType?: string | null;

  @IsOptional()
  @IsString()
  purpose?: string | null;

  @IsOptional()
  @IsString()
  shelfLife?: string | null;

  @IsOptional()
  @IsString()
  productTypeOptionId?: string | null;

  @IsOptional()
  @IsString()
  purposeOptionId?: string | null;

  @IsOptional()
  @IsString()
  shelfLifeOptionId?: string | null;

  @IsOptional()
  @IsString()
  storageOptionId?: string | null;

  @IsOptional()
  @IsString()
  extraHtml?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Скрыть из витрины; товар остаётся активным (подарки благодарности и т.п.) */
  @IsOptional()
  @IsBoolean()
  excludeFromCatalog?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  metaTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ogImageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  canonicalPath?: string | null;

  @IsOptional()
  @IsBoolean()
  seoNoIndex?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  catalogTagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collectionIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productSetIds?: string[];
}

export class CreateVariantDto extends VariantInputDto {}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  nationalCatalogName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  volumeMl?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  /** UUID номенклатуры 1С (CommerceML Ид) */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  onecId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  compareAt?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  orderMinQty?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  orderMaxQty?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  weightGrams?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  lengthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  widthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  heightMm?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  packageVolume?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stockReserve?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productImageIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantShadeInputDto)
  shades?: VariantShadeInputDto[];
}

export class ReorderProductImagesDto {
  @IsArray()
  @IsString({ each: true })
  imageIds!: string[];
}

export class CreateCollectionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  @IsOptional()
  @IsString()
  productPreviewUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  featuredLayout?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  @IsOptional()
  @IsString()
  productPreviewUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  featuredLayout?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}

export class CreateProductSetDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}

export class UpdateProductSetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}
