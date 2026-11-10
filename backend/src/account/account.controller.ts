import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { FavoritesService } from './favorites.service';
import { QuizResultService } from './quiz-result.service';
import {
  UpdateBuyerProfileDto,
  UpsertBuyerAddressDto,
  ChangeBuyerPasswordDto,
  ReplaceFavoritesDto,
} from './dto/account.dto';
import { UpsertQuizResultDto } from './dto/quiz-result.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { BuyerGuard } from '../common/guards/buyer.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('account')
@UseGuards(JwtAuthGuard, BuyerGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly favorites: FavoritesService,
    private readonly quizResult: QuizResultService,
  ) {}

  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.account.getProfile(user.sub);
  }

  /** Выдать реф. код, если ещё нет (кнопка «получить ссылку» в ЛК). */
  @Post('me/referral')
  ensureReferral(@CurrentUser() user: JwtPayload) {
    return this.account.ensureReferralCode(user.sub);
  }

  /** Sticky: привязать referrer из ?mf= (login / resume LS). */
  @Post('me/referral/bind')
  bindReferral(
    @CurrentUser() user: JwtPayload,
    @Body() body: { code?: string | null },
  ) {
    return this.account.bindReferralCode(user.sub, body?.code);
  }

  /**
   * Quote spend: ?payable= — ₽ к оплате до wallet (товары+доставка после промо).
   * Cap/enabled также в GET /me (referralSpendCapPercent, referralEnabled).
   */
  @Get('me/referral/wallet')
  quoteReferralWallet(
    @CurrentUser() user: JwtPayload,
    @Query('payable') payableRaw?: string,
  ) {
    const payable = Math.max(0, Math.floor(Number(payableRaw) || 0));
    return this.account.quoteReferralSpend(user.sub, payable);
  }

  /** ЛК: dual balance + ссылка + share template. */
  @Get('me/referral')
  getReferralDashboard(@CurrentUser() user: JwtPayload) {
    return this.account.getReferralDashboard(user.sub);
  }

  /** ЛК: история ledger (без PII приглашённого). ?filter=all|pending|spend */
  @Get('me/referral/ledger')
  listReferralLedger(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
    @Query('filter') filterRaw?: string,
  ) {
    const limit = Math.min(50, Math.max(1, Math.floor(Number(limitRaw) || 20)));
    const filter =
      filterRaw === 'pending' || filterRaw === 'spend' || filterRaw === 'all'
        ? filterRaw
        : 'all';
    return this.account.listReferralLedger(user.sub, {
      limit,
      cursor: cursor ?? null,
      filter,
    });
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateBuyerProfileDto,
  ) {
    return this.account.updateProfile(user.sub, dto);
  }

  @Post('me/password')
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeBuyerPasswordDto,
  ) {
    return this.account.changePassword(user.sub, dto);
  }

  @Get('me/quiz-result')
  getQuizResult(@CurrentUser() user: JwtPayload) {
    return this.quizResult.get(user.sub);
  }

  @Put('me/quiz-result')
  upsertQuizResult(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertQuizResultDto,
  ) {
    return this.quizResult.upsert(user.sub, dto);
  }

  @Get('addresses')
  listAddresses(@CurrentUser() user: JwtPayload) {
    return this.account.listAddresses(user.sub);
  }

  @Post('addresses')
  createAddress(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertBuyerAddressDto,
  ) {
    return this.account.createAddress(user.sub, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpsertBuyerAddressDto,
  ) {
    return this.account.updateAddress(user.sub, id, dto);
  }

  @Delete('addresses/:id')
  deleteAddress(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.account.deleteAddress(user.sub, id);
  }

  @Post('addresses/:id/default')
  setDefault(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.account.setDefaultAddress(user.sub, id);
  }

  @Get('favorites')
  listFavoriteIds(@CurrentUser() user: JwtPayload) {
    return this.favorites.listIds(user.sub);
  }

  @Get('favorites/items')
  listFavoriteItems(@CurrentUser() user: JwtPayload) {
    return this.favorites.listItems(user.sub);
  }

  @Put('favorites')
  replaceFavorites(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReplaceFavoritesDto,
  ) {
    return this.favorites.replace(user.sub, dto.variantIds ?? []);
  }

  @Delete('favorites')
  clearFavorites(@CurrentUser() user: JwtPayload) {
    return this.favorites.clear(user.sub);
  }

  @Post('favorites/:variantId')
  addFavorite(
    @CurrentUser() user: JwtPayload,
    @Param('variantId') variantId: string,
  ) {
    return this.favorites.add(user.sub, variantId);
  }

  @Delete('favorites/:variantId')
  removeFavorite(
    @CurrentUser() user: JwtPayload,
    @Param('variantId') variantId: string,
  ) {
    return this.favorites.remove(user.sub, variantId);
  }

  @Get('orders')
  listOrders(@CurrentUser() user: JwtPayload) {
    return this.account.listOrders(user.sub);
  }

  @Get('gift-certificates')
  listGiftCertificates(@CurrentUser() user: JwtPayload) {
    return this.account.listGiftCertificates(user.sub);
  }

  @Get('orders/:id')
  getOrder(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.account.getOrder(user.sub, id);
  }

  @Post('orders/:id/cancel')
  cancelOrder(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.account.cancelOrder(user.sub, id);
  }
}
