import { Body, Controller, Get, HttpCode, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SkipRlsTransaction } from '../rls/skip-rls-transaction.decorator';
import { OzonPickupPointsQueryDto } from './dto/ozon.dto';
import { OZON_UNAVAILABLE_MESSAGE, OzonAuthService } from './ozon-auth.service';
import { OzonPointsService } from './ozon-points.service';
import type { OzonPickupPoint } from './ozon-points.util';

const OZON_POINTS_DEGRADED_MESSAGE =
  'Не удалось загрузить пункты выдачи Ozon. Попробуйте позже или выберите другую службу доставки.';

type OzonAvailabilityResponse = { available: boolean; message: string | null };

type OzonPickupPointsResponse = OzonAvailabilityResponse & {
  degraded: boolean;
  points: OzonPickupPoint[];
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function resultPage(ok: boolean, message: string): string {
  const color = ok ? '#1f7a4d' : '#b42318';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ozon Доставка</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f6f6f4">
<div style="background:#fff;border-radius:16px;padding:32px 36px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,.06)">
<h1 style="font-size:20px;margin:0 0 12px;color:${color}">${ok ? 'Ozon Доставка подключена' : 'Не удалось подключить Ozon'}</h1>
<p style="margin:0;color:#444;line-height:1.5">${escapeHtml(message)}</p></div></body></html>`;
}

/**
 * Витрина: ПВЗ Ozon по координатам города. OAuth callback приложения «Ozon Доставка».
 * SkipRlsTransaction — запросы к Ozon долгие, транзакцию БД не держим.
 */
@Public()
@SkipRlsTransaction()
@UseGuards(ThrottlerGuard)
@Controller('delivery/ozon')
export class OzonPublicController {
  private readonly logger = new Logger(OzonPublicController.name);

  constructor(
    private readonly points: OzonPointsService,
    private readonly auth: OzonAuthService,
    private readonly config: ConfigService,
  ) {}

  /** Можно ли предлагать Ozon в выборе доставки (витрина скрывает опции, если нет). */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('availability')
  async availability(): Promise<OzonAvailabilityResponse> {
    const available = await this.auth.isConnected();
    return { available, message: available ? null : OZON_UNAVAILABLE_MESSAGE };
  }

  /**
   * Всегда 200: витрина показывает баннер по available/degraded, а не ошибку 5xx.
   * degraded — Ozon подключён, но справочник ПВЗ сейчас не отвечает.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('pickup-points')
  async pickupPoints(@Body() dto: OzonPickupPointsQueryDto): Promise<OzonPickupPointsResponse> {
    if (!(await this.auth.isConnected())) {
      return { available: false, degraded: false, points: [], message: OZON_UNAVAILABLE_MESSAGE };
    }
    try {
      const points = await this.points.nearby({
        lat: dto.lat,
        lon: dto.lon,
        radiusKm: dto.radiusKm,
      });
      return { available: true, degraded: false, points, message: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Ozon pickup-points degraded: ${msg}`);
      const stillConnected = await this.auth.isConnected();
      return {
        available: stillConnected,
        degraded: stillConnected,
        points: [],
        message: stillConnected ? OZON_POINTS_DEGRADED_MESSAGE : OZON_UNAVAILABLE_MESSAGE,
      };
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('oauth/callback')
  async oauthCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const adminUrl = this.config.get<string>('ADMIN_PUBLIC_URL')?.trim().replace(/\/$/, '');
    const finish = (ok: boolean, message: string) => {
      if (adminUrl) {
        const q = ok ? 'connected' : `error&message=${encodeURIComponent(message)}`;
        return res.redirect(302, `${adminUrl}/admin/settings/delivery?ozon=${q}`);
      }
      return res.status(ok ? 200 : 400).type('html').send(resultPage(ok, message));
    };

    if (error) {
      return finish(false, errorDescription || error);
    }
    if (!code || !state) {
      return finish(false, 'Нет кода авторизации. Запустите подключение заново из админки.');
    }
    try {
      await this.auth.completeAuthorization(code, state);
      return finish(true, 'Можно закрыть вкладку и вернуться в админку.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка авторизации';
      this.logger.warn(`Ozon OAuth callback failed: ${msg}`);
      return finish(false, msg);
    }
  }
}
