import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { NewsletterPublicService } from './newsletter.public.service';

@Public()
@UseGuards(ThrottlerGuard)
@Controller('newsletter')
export class NewsletterPublicController {
  constructor(private readonly newsletter: NewsletterPublicService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('subscribe')
  subscribe(@Body() dto: SubscribeNewsletterDto) {
    return this.newsletter.subscribe({
      email: dto.email,
      name: dto.name,
      source: dto.source,
    });
  }
}
