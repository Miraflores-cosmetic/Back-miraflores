import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SearchPublicService } from './search.public.service';

@Public()
@Controller('search')
export class SearchPublicController {
  constructor(private readonly search: SearchPublicService) {}

  private buyerUserId(req: { user?: JwtPayload }): string | undefined {
    const u = req.user;
    if (u?.role === UserRole.USER && u.sub?.trim()) return u.sub.trim();
    return undefined;
  }

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  searchQuery(@Req() req: { user?: JwtPayload }, @Query('q') q?: string) {
    return this.search.search(q ?? '', { userId: this.buyerUserId(req) });
  }
}
