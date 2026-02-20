import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  <K extends keyof User | undefined>(
    data: K,
    ctx: ExecutionContext,
  ): K extends keyof User ? User[K] : User => {
    const request = ctx.switchToHttp().getRequest<{ user: User }>();
    const user = request.user;

    return (data ? user?.[data] : user) as K extends keyof User
      ? User[K]
      : User;
  },
);
