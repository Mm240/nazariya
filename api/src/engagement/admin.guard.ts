import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/** Moderation endpoints need X-Admin-Token equal to ADMIN_TOKEN. Unset token = moderation off. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    const given = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>().headers[
      'x-admin-token'
    ];
    if (!expected || expected.length < 16 || !given) throw new ForbiddenException('Moderation is not available');
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Wrong admin token');
    return true;
  }
}
