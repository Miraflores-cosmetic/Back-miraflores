import { UnauthorizedException } from '@nestjs/common';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

/** Access JWT не должен нести aud/typ/purpose (WS чата, pwreset и т.п.). */
export function assertStandardAccessJwtPayload(
  payload: JwtPayload & Record<string, unknown>,
): void {
  if (payload.aud != null) {
    const aud = payload.aud;
    const hasAud = Array.isArray(aud) ? aud.length > 0 : String(aud).length > 0;
    if (hasAud) throw new UnauthorizedException('Invalid token');
  }
  if (typeof payload.typ === 'string' && payload.typ.length > 0) {
    throw new UnauthorizedException('Invalid token');
  }
  if (typeof payload.purpose === 'string' && payload.purpose.length > 0) {
    throw new UnauthorizedException('Invalid token');
  }
}
