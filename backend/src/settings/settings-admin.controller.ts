import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator';
import { EmailNotificationsService } from '../mail/email-notifications.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReplaceFaqItemsDto } from './dto/faq.dto';
import { ReplaceGratitudeDto } from './dto/gratitude.dto';
import { ReplaceHeroSlidesDto } from './dto/hero.dto';
import { ReplaceHomepageSetsDto } from './dto/homepage-sets.dto';
import { ReplaceProductAttributeOptionsDto } from './dto/product-attributes.dto';
import { ReplaceQuizContentDto } from './dto/quiz-content.dto';
import { DiscardCartUploadsDto, UpdateCartSettingsDto } from './dto/cart.dto';
import { UpdateEmailNotificationTemplateDto, PreviewEmailNotificationDto } from './dto/email-notifications.dto';
import { UpdateMenuSettingsDto } from './dto/menu.dto';
import { UpdateSiteSeoSettingsDto } from './dto/site-seo.dto';
import { SettingsAdminService } from './settings.service';

@Controller('settings/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SettingsAdminController {
  constructor(
    private readonly settings: SettingsAdminService,
    private readonly emailNotifications: EmailNotificationsService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}

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

  @Get('email-notifications')
  listEmailNotifications() {
    return this.emailNotifications.list();
  }

  @Get('email-notifications/:eventKey')
  getEmailNotification(@Param('eventKey') eventKey: string) {
    return this.emailNotifications.get(eventKey);
  }

  @Put('email-notifications/:eventKey')
  async updateEmailNotification(
    @Param('eventKey') eventKey: string,
    @Body() dto: UpdateEmailNotificationTemplateDto,
    @CurrentUser() jwt: JwtPayload,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { email: true },
    });
    return this.emailNotifications.update(eventKey, dto, {
      userId: jwt.sub,
      email: user?.email ?? jwt.email ?? null,
    });
  }

  @Get('email-notifications/:eventKey/revisions')
  listEmailNotificationRevisions(@Param('eventKey') eventKey: string) {
    return this.emailNotifications.listRevisions(eventKey);
  }

  @Post('email-notifications/:eventKey/preview')
  previewEmailNotification(
    @Param('eventKey') eventKey: string,
    @Body() dto: PreviewEmailNotificationDto,
  ) {
    return this.emailNotifications.preview(eventKey, {
      subject: dto.subject,
      body: dto.body,
      sampleVariant: dto.sampleVariant,
    });
  }

  @Post('email-notifications/:eventKey/test-send')
  async testSendEmailNotification(
    @Param('eventKey') eventKey: string,
    @Body() dto: PreviewEmailNotificationDto,
    @CurrentUser() jwt: JwtPayload,
  ) {
    if (!this.mail.isConfigured()) {
      throw new BadRequestException('SMTP не настроен — тест не отправить');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { email: true },
    });
    const to = user?.email?.trim();
    if (!to) {
      throw new BadRequestException('У вашего аккаунта нет email');
    }
    const built = await this.emailNotifications.preview(eventKey, {
      subject: dto.subject,
      body: dto.body,
      sampleVariant: dto.sampleVariant,
    });
    await this.mail.sendRaw({
      to,
      subject: `[тест] ${built.subject}`,
      text: built.text,
      html: built.html,
    });
    return { ok: true as const, to };
  }
}
