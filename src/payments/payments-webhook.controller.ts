import {
  Controller,
  Headers,
  Post,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsWebhookController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody;

    if (!rawBody || !signature) {
      throw new BadRequestException('Missing webhook payload or signature');
    }

    await this.paymentsService.handleStripeWebhook(
      rawBody.toString('utf8'),
      signature,
    );

    return { received: true };
  }
}
