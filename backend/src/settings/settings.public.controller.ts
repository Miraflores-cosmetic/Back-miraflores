import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SettingsPublicService } from './settings.service';

@Public()
@Controller('settings')
export class SettingsPublicController {
  constructor(private readonly settings: SettingsPublicService) {}

  @Get('faq')
  listFaq() {
    return this.settings.listFaq();
  }

  @Get('hero')
  listHero() {
    return this.settings.listHero();
  }

  @Get('homepage-sets')
  listHomepageSets() {
    return this.settings.listHomepageSets();
  }

  @Get('gratitude')
  getGratitude() {
    return this.settings.getGratitude();
  }

  @Get('cart')
  getCart() {
    return this.settings.getCart();
  }

  @Get('delivery-surcharges')
  getDeliverySurcharges() {
    return this.settings.getDeliverySurcharges();
  }

  @Get('seo')
  getSiteSeo() {
    return this.settings.getSiteSeo();
  }

  @Get('menu')
  getMenu() {
    return this.settings.getMenu();
  }

  @Get('quiz-content')
  getQuizContent() {
    return this.settings.getQuizContentPublic();
  }

  @Get('applicable-gift')
  getApplicableGift(@Query('subtotal') subtotalRaw?: string) {
    if (subtotalRaw == null || subtotalRaw.trim() === '') {
      throw new BadRequestException('subtotal is required');
    }
    const subtotal = Number(subtotalRaw);
    if (!Number.isFinite(subtotal)) {
      throw new BadRequestException('subtotal must be a number');
    }
    return this.settings.getApplicableGift(subtotal);
  }
}
