import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { JwtPayload } from '../decorators/current-user.decorator';
import { StaffAccessService } from '../../staff/staff-access.service';

/**
 * Доступ в админку: ADMIN (всё) или активный MODERATOR с ACL по API-пути.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly staffAccess: StaffAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      path?: string;
      url?: string;
      originalUrl?: string;
      method?: string;
    }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MODERATOR) {
      throw new ForbiddenException('Admin only');
    }
    if (!user.sub) throw new UnauthorizedException();

    const active = await this.staffAccess.isStaffAccountActive(user.sub, user.tv);
    if (!active) {
      throw new ForbiddenException('Учётная запись деактивирована');
    }

    if (user.role === UserRole.ADMIN) return true;

    const pathOnly = req.originalUrl ?? req.url ?? req.path ?? '';
    const allowed = await this.staffAccess.canAccessApiPath(
      user.sub,
      user.role,
      pathOnly,
      user.tv,
      req.method,
    );
    if (!allowed) {
      throw new ForbiddenException('Нет доступа к этому разделу админки');
    }
    return true;
  }
}
