import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { StripeService } from './stripe.service.js';
import { UserService } from '../user/user.service.js';

@Injectable()
export class PaymentsService {
  constructor(
    private stripeService: StripeService,
    private userService: UserService,
    private config: ConfigService,
    private i18n: I18nService,
  ) {}

  async createSetupIntent(user: User): Promise<{ clientSecret: string }> {
    let customerId = user.stripeCustomerId ?? undefined;

    if (!customerId) {
      const customer = await this.stripeService.stripe.customers.create({
        email: user.email,
        metadata: { userId: String(user.id) },
      });

      customerId = customer.id;

      await this.userService.saveStripeCustomerId(user.id, customerId);
    }

    const setupIntent = await this.stripeService.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });

    return { clientSecret: setupIntent.client_secret! };
  }

  async subscribe(
    userId: number,
    paymentMethodId: string,
  ): Promise<{ success: true }> {
    const fullUser = await this.userService.findById(userId);

    if (!fullUser.stripeCustomerId) {
      const lang = I18nContext.current()?.lang ?? 'en';

      throw new BadRequestException(
        this.i18n.t('payments.SETUP_INTENT_REQUIRED', { lang }),
      );
    }

    const [schedules, subscriptions] = await Promise.all([
      this.stripeService.stripe.subscriptionSchedules.list({
        customer: fullUser.stripeCustomerId,
      }),

      this.stripeService.stripe.subscriptions.list({
        customer: fullUser.stripeCustomerId,
        status: 'active',
      }),
    ]);

    const hasActiveSchedule = schedules.data.some((s) => s.status === 'active');

    if (hasActiveSchedule || subscriptions.data.length > 0) {
      const lang = I18nContext.current()?.lang ?? 'en';

      throw new BadRequestException(
        this.i18n.t('payments.ALREADY_SUBSCRIBED', { lang }),
      );
    }

    await this.stripeService.stripe.paymentMethods.attach(paymentMethodId, {
      customer: fullUser.stripeCustomerId,
    });

    await this.stripeService.stripe.customers.update(
      fullUser.stripeCustomerId,
      {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      },
    );

    await this.userService.saveStripePaymentMethodId(userId, paymentMethodId);

    const priceTrial = this.config.getOrThrow<string>('STRIPE_PRICE_TRIAL_ID');

    const priceMonthly = this.config.getOrThrow<string>(
      'STRIPE_PRICE_MONTHLY_ID',
    );

    await this.stripeService.stripe.subscriptionSchedules.create({
      customer: fullUser.stripeCustomerId,
      start_date: 'now',
      end_behavior: 'release',
      phases: [
        {
          items: [{ price: priceTrial, quantity: 1 }],
          duration: { interval: 'day', interval_count: 3 },
        },
        {
          items: [{ price: priceMonthly, quantity: 1 }],
        },
      ],
    });

    return { success: true };
  }
}
