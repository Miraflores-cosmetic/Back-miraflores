import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ReplaceFaqItemsDto } from './dto/faq.dto';
import { ReplaceGratitudeDto } from './dto/gratitude.dto';
import { ReplaceHeroSlidesDto } from './dto/hero.dto';
import { ReplaceHomepageSetsDto } from './dto/homepage-sets.dto';
import { ReplaceProductAttributeOptionsDto } from './dto/product-attributes.dto';
import { ReplaceQuizContentDto } from './dto/quiz-content.dto';
import { DiscardCartUploadsDto, UpdateCartSettingsDto } from './dto/cart.dto';
import { UpdateMenuSettingsDto } from './dto/menu.dto';
import { UpdateSiteSeoSettingsDto } from './dto/site-seo.dto';
import { SettingsAdminService } from './settings.service';

@Controller('settings/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SettingsAdminController {
  constructor(private readonly settings: SettingsAdminService) {}

  @Get('faq')
  listFaq() {
    return this.settings.listFaq();
  }

  @Put('faq')
  replaceFaq(@Body() dto: ReplaceFaqItemsDto) {
    return this.settings.replaceFaq(dto);
  }

  @Get('product-attributes')
  listProductAttributes() {
    return this.settings.listProductAttributes();
  }

  @Put('product-attributes')
  replaceProductAttributes(@Body() dto: ReplaceProductAttributeOptionsDto) {
    return this.settings.replaceProductAttributes(dto);
  }

  @Get('hero')
  listHero() {
    return this.settings.listHero();
  }

  @Put('hero')
  replaceHero(@Body() dto: ReplaceHeroSlidesDto) {
    return this.settings.replaceHero(dto);
  }

  @Get('homepage-sets')
  listHomepageSets() {
    return this.settings.listHomepageSets();
  }

  @Put('homepage-sets')
  replaceHomepageSets(@Body() dto: ReplaceHomepageSetsDto) {
    return this.settings.replaceHomepageSets(dto);
  }

  @Get('cart')
  getCart() {
    return this.settings.getCart();
  }

  @Put('cart')
  updateCart(@Body() dto: UpdateCartSettingsDto) {
    return this.settings.updateCart(dto);
  }

  @Post('cart/discard-uploads')
  discardCartUploads(@Body() dto: DiscardCartUploadsDto) {
    return this.settings.discardCartUploads(dto.urls);
  }

  @Get('menu')
  getMenu() {
    return this.settings.getMenu();
  }

  @Put('menu')
  updateMenu(@Body() dto: UpdateMenuSettingsDto) {
    return this.settings.updateMenu(dto);
  }

  @Get('quiz-content')
  listQuizContent() {
    return this.settings.listQuizContentAdmin();
  }

  @Put('quiz-content')
  replaceQuizContent(@Body() dto: ReplaceQuizContentDto) {
    return this.settings.replaceQuizContent(dto);
  }

  @Get('gratitude')
  getGratitude() {
    return this.settings.getGratitudeAdmin();
  }

  @Put('gratitude')
  replaceGratitude(@Body() dto: ReplaceGratitudeDto) {
    return this.settings.replaceGratitude(dto);
  }

  @Get('seo')
  getSiteSeo() {
    return this.settings.getSiteSeo();
  }

  @Put('seo')
  updateSiteSeo(@Body() dto: UpdateSiteSeoSettingsDto) {
    return this.settings.updateSiteSeo(dto);
  }
}
