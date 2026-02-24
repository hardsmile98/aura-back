import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  public readonly stripe: Stripe;

  constructor(config: ConfigService) {
    const secretKey = config.getOrThrow<string>('STRIPE_SECRET_KEY');

    this.stripe = new Stripe(secretKey);
  }
}
