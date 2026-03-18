import { logger } from '../utils/logger';
/**
 * Subscription Service for Sulum
 * Управление подписками пользователей
 */

import { PrismaClient, BillingInterval, PaymentStatus } from '@prisma/client';
import { multicardService } from './multicard.service';

const prisma = new PrismaClient();

// ========== PRICING ==========

interface SubscriptionPlan {
  interval: BillingInterval;
  days: number;
  price: number;        // в сумах
  dailyLimit: number;   // сообщений в день
  name: {
    ru: string;
    uz: string;
  };
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  DAILY: {
    interval: BillingInterval.DAILY,
    days: 1,
    price: 9900,
    dailyLimit: 30,
    name: { ru: 'Сутки', uz: 'Sutka' },
  },
  WEEKLY: {
    interval: BillingInterval.WEEKLY,
    days: 7,
    price: 35000,
    dailyLimit: 30,
    name: { ru: 'Неделя', uz: 'Hafta' },
  },
  MONTHLY: {
    interval: BillingInterval.MONTHLY,
    days: 30,
    price: 89000,
    dailyLimit: 30,
    name: { ru: 'Месяц', uz: 'Oy' },
  },
};

export const FREE_DAILY_LIMIT = 10;
export const PREMIUM_DAILY_LIMIT = 30;

// ========== TYPES ==========

interface CreatePaymentParams {
  telegramId: bigint;
  planKey: keyof typeof SUBSCRIPTION_PLANS;
  lang?: string;
}

interface CreatePaymentResult {
  success: boolean;
  checkoutUrl?: string;
  error?: string;
}

// ========== SERVICE ==========

class SubscriptionService {
  /**
   * Проверить, активна ли подписка у пользователя
   */
  async hasActiveSubscription(telegramId: bigint): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: { subscription: true },
    });

    if (!user?.subscription) {
      return false;
    }

    const { subscription } = user;

    // Проверяем статус и дату окончания
    if (subscription.status !== 'ACTIVE') {
      return false;
    }

    if (subscription.endDate && subscription.endDate < new Date()) {
      // Подписка истекла — обновляем статус
      await this.expireSubscription(user.id);
      return false;
    }

    return true;
  }

  /**
   * Получить дневной лимит для пользователя
   */
  async getDailyLimit(telegramId: bigint): Promise<number> {
    const hasSubscription = await this.hasActiveSubscription(telegramId);
    return hasSubscription ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT;
  }

  /**
   * Создать платёж для подписки
   */
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const { telegramId, planKey, lang = 'ru' } = params;

    const plan = SUBSCRIPTION_PLANS[planKey];
    if (!plan) {
      return { success: false, error: 'Invalid plan' };
    }

    // Найти пользователя
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Проверить что Multicard настроен
    if (!multicardService.isConfigured()) {
      return { success: false, error: 'Payment system not configured' };
    }

    // Создать уникальный invoiceId
    const invoiceId = `sulum_${user.id}_${planKey}_${Date.now()}`;

    // Создать запись платежа в БД
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        invoiceId,
        amount: plan.price,
        currency: 'UZS',
        provider: 'MULTICARD',
        status: PaymentStatus.PENDING,
        billingPeriod: plan.interval,
        metadata: {
          planKey,
          telegramId: telegramId.toString(),
        },
      },
    });

    // Создать инвойс в Multicard
    try {
      const description = lang === 'uz'
        ? `Sulum Premium - ${plan.name.uz}`
        : `Sulum Premium - ${plan.name.ru}`;

      const result = await multicardService.createInvoice({
        invoiceId,
        amountSums: plan.price,
        description,
        lang,
      });

      if (!result.success || !result.data) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED },
        });
        return { success: false, error: 'Failed to create invoice' };
      }

      // Обновить payment с данными от Multicard
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          externalUuid: result.data.uuid,
          checkoutUrl: result.data.checkout_url,
        },
      });

      logger.info('Payment created', {
        invoiceId,
        planKey,
        userId: user.id,
      });

      return {
        success: true,
        checkoutUrl: result.data.checkout_url,
      };
    } catch (error) {
      logger.error('Failed to create payment', error);

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });

      return { success: false, error: 'Payment creation failed' };
    }
  }

  /**
   * Обработать callback от Multicard (активировать подписку)
   */
  async processPaymentCallback(invoiceId: string, status: string): Promise<boolean> {
    const payment = await prisma.payment.findUnique({
      where: { invoiceId },
      include: { user: true },
    });

    if (!payment) {
      logger.warn('Payment not found for callback', { invoiceId });
      return false;
    }

    // Идемпотентность — уже обработан
    if (payment.status === PaymentStatus.COMPLETED) {
      return true;
    }

    if (status === 'paid' || status === 'success' || status === 'PAID') {
      // Активировать подписку
      await this.activateSubscription({
        id: payment.id,
        userId: payment.userId ?? "",
        amount: Number(payment.amount),
        metadata: payment.metadata,
      });
      return true;
    }

    if (status === 'failed' || status === 'FAILED') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      return true;
    }

    return false;
  }

  /**
   * Активировать подписку после оплаты
   */
  private async activateSubscription(payment: { 
    id: string; 
    userId: string; 
    amount: number; 
    metadata: unknown;
    user?: unknown;
  }): Promise<void> {
    const planKey = (payment.metadata as Record<string, unknown> | undefined)?.planKey as string;
    const plan = SUBSCRIPTION_PLANS[planKey] || SUBSCRIPTION_PLANS.MONTHLY;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.days);

    await prisma.$transaction(async (tx) => {
      // Обновить или создать подписку
      await tx.subscription.upsert({
        where: { userId: payment.userId },
        update: {
          tier: 'PREMIUM',
          status: 'ACTIVE',
          billingInterval: plan.interval,
          startDate: new Date(),
          endDate,
          lastPaymentDate: new Date(),
        },
        create: {
          userId: payment.userId,
          tier: 'PREMIUM',
          status: 'ACTIVE',
          billingInterval: plan.interval,
          startDate: new Date(),
          endDate,
          lastPaymentDate: new Date(),
        },
      });

      // Отметить платёж как завершённый
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
    });

    logger.info('Subscription activated', {
      userId: payment.userId,
      planKey,
      endDate,
    });
  }

  /**
   * Пометить подписку как истёкшую
   */
  private async expireSubscription(userId: string): Promise<void> {
    await prisma.subscription.update({
      where: { userId },
      data: { status: 'EXPIRED' },
    });
  }

  /**
   * Получить информацию о подписке пользователя
   */
  async getSubscriptionInfo(telegramId: bigint) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: { subscription: true },
    });

    if (!user) {
      return null;
    }

    const isActive = await this.hasActiveSubscription(telegramId);

    return {
      hasSubscription: isActive,
      subscription: user.subscription,
      dailyLimit: isActive ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT,
    };
  }
}

export const subscriptionService = new SubscriptionService();
export { SubscriptionService };
