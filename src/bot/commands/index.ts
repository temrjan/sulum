import { logger } from '../../utils/logger';
import { Bot } from 'grammy';
import { MyContext } from '../types';
import { PrismaClient } from '@prisma/client';
import { mainKeyboard, languageKeyboard } from '../keyboards';
import { notifyAdminAboutUser } from "../utils/notify-admin";

const prisma = new PrismaClient();

export function setupCommands(bot: Bot<MyContext>) {
  // /start command
  bot.command('start', async (ctx) => {
    const telegramUser = ctx.from;
    if (!telegramUser) return;

    try {
      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramUser.id) }
      });

      if (existingUser) {
        // Existing user - welcome back
        const lang = existingUser.language as 'ru' | 'uz';
        ctx.session.language = lang;
        ctx.session.chatHistory = [];
        ctx.session.messageCount = 0;

        // Notify admin
        notifyAdminAboutUser({          id: telegramUser.id,          firstName: telegramUser.first_name,          lastName: telegramUser.last_name,          username: telegramUser.username,          language: lang,          isNew: false        });
        const welcomeBack = lang === 'uz'
          ? '👋 Xush kelibsiz!\n\nSavolingizni yozing — men yordam berishga tayyorman.'
          : '👋 С возвращением!\n\nПросто напиши свой вопрос — я здесь, чтобы помочь.';

        await ctx.reply(welcomeBack, {
          reply_markup: mainKeyboard(lang)
        });
      } else {
        // New user - show language selection
        ctx.session.currentStep = 'language_selection';

        await ctx.reply(
          '🌐 Tilni tanlang / Выберите язык:',
          { reply_markup: languageKeyboard() }
        );
      }
    } catch (error) {
      logger.error('Start command error:', error);

      // Fallback - show language selection
      ctx.session.currentStep = 'language_selection';
      await ctx.reply(
        '🌐 Tilni tanlang / Выберите язык:',
        { reply_markup: languageKeyboard() }
      );
    }
  });

  // /lang command - change language
  bot.command('lang', async (ctx) => {
    ctx.session.currentStep = 'language_change';
    await ctx.reply(
      '🌐 Tilni tanlang / Выберите язык:',
      { reply_markup: languageKeyboard() }
    );
  });

  // /help command
  bot.command('help', async (ctx) => {
    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';

    const helpTextUz = `ℹ️ *Sulum Yordam*

*Buyruqlar:*
/start - Boshidan boshlash
/clear - Suhbat tarixini tozalash
/lang - Tilni o'zgartirish
/help - Ushbu yordam

*Qanday foydalanish:*
Shunchaki savolingizni yozing.

*Muhim:* Men professional yordamni almashtirmayman.`;

    const helpTextRu = `ℹ️ *Помощь Sulum*

*Команды:*
/start - Начать сначала
/clear - Очистить историю чата
/lang - Сменить язык
/help - Эта справка

*Как пользоваться:*
Просто напиши свой вопрос.

*Важно:* Я не заменяю профессиональную помощь.`;

    await ctx.reply(lang === 'uz' ? helpTextUz : helpTextRu, { parse_mode: 'Markdown' });
  });

  // /profile command
  bot.command('profile', async (ctx) => {
    const telegramUser = ctx.from;
    if (!telegramUser) return;

    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';

    try {
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramUser.id) },
        include: { subscription: true }
      });

      if (!user) {
        await ctx.reply(lang === 'uz' ? 'Profil topilmadi. /start bosing' : 'Профиль не найден. Нажми /start');
        return;
      }

      const name = user.firstName || (lang === 'uz' ? "Ko'rsatilmagan" : 'Не указано');
      const msgCount = ctx.session.messageCount || 0;
      const langLabel = lang === 'uz' ? "O'zbek" : 'Русский';

      const profileText = lang === 'uz'
        ? '👤 *Profil*\n\nIsm: ' + name + '\nXabarlar: ' + msgCount + '\nTil: ' + langLabel
        : '👤 *Профиль*\n\nИмя: ' + name + '\nСообщений: ' + msgCount + '\nЯзык: ' + langLabel;

      await ctx.reply(profileText, {
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard(lang)
      });
    } catch (error) {
      logger.error('Profile command error:', error);
      await ctx.reply(lang === 'uz' ? 'Profilni yuklashda xato' : 'Ошибка загрузки профиля');
    }
  });

  // /clear command
  bot.command('clear', async (ctx) => {
    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';
    ctx.session.chatHistory = [];
    await ctx.reply(lang === 'uz'
      ? '🗑 Suhbat tarixi tozalandi. Boshidan boshlaymiz!'
      : '🗑 История разговора очищена. Начнём сначала!');
  });

  // /stats command - admin only
  bot.command('stats', async (ctx) => {
    const telegramUser = ctx.from;
    if (!telegramUser) return;

    try {
      // Check if user is admin
      const admin = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramUser.id) }
      });

      if (!admin?.isAdmin) {
        await ctx.reply('⛔ Доступ запрещён');
        return;
      }

      // Get stats
      const totalUsers = await prisma.user.count();
      const ruUsers = await prisma.user.count({ where: { language: 'ru' } });
      const uzUsers = await prisma.user.count({ where: { language: 'uz' } });

      // Get recent users
      const recentUsers = await prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          firstName: true,
          lastName: true,
          username: true,
          language: true,
          createdAt: true
        }
      });

      let statsText = '📊 *Статистика Sulum*\n\n';
      statsText += '👥 Всего пользователей: *' + totalUsers + '*\n';
      statsText += '🇷🇺 Русский: ' + ruUsers + '\n';
      statsText += '🇺🇿 Узбекский: ' + uzUsers + '\n\n';
      statsText += '*Последние пользователи:*\n';

      recentUsers.forEach((u, i) => {
        const name = (u.firstName || '') + ' ' + (u.lastName || '');
        const username = u.username ? '@' + u.username.replace(/_/g, '\_') : '-';
        statsText += (i + 1) + '. ' + name.trim() + ' (' + username + ') - ' + u.language + '\n';
      });

      await ctx.reply(statsText, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Stats command error:', error);
      await ctx.reply('❌ Ошибка получения статистики');
    }
  });
}
