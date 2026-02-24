import { Injectable, NotFoundException } from '@nestjs/common';
import type { SubscriptionStatus, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findById(id: number): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByStripeCustomerId(stripeCustomerId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { stripeCustomerId },
    });
  }

  async saveStripeCustomerId(
    userId: number,
    stripeCustomerId: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
  }

  async saveStripePaymentMethodId(
    userId: number,
    stripePaymentMethodId: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripePaymentMethodId },
    });
  }

  async updateSubscriptionStatus(
    userId: number,
    status: SubscriptionStatus,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscription: status,
        ...(status === 'inactive' && { subscriptionEndsAt: null }),
      },
    });
  }

  async updateSubscriptionData(
    userId: number,
    status: SubscriptionStatus,
    cancelAtPeriodEnd: boolean,
    currentPeriodEnd?: number,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(status === 'active' && { subscriptionEndsAt: null }),
        subscription: status,
        subscriptionEndsAt: cancelAtPeriodEnd
          ? new Date(Number(currentPeriodEnd) * 1000)
          : null,
      },
    });
  }

  async saveSubscriptionEndsAt(
    userId: number,
    subscriptionEndsAt: Date,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { subscriptionEndsAt },
    });
  }
}
