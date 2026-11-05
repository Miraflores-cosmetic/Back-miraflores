import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShippingQuoteRequestDto } from './dto/shipping-quote.dto';
import { OzonEstimateRequestDto } from '../ozon/dto/ozon.dto';
import { ShippingServerEstimateService } from './shipping-server-estimate.service';
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
    private readonly shippingEstimate: ShippingServerEstimateService,
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

  /** Тариф Ozon (своя сетка) — та же функция, что в shipping-quote. */
  @Post('shipping-estimate/ozon')
  async ozonShippingEstimate(@Body() dto: OzonEstimateRequestDto) {
    const result = await this.shippingEstimate.estimateOzon(
      dto.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      dto.dropoff,
    );
    if (!result) return { cost: null, daysMin: null, daysMax: null };
    return { cost: result.cost, daysMin: result.daysMin, daysMax: result.daysMax };
  }

  /** Публичный конфиг Web SDK Яндекс Пэй (без секретов). */
  @Get('yandexpay/config')
  yandexPayConfig() {
    return this.orders.yandexPayPublicConfig();
  }

  /**
   * Webhook Merchant API Яндекс Пэй.
   * Callback URL в ЛК: https://site/api/yandexpay → POST .../v1/webhook (Next BFF).
   * Сюда BFF проксирует JWT (text/plain или raw).
   */
  @Post('yandexpay/webhook')
  async yandexPayWebhook(@Req() req: Request, @Res() res: Response) {
    const body = req.body;
    const token =
      typeof body === 'string'
        ? body
        : Buffer.isBuffer(body)
          ? body.toString('utf8')
          : typeof body?.jwt === 'string'
            ? body.jwt
            : '';
    const result = await this.orders.handleYandexPayWebhook(token);
    return res.status(result.httpStatus).json(result.body);
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
    @CurrentUser() user?: { sub?: string; role?: string },
  ) {
    const buyerUserId =
      user?.role === 'USER' && user.sub ? user.sub : null;
    return this.orders.paymentStatus(paymentId, {
      payToken,
      buyerUserId,
    });
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
    @CurrentUser() user?: { sub?: string; role?: string },
  ) {
    const buyerUserId =
      user?.role === 'USER' && user.sub ? user.sub : null;
    return this.orders.createPayment(orderId, {
      payToken: body.payToken,
      buyerUserId,
    });
  }

  /** Яндекс Пэй: создаёт merchant order → paymentUrl для Web SDK. */
  @Post(':orderId/pay/yandexpay')
  createYandexPayPayment(
    @Param('orderId') orderId: string,
    @Body() body: OrderPayAccessDto,
    @CurrentUser() user?: { sub?: string; role?: string },
  ) {
    const buyerUserId =
      user?.role === 'USER' && user.sub ? user.sub : null;
    return this.orders.createYandexPayPayment(orderId, {
      payToken: body.payToken,
      buyerUserId,
    });
  }

  @Post(':orderId/abandon')
  abandon(
    @Param('orderId') orderId: string,
    @Body() body: OrderPayAccessDto,
  ) {
    return this.orders.abandon(orderId, body.payToken);
  }
}
