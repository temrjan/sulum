import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import { subscriptionService } from '../services/subscription.service';
import { multicardService } from '../services/multicard.service';
import { Bot } from 'grammy';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Multicard callback payload type
interface MulticardCallbackBody {
  invoice_id?: string;
  status?: string;
  amount?: number;
  [key: string]: unknown;
}

/**
 * Multicard payment callback
 * POST /api/v1/payments/callback
 * 
 * ВАЖНО: Multicard отправляет callback ТОЛЬКО при успешной оплате!
 * Если callback пришёл - значит оплата прошла успешно.
 */
router.post('/callback', async (req: Request<unknown, unknown, MulticardCallbackBody>, res: Response): Promise<void> => {
  logger.info('Payment callback received:', JSON.stringify(req.body));

  try {
    if (!multicardService.validateCallback(req.body as Record<string, unknown>)) {
      logger.warn('Invalid callback payload');
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    const invoiceId = req.body.invoice_id;

    if (!invoiceId) {
      res.status(400).json({ error: 'Missing invoice_id' });
      return;
    }

    // Multicard шлёт callback только при успешной оплате!
    // Поэтому передаём 'paid' как статус
    const success = await subscriptionService.processPaymentCallback(invoiceId, 'paid');

    logger.info('Payment callback processed:', { invoiceId, success });

    if (success) {
      const payment = await prisma.payment.findUnique({
        where: { invoiceId },
        include: { user: true }
      });

      if (payment?.user) {
        const telegramId = payment.user.telegramId.toString();
        const lang = payment.user.language as 'ru' | 'uz' || 'ru';

        const successMsg = lang === 'uz'
          ? '🎉 *Tabriklaymiz!*\n\nPremium obuna muvaffaqiyatli faollashtirildi!\n\n' +
            '✅ Endi kuniga 30 ta xabar yozishingiz mumkin.\n\n' +
            'Rahmat!'
          : '🎉 *Поздравляем!*\n\nPremium подписка успешно активирована!\n\n' +
            '✅ Теперь вам доступно 30 сообщений в день.\n\n' +
            'Спасибо!';

        try {
          const botToken = process.env.BOT_TOKEN;
          if (botToken) {
            const bot = new Bot(botToken);
            await bot.api.sendMessage(telegramId, successMsg, { parse_mode: 'Markdown' });
            logger.info('User notified about subscription:', telegramId);
          }
        } catch (notifyError) {
          logger.error('Failed to notify user:', notifyError);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Payment callback error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Get subscription status for user
 * GET /api/v1/payments/status/:telegramId
 */
router.get('/status/:telegramId', async (req: Request, res: Response): Promise<void> => {
  try {
    const telegramId = BigInt(req.params.telegramId);
    const info = await subscriptionService.getSubscriptionInfo(telegramId);

    if (!info) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(info);
  } catch (error) {
    logger.error('Get subscription status error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

export { router as paymentRouter };
