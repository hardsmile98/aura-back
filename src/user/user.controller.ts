import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { SubscriptionGuard } from '../auth/guards/subscription.guard.js';
import { CurrentUser } from '../auth/decorators/user.decorator.js';
import { HoroscopeService } from '../horoscope/horoscope.service.js';
import { GetHoroscopeDto } from '../horoscope/dto/get-horoscope.dto.js';
import { SketchService } from '../sketch/sketch.service.js';
import { GetSketchDto } from '../sketch/dto/get-sketch.dto.js';

@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  constructor(
    private horoscope: HoroscopeService,
    private sketch: SketchService,
  ) {}

  @Get('profile')
  getProfile(@CurrentUser() user: User) {
    return user;
  }

  @Get('horoscope')
  @UseGuards(SubscriptionGuard)
  getHoroscope(@CurrentUser() user: User, @Query() dto: GetHoroscopeDto) {
    return this.horoscope.getHoroscope(
      user.id,
      user.quizResult as Record<string, unknown> | null,
      dto.period,
      dto.locale ?? 'en',
    );
  }

  @Get('sketch')
  @UseGuards(SubscriptionGuard)
  getSketch(@CurrentUser() user: User, @Query() dto: GetSketchDto) {
    return this.sketch.getSketch(
      user.id,
      user.quizResult as Record<string, unknown> | null,
      dto.type,
      dto.locale ?? 'en',
    );
  }
}
