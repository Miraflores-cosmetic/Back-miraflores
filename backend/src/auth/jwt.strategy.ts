import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { assertStandardAccessJwtPayload } from './jwt-access-token';
import { resolveJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(config),
    });
  }

  async validate(payload: JwtPayload) {
    assertStandardAccessJwtPayload(payload as JwtPayload & Record<string, unknown>);
    // Guards run before RlsInterceptor — without a tx GUC, FORCE RLS hides all User rows.
    const user = await this.prisma.runInRlsTransaction(
      { userId: String(payload.sub ?? ''), bypass: true },
      () =>
        this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            isActive: true,
            role: true,
            tokenVersion: true,
            staffDeletedAt: true,
          },
        }),
    );
    if (!user || !user.isActive || user.staffDeletedAt) {
      throw new UnauthorizedException('Учётная запись недоступна');
    }
    const tokenTv = payload.tv ?? 0;
    if (tokenTv !== user.tokenVersion) {
      throw new UnauthorizedException('Сессия истекла, войдите снова');
    }
    return { sub: user.id, email: payload.email, role: user.role, tv: user.tokenVersion };
  }
}
