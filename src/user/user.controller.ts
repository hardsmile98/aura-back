import { Controller, Get, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/user.decorator.js';

@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  @Get('profile')
  getProfile(@CurrentUser() user: User) {
    return user;
  }
}
