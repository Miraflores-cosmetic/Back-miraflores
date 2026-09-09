import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShippingQuoteRequestDto } from './dto/shipping-quote.dto';
import { OrderPayAccessDto } from './dto/order-access.dto';
import { OrdersPublicService } from './orders.public.service';
import {
  assertYookassaWebhookAuth,
  clientIpFromHeaders,
} from './yookassa-webhook-auth';
import { ConfigService } from '@nestjs/config';

@Public()
@Controller('orders')
export class OrdersPublicController {
  constructor(
    private readonly orders: OrdersPublicService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user?: { sub?: string; role?: string },
  ) {
    const userId =
      user?.role === 'USER' && user.sub ? user.sub : null;
    return this.orders.create(dto, userId);
  }

  /** Подписанный расчёт доставки (HMAC). Create order требует этот quote. */
  @Post('shipping-quote')
  shippingQuote(
    @Body() dto: ShippingQuoteRequestDto,
    @CurrentUser() user?: { sub?: string; role?: string },
  ) {
    const userId =
      user?.role === 'USER' && user.sub ? user.sub : null;
    return this.orders.createShippingQuote(dto, userId);
  }

  /** Статика до :orderId — иначе «yookassa» / «payments» попадут в param. */
  @Post('yookassa/webhook')
  yookassaWebhook(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Headers('x-yookassa-webhook-secret') secretHeader?: string,
    @Query('secret') secretQuery?: string,
  ) {
    const nodeEnv = this.config.get<string>('NODE_ENV') || 'development';
    const secretConfigured = this.config.get<string>('YOOKASSA_WEBHOOK_SECRET');
    const checkIpEnv = this.config.get<string>('YOOKASSA_WEBHOOK_CHECK_IP');
    const checkIp =
      checkIpEnv === '1' ||
      checkIpEnv === 'true' ||
      (nodeEnv === 'production' &&
        checkIpEnv !== '0' &&
        checkIpEnv !== 'false' &&
        !secretConfigured);

    const headers = req.headers as Record<string, string | string[] | undefined>;
    assertYookassaWebhookAuth({
      secretConfigured,
      providedSecret: secretHeader || secretQuery,
      checkIp,
      clientIp: clientIpFromHeaders(headers, req.ip),
    });

    return this.orders.handleYookassaWebhook(body as never);
  }

  @Get('payments/:paymentId/status')
  paymentStatus(
    @Param('paymentId') paymentId: string,
    @Query('payToken') payToken?: string,
  ) {
    return this.orders.paymentStatus(paymentId, payToken);
  }

  /** Success после 3DS: payToken и/или JWT buyer. */
  @Get(':orderId/checkout-status')
  checkoutSuccessStatus(
    @Param('orderId') orderId: string,
    @Query('payToken') payToken?: string,
    @CurrentUser() user?: { sub?: string; role?: string },
  ) {
    const buyerUserId =
      user?.role === 'USER' && user.sub ? user.sub : null;
    return this.orders.checkoutSuccessStatus(orderId, {
      payToken,
      buyerUserId,
    });
  }

  @Post(':orderId/pay')
  createPayment(
    @Param('orderId') orderId: string,
    @Body() body: OrderPayAccessDto,
  ) {
    return this.orders.createPayment(orderId, body.payToken);
  }

  @Post(':orderId/abandon')
  abandon(
    @Param('orderId') orderId: string,
    @Body() body: OrderPayAccessDto,
  ) {
    return this.orders.abandon(orderId, body.payToken);
  }
}
