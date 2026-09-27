import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { SkipRlsTransaction } from '../rls/skip-rls-transaction.decorator';
import { OzonDimsApplyDto, OzonReconciliationQueryDto, OzonVariantDimsDto } from './dto/ozon.dto';
import { OzonAuthService } from './ozon-auth.service';
import { OzonCatalogDimsService } from './ozon-catalog-dims.service';
import { OzonHealthService } from './ozon-health.service';
import { OzonReconciliationService } from './ozon-reconciliation.service';
import { currentOzonTariff } from './ozon-tariff';

@Controller('delivery/ozon/admin')
@UseGuards(JwtAuthGuard, AdminGuard, SuperAdminGuard)
@SkipRlsTransaction()
export class OzonAdminController {
  constructor(
    private readonly auth: OzonAuthService,
    private readonly health: OzonHealthService,
    private readonly dims: OzonCatalogDimsService,
    private readonly reconciliation: OzonReconciliationService,
  ) {}

  @Get('status')
  status() {
    return this.auth.status();
  }

  @Post('authorize-url')
  authorizeUrl(@CurrentUser() user: JwtPayload) {
    return { url: this.auth.buildAuthorizeUrl(String(user.sub)) };
  }

  @Post('disconnect')
  async disconnect() {
    await this.auth.disconnect();
    return this.auth.status();
  }

  /** Живая проверка: токен + справочник ПВЗ (пишется в историю мониторинга). */
  @Post('test')
  async test() {
    const r = await this.health.check('manual');
    return { ok: r.ok, pointCount: r.pointCount, failure: r.failure, error: r.error };
  }

  @Get('health')
  healthDashboard() {
    return this.health.dashboard();
  }

  @Get('catalog-dims')
  catalogDims() {
    return this.dims.audit();
  }

  @Post('catalog-dims/apply')
  applyCatalogDims(@Body() dto: OzonDimsApplyDto) {
    return this.dims.applySuggestions(dto.variantIds);
  }

  @Patch('catalog-dims/:variantId')
  updateVariantDims(@Param('variantId') variantId: string, @Body() dto: OzonVariantDimsDto) {
    return this.dims.updateVariantDims(variantId, dto);
  }

  @Get('tariff')
  tariff() {
    return currentOzonTariff();
  }

  @Get('tariff-reconciliation')
  tariffReconciliation(@Query() q: OzonReconciliationQueryDto) {
    return this.reconciliation.report(q.days ?? 90);
  }
}
