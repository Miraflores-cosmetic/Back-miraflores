import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { parseOptionalPositiveInt } from '../common/parse-positive-int';
import { CatalogCategoriesAdminService } from './catalog-categories.admin.service';
import { CatalogCollectionsAdminService } from './catalog-collections.admin.service';
import { CatalogProductSetsAdminService } from './catalog-product-sets.admin.service';
import { CatalogProductsAdminService } from './catalog-products.admin.service';
import { CatalogTagsAdminService } from './catalog-tags.admin.service';
import { SettingsAdminService } from '../settings/settings.service';
import {
  CreateCatalogTagDto,
  CreateCategoryDto,
  CreateCollectionDto,
  CreateProductDto,
  CreateProductSetDto,
  CreateVariantDto,
  ReorderCategoriesDto,
  ReorderIdsDto,
  ReorderProductImagesDto,
  UpdateCatalogTagDto,
  UpdateCategoryDto,
  UpdateCollectionDto,
  UpdateProductDto,
  UpdateProductSetDto,
  UpdateVariantDto,
} from './dto/catalog-admin.dto';

@Controller('catalog/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CatalogAdminController {
  constructor(
    private readonly categories: CatalogCategoriesAdminService,
    private readonly tags: CatalogTagsAdminService,
    private readonly products: CatalogProductsAdminService,
    private readonly collections: CatalogCollectionsAdminService,
    private readonly productSets: CatalogProductSetsAdminService,
    private readonly settings: SettingsAdminService,
  ) {}

  /** Read-only словари атрибутов для формы товара (ACL: catalog). */
  @Get('product-attribute-options')
  listProductAttributeOptions() {
    return this.settings.listProductAttributes();
  }

  @Post('upload-rich-media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  uploadRichMedia(
    @UploadedFile() file: Express.Multer.File,
    @Query('type') type?: string,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    if (type != null && type !== 'image') {
      throw new BadRequestException('Поддерживается только type=image');
    }
    return this.products.uploadRichMedia(file);
  }

  @Get('categories')
  listCategories() {
    return this.categories.listCategories();
  }

  @Get('categories/:id')
  getCategory(@Param('id') id: string) {
    return this.categories.getCategory(id);
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.categories.deleteCategory(id);
  }

  @Post('categories/reorder')
  reorderCategories(@Body() dto: ReorderCategoriesDto) {
    return this.categories.reorderCategories(dto.parentId, dto.orderedIds);
  }

  @Get('catalog-tags')
  listCatalogTags() {
    return this.tags.listCatalogTags();
  }

  @Get('catalog-tags/:id')
  getCatalogTag(@Param('id') id: string) {
    return this.tags.getCatalogTag(id);
  }

  @Post('catalog-tags')
  createCatalogTag(@Body() dto: CreateCatalogTagDto) {
    return this.tags.createCatalogTag(dto);
  }

  @Post('catalog-tags/reorder')
  reorderCatalogTags(@Body() dto: ReorderIdsDto) {
    return this.tags.reorderCatalogTags(dto.orderedIds);
  }

  @Post('catalog-tags/:id/images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 80 * 1024 * 1024 },
    }),
  )
  uploadCatalogTagImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.tags.uploadCatalogTagImage(id, file);
  }

  @Patch('catalog-tags/:id/images/reorder')
  reorderCatalogTagImages(@Param('id') id: string, @Body() dto: ReorderProductImagesDto) {
    return this.tags.reorderCatalogTagImages(id, dto.imageIds);
  }

  @Delete('catalog-tag-images/:id')
  deleteCatalogTagImage(@Param('id') id: string) {
    return this.tags.deleteCatalogTagImage(id);
  }

  @Patch('catalog-tags/:id')
  updateCatalogTag(@Param('id') id: string, @Body() dto: UpdateCatalogTagDto) {
    return this.tags.updateCatalogTag(id, dto);
  }

  @Delete('catalog-tags/:id')
  deleteCatalogTag(@Param('id') id: string) {
    return this.tags.deleteCatalogTag(id);
  }

  @Get('products')
  listProducts(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('visibility') visibility?: 'all' | 'catalog' | 'hidden' | 'excluded',
    @Query('categoryId') categoryId?: string,
    @Query('collectionId') collectionId?: string,
  ) {
    return this.products.listProducts({
      q,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
      visibility: visibility ?? 'all',
      categoryId,
      collectionId,
    });
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.products.createProduct(dto);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.products.getProduct(id);
  }

  @Get('products/:id/variant-form')
  getProductVariantFormContext(@Param('id') id: string) {
    return this.products.getProductVariantFormContext(id);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.updateProduct(id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.products.deleteProduct(id);
  }

  @Post('products/:id/variants')
  addVariant(@Param('id') id: string, @Body() dto: CreateVariantDto) {
    return this.products.addVariant(id, dto);
  }

  @Post('products/:id/images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 80 * 1024 * 1024 },
    }),
  )
  uploadProductImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.products.uploadProductImage(id, file);
  }

  @Patch('products/:id/images/reorder')
  reorderProductImages(@Param('id') id: string, @Body() dto: ReorderProductImagesDto) {
    return this.products.reorderProductImages(id, dto.imageIds);
  }

  @Delete('images/:id')
  deleteProductImage(@Param('id') id: string) {
    return this.products.deleteProductImage(id);
  }

  @Patch('variants/:id')
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(id, dto);
  }

  @Get('variants/:id')
  getVariant(@Param('id') id: string) {
    return this.products.getVariant(id);
  }

  @Post('variants/:id/shade-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  uploadVariantShadeImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.products.uploadVariantShadeImage(id, file, name);
  }

  @Post('variants/:id/duplicate')
  duplicateVariant(@Param('id') id: string) {
    return this.products.duplicateVariant(id);
  }

  @Delete('variants/:id')
  deleteVariant(@Param('id') id: string) {
    return this.products.deleteVariant(id);
  }

  @Get('collections')
  listCollections(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.collections.listCollections({
      q,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  @Post('collections')
  createCollection(@Body() dto: CreateCollectionDto) {
    return this.collections.createCollection(dto);
  }

  @Post('collections/reorder')
  reorderCollections(@Body() dto: ReorderIdsDto) {
    return this.collections.reorderCollections(dto.orderedIds);
  }

  @Get('collections/:id')
  getCollection(@Param('id') id: string) {
    return this.collections.getCollection(id);
  }

  @Patch('collections/:id')
  updateCollection(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.collections.updateCollection(id, dto);
  }

  @Delete('collections/:id')
  deleteCollection(@Param('id') id: string) {
    return this.collections.deleteCollection(id);
  }

  @Get('product-sets')
  listProductSets(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productSets.listProductSets({
      q,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  @Post('product-sets')
  createProductSet(@Body() dto: CreateProductSetDto) {
    return this.productSets.createProductSet(dto);
  }

  @Post('product-sets/reorder')
  reorderProductSets(@Body() dto: ReorderIdsDto) {
    return this.productSets.reorderProductSets(dto.orderedIds);
  }

  @Get('product-sets/:id')
  getProductSet(@Param('id') id: string) {
    return this.productSets.getProductSet(id);
  }

  @Patch('product-sets/:id')
  updateProductSet(@Param('id') id: string, @Body() dto: UpdateProductSetDto) {
    return this.productSets.updateProductSet(id, dto);
  }

  @Delete('product-sets/:id')
  deleteProductSet(@Param('id') id: string) {
    return this.productSets.deleteProductSet(id);
  }
}
