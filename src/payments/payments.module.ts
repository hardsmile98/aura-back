import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsWebhookController } from './payments-webhook.controller.js';
import { PaymentsService } from './payments.service.js';
import { StripeService } from './stripe.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { UserModule } from '../user/user.module.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [AuthModule, UserModule, EmailModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService, StripeService],
})
export class PaymentsModule {}
