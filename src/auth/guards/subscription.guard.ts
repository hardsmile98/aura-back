import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { I18nContext, I18nService } from 'nestjs-i18n';
import type { User } from '@prisma/client';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private i18n: I18nService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;

    if (!user || user.subscription !== 'active') {
      const lang = I18nContext.current()?.lang ?? 'en';
      throw new ForbiddenException(
        this.i18n.t('subscription.REQUIRED', { lang }),
      );
    }

    return true;
  }
}
