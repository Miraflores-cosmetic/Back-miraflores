import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { parseOptionalPositiveInt } from '../common/parse-positive-int';
import {
  OrderChecklistMarkDto,
  OrderItemsUpdateDto,
  OrderNoteDto,
  OrderRefundDto,
  OrderRegisterCarrierDto,
  OrderShipDto,
  OrderShipmentCostDto,
  OrderSendTrackingDto,
  OrderShippingAddressUpdateDto,
  OrderSurchargePaymentDto,
} from './dto/order-admin-actions.dto';
import { OrdersAdminService } from './orders-admin.service';

/**
 * ACL (AdminGuard + @miraflores/admin-sections):
 * list/detail/packing/ship/… → `orders`;
 * mark-paid / refund → `orders_finance` (суперадмин — всегда).
 */
@Controller('orders/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class OrdersAdminController {
  constructor(private readonly orders: OrdersAdminService) {}

  @Get()
  list(
    @CurrentUser('sub') staffUserId: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('flag') flag?: string,
    @Query('unviewed') unviewed?: string,
  ) {
    const unviewedOnly =
      unviewed === '1' || unviewed?.trim().toLowerCase() === 'true';
    return this.orders.list({
      q,
      status,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
      staffUserId,
      flag,
      unviewedOnly,
    });
  }

  @Get('unviewed-count')
  unviewedCount() {
    return this.orders.unviewedCount();
  }

  @Get('ozon-flags')
  ozonFlagCounts() {
    return this.orders.ozonFlagCounts();
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    await this.orders.markViewed(id);
    return this.orders.getById(id);
  }

  /** Ручная отметка оплаты (без провайдера). */
  @Post(':id/mark-paid')
  markPaid(@Param('id') id: string, @CurrentUser('sub') actorUserId: string) {
    return this.orders.markPaid(id, actorUserId);
  }

  @Post(':id/packing')
  packing(@Param('id') id: string, @CurrentUser('sub') actorUserId: string) {
    return this.orders.startPacking(id, actorUserId);
  }

  @Post(':id/ship')
  ship(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderShipDto,
  ) {
    return this.orders.ship(id, actorUserId, dto);
  }

  /** Письмо клиенту с трек-номером (статус не меняет). */
  @Post(':id/send-tracking')
  sendTracking(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderSendTrackingDto,
  ) {
    return this.orders.sendTracking(id, actorUserId, dto);
  }

  /** Создать отправление у СДЭК/Яндекс без смены статуса на SHIPPED. */
  @Post(':id/register-carrier')
  registerCarrier(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderRegisterCarrierDto,
  ) {
    return this.orders.registerCarrier(id, actorUserId, dto);
  }

  @Post(':id/deliver')
  deliver(@Param('id') id: string, @CurrentUser('sub') actorUserId: string) {
    return this.orders.deliver(id, actorUserId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('sub') actorUserId: string) {
    return this.orders.cancel(id, actorUserId);
  }

  /**
   * Возврат. По умолчанию только учёт в БД.
   * `providerRefund: true` — ещё и refund в ЮKassa (нужны настроенные ключи / тестовый шлюз).
   */
  @Post(':id/refund')
  refund(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderRefundDto,
  ) {
    return this.orders.refund(id, actorUserId, dto);
  }

  @Patch(':id/shipping-address')
  updateShippingAddress(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderShippingAddressUpdateDto,
  ) {
    return this.orders.updateShippingAddress(id, actorUserId, dto);
  }

  @Put(':id/items')
  updateItems(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderItemsUpdateDto,
  ) {
    return this.orders.updateItems(id, actorUserId, dto);
  }

  @Post(':id/surcharge-payment')
  createSurcharge(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderSurchargePaymentDto,
  ) {
    return this.orders.createSurchargePayment(id, actorUserId, dto);
  }

  /** Внутренняя заметка саппорта (OrderEvent NOTE). */
  @Post(':id/note')
  addNote(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderNoteDto,
  ) {
    return this.orders.addNote(id, actorUserId, dto.message);
  }

  /** Ручной шаг чеклиста склада (общий для смен). */
  @Put(':id/checklist')
  setChecklistMark(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderChecklistMarkDto,
  ) {
    return this.orders.setChecklistMark(id, actorUserId, dto);
  }

  /** Фактическая стоимость отправления у перевозчика (сверка тарифа Ozon). */
  @Patch(':id/shipment-cost')
  setShipmentCost(
    @Param('id') id: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: OrderShipmentCostDto,
  ) {
    return this.orders.setShipmentCost(id, actorUserId, dto.carrierCostRub);
  }
}
