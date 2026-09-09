import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import {
  parseOptionalNonNegInt,
  parseOptionalPositiveInt,
} from '../common/parse-positive-int';
import { CatalogPublicService } from './catalog.public.service';
import { SyncCartDto } from './dto/cart-sync.dto';

@Public()
@Controller('catalog')
export class CatalogPublicController {
  constructor(private readonly catalogPublic: CatalogPublicService) {}

  private buyerUserId(req: { user?: JwtPayload }): string | undefined {
    const u = req.user;
    if (u?.role === UserRole.USER && u.sub?.trim()) return u.sub.trim();
    return undefined;
  }

  @Get('products')
  listProducts(
    @Req() req: { user?: JwtPayload },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('collection') collection?: string,
    @Query('sort') sort?: string,
    @Query('priceMin') priceMin?: string,
    @Query('priceMax') priceMax?: string,
    @Query('sale') sale?: string,
    /** Comma-separated — batch cards by slug (search hydrate), preserves order. */
    @Query('slugs') slugs?: string,
  ) {
    const slugList = slugs
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.catalogPublic.listProducts({
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
      categorySlug: category?.trim() || undefined,
      tagSlug: tag?.trim() || undefined,
      collectionSlug: collection?.trim() || undefined,
      sort: sort?.trim() || undefined,
      priceMin: parseOptionalNonNegInt(priceMin),
      priceMax: parseOptionalNonNegInt(priceMax),
      saleOnly: sale === '1' || sale === 'true',
      slugs: slugList?.length ? slugList : undefined,
      userId: this.buyerUserId(req),
    });
  }

  /** Guest cart: refresh price/stock, drop dead variants. */
  @Post('cart/sync')
  syncCart(@Body() dto: SyncCartDto, @Req() req: { user?: JwtPayload }) {
    return this.catalogPublic.syncCartLines(dto.lines ?? [], this.buyerUserId(req));
  }

  @Get('products/:slug/set-siblings')
  setSiblings(@Param('slug') slug: string, @Req() req: { user?: JwtPayload }) {
    return this.catalogPublic.getSetSiblings(slug, this.buyerUserId(req));
  }

  @Get('products/:slug')
  async product(@Param('slug') slug: string, @Req() req: { user?: JwtPayload }) {
    const product = await this.catalogPublic.getProductBySlug(
      slug,
      this.buyerUserId(req),
    );
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  @Get('open-graph')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=120')
  openGraphHtml(
    @Query('path') path?: string,
    @Query('collection') collection?: string,
    @Query('tag') tag?: string,
    @Query('q') q?: string,
  ) {
    return this.catalogPublic.renderOpenGraphHtml({
      path: path?.trim() || '/catalog',
      collection: collection?.trim() || '',
      tag: tag?.trim() || '',
      q: q?.trim() || '',
    });
  }

  @Get('collections')
  listCollections(
    @Req() req: { user?: JwtPayload },
    @Query('includeProducts') includeProducts?: string,
  ) {
    return this.catalogPublic.listCollections({
      includeProducts:
        includeProducts === '1' || includeProducts === 'true',
      userId: this.buyerUserId(req),
    });
  }

  @Get('categories')
  listCategories() {
    return this.catalogPublic.listCategories();
  }

  @Get('tags')
  listCatalogTags() {
    return this.catalogPublic.listCatalogTags();
  }
}
