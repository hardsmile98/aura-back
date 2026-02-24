import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SubscriptionStatus, User } from '@prisma/client';
import { I18nContext, I18nService } from 'nestjs-i18n';
import Stripe from 'stripe';
import { StripeService } from './stripe.service.js';
import { UserService } from '../user/user.service.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

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

    const priceMonthly = this.config.getOrThrow<string>(
      'STRIPE_PRICE_MONTHLY_ID',
    );

    const isResubscribe = fullUser.subscription === 'inactive';

    if (isResubscribe) {
      await this.stripeService.stripe.subscriptions.create({
        customer: fullUser.stripeCustomerId,
        items: [{ price: priceMonthly, quantity: 1 }],
      });
    } else {
      const priceTrial = this.config.getOrThrow<string>(
        'STRIPE_PRICE_TRIAL_ID',
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
    }

    await this.userService.updateSubscriptionStatus(userId, 'active');

    return { success: true };
  }

  async cancelSubscription(userId: number): Promise<{ success: true }> {
    const fullUser = await this.userService.findById(userId);

    if (!fullUser.stripeCustomerId) {
      const lang = I18nContext.current()?.lang ?? 'en';

      throw new BadRequestException(
        this.i18n.t('payments.NO_SUBSCRIPTION', { lang }),
      );
    }

    const [activeSubs, trialingSubs] = await Promise.all([
      this.stripeService.stripe.subscriptions.list({
        customer: fullUser.stripeCustomerId,
        status: 'active',
      }),

      this.stripeService.stripe.subscriptions.list({
        customer: fullUser.stripeCustomerId,
        status: 'trialing',
      }),
    ]);

    const activeSubscription = activeSubs.data[0] ?? trialingSubs.data[0];

    if (!activeSubscription) {
      const lang = I18nContext.current()?.lang ?? 'en';

      throw new BadRequestException(
        this.i18n.t('payments.NO_SUBSCRIPTION', { lang }),
      );
    }

    if (activeSubscription.cancel_at_period_end) {
      await this.userService.saveSubscriptionEndsAt(
        userId,
        new Date(Number(activeSubscription.cancel_at) * 1000),
      );

      const lang = I18nContext.current()?.lang ?? 'en';

      throw new BadRequestException(
        this.i18n.t('payments.ALREADY_CANCELLING', { lang }),
      );
    }

    const scheduleId =
      typeof activeSubscription.schedule === 'string'
        ? activeSubscription.schedule
        : activeSubscription.schedule?.id;

    if (scheduleId) {
      await this.stripeService.stripe.subscriptionSchedules.release(scheduleId);
    }

    await this.stripeService.stripe.subscriptions.update(
      activeSubscription.id,
      { cancel_at_period_end: true },
    );

    const subscriptionItem = activeSubscription.items.data[0];

    const periodEnd = new Date(
      Number(subscriptionItem?.current_period_end ?? 0) * 1000,
    );

    await this.userService.saveSubscriptionEndsAt(userId, periodEnd);

    return { success: true };
  }

  async handleStripeWebhook(rawBody: string, signature: string): Promise<void> {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');

    if (!webhookSecret) {
      this.logger.warn('STRIPE_WEBHOOK_SECRET not set, skipping verification');
    }

    let event: Stripe.Event;

    try {
      event = webhookSecret
        ? this.stripeService.stripe.webhooks.constructEvent(
            rawBody,
            signature,
            webhookSecret,
          )
        : (JSON.parse(rawBody) as Stripe.Event);
    } catch (err) {
      this.logger.error('Webhook signature verification failed', err);

      throw new BadRequestException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionItem = subscription.items.data[0];

        const currentPeriodEnd = subscriptionItem?.current_period_end;

        await this.syncSubscriptionStatus(
          subscription.customer as string,
          subscription.status,
          subscription.cancel_at_period_end ?? false,
          currentPeriodEnd,
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        await this.syncSubscriptionStatus(
          subscription.customer as string,
          'canceled',
          false,
          undefined,
        );
        break;
      }

      default:
        this.logger.debug(`Unhandled webhook event: ${event.type}`);
    }
  }

  private async syncSubscriptionStatus(
    stripeCustomerId: string,
    stripeStatus: string,
    cancelAtPeriodEnd: boolean,
    currentPeriodEnd?: number,
  ): Promise<void> {
    const user =
      await this.userService.findByStripeCustomerId(stripeCustomerId);

    if (!user) {
      this.logger.warn(
        `User not found for Stripe customer: ${stripeCustomerId}`,
      );
      return;
    }

    const status = this.mapStripeStatusToSubscription(stripeStatus);

    await this.userService.updateSubscriptionData(
      user.id,
      status,
      cancelAtPeriodEnd,
      currentPeriodEnd,
    );

    this.logger.log(
      `Synced subscription for user ${user.id}: ${stripeStatus} -> ${status}`,
    );
  }

  private mapStripeStatusToSubscription(
    stripeStatus: string,
  ): SubscriptionStatus {
    switch (stripeStatus) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
      case 'canceled':
      case 'unpaid':
      case 'incomplete':
      case 'incomplete_expired':
      default:
        return 'inactive';
    }
  }
}
