import { BadRequestException, Controller, Get, Header, Query } from '@nestjs/common';
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

  /**
   * Home CMS bundle (hero, promo, sets, faq, gratitude, bestsellers).
   * Cache: CDN/browser may honor Cache-Control; FE also dedupes in-flight (see docs/settings-home.md).
   * Auth: public (guest); optional JWT later for group-priced bestsellers.
   */
  @Get('home')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  getHome() {
    return this.settings.getHome();
  }

  @Get('home-promo')
  getHomePromo() {
    return this.settings.getHomePromo();
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

  /**
   * Query `subtotal` — сумма товаров **после промокода** (совпадает с Nest create).
   * Имя параметра историческое; клиент шлёт payableAfterPromo.
   */
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
