import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/user.decorator.js';
import { PaymentsService } from './payments.service.js';
import { SubscribeDto } from './dto/subscribe.dto.js';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('create-setup-intent')
  createSetupIntent(@CurrentUser() user: User) {
    return this.paymentsService.createSetupIntent(user);
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: User, @Body() dto: SubscribeDto) {
    return this.paymentsService.subscribe(user.id, dto.paymentMethodId);
  }
}
