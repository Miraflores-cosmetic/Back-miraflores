import { Controller, Get, Header, Headers, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SeoPrerenderService } from './seo-prerender.service';

/**
 * HTML для ботов без JS. Nginx передаёт полный URI заголовком X-Bot-Request-URI.
 */
@Public()
@Controller('seo')
export class SeoPrerenderController {
  constructor(private readonly prerender: SeoPrerenderService) {}

  @Get('bot-html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=120')
  botHtml(
    @Headers('x-bot-request-uri') headerUri: string | undefined,
    @Query('uri') queryUri?: string,
  ) {
    const raw = headerUri?.trim() || queryUri?.trim() || '/';
    return this.prerender.renderBotHtml(raw);
  }
}
