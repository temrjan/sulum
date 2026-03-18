import { logger } from '../../utils/logger';
import { Bot, InputFile } from 'grammy';
import { MyContext } from '../types';
import { PrismaClient } from '@prisma/client';
import {
  mainKeyboard,
  profileKeyboard,
  languageKeyboard,
  subscriptionPlansKeyboard,
  subscriptionNotifyKeyboard
} from '../keyboards';
import { queryRag } from '../../services/rag-client';
import { SYSTEM_PROMPT } from '../../config/system-prompt';
import { notifyAdminAboutUser, notifyAdminAboutInvoice } from "../utils/notify-admin";
import {
  subscriptionService,
  FREE_DAILY_LIMIT,
  PREMIUM_DAILY_LIMIT,
  SUBSCRIPTION_PLANS
} from '../../services/subscription.service';
import { multicardService } from '../../services/multicard.service';
import { voiceService } from '../../services/voiceService';

const prisma = new PrismaClient();

const TIMEZONE_OFFSET = 5; // UTC+5 Tashkent

function isNewDay(lastDate: Date | null): boolean {
  if (!lastDate) return true;

  const now = new Date();
  const tashkentNow = new Date(now.getTime() + TIMEZONE_OFFSET * 60 * 60 * 1000);
  const tashkentLast = new Date(lastDate.getTime() + TIMEZONE_OFFSET * 60 * 60 * 1000);

  return tashkentNow.toDateString() !== tashkentLast.toDateString();
}

const WELCOME_RU = `👋 Добро пожаловать в Sulum!

Я — AI-консультант по психологии. Помогу разобраться в себе, справиться с тревогой, найти смысл и направление.

💬 Чем могу помочь:
• Тревога, стресс, беспокойство
• Поиск смысла жизни
• Отношения с людьми
• Принятие себя и своих чувств
• Сложные жизненные ситуации

📝 Как начать:
Просто напиши, что тебя волнует.

🎁 Бесплатно: ${FREE_DAILY_LIMIT} сообщений в день
Лимит обновляется каждую ночь.

⚠️ Важно:
Я не заменяю врача или психотерапевта.

Готов слушать 👇`;

const WELCOME_UZ = `👋 Sulum'ga xush kelibsiz!

Men — psixologiya bo'yicha AI-maslahatchi. O'zingizni tushunishga, tashvishni yengishga, ma'no va yo'nalish topishga yordam beraman.

💬 Qanday yordam bera olaman:
• Tashvish, stress, bezovtalik
• Hayot ma'nosini izlash
• Odamlar bilan munosabatlar
• O'zini va his-tuyg'ularini qabul qilish
• Murakkab hayotiy vaziyatlar

📝 Qanday boshlash:
Shunchaki sizni nima tashvishlantirayotganini yozing.

🎁 Bepul: kuniga ${FREE_DAILY_LIMIT} ta xabar
Limit har kecha yangilanadi.

⚠️ Muhim:
Men shifokor yoki psixoterapevtni almashtirmayman.

Tinglashga tayyorman 👇`;

export function setupHandlers(bot: Bot<MyContext>) {

  // Handle language selection callback
  bot.callbackQuery(/^lang:(.+)$/, async (ctx) => {
    const lang = ctx.match[1] as 'ru' | 'uz';
    const telegramUser = ctx.from;

    try {
      await prisma.user.upsert({
        where: { telegramId: BigInt(telegramUser.id) },
        update: { language: lang },
        create: {
          telegramId: BigInt(telegramUser.id),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
          language: lang
        }
      });

      ctx.session.language = lang;
      ctx.session.chatHistory = [];

      // Notify admin about new user
      notifyAdminAboutUser({
        id: telegramUser.id,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        language: lang,
        isNew: true
      });

      await ctx.answerCallbackQuery();
      await ctx.deleteMessage();

      const welcome = lang === 'uz' ? WELCOME_UZ : WELCOME_RU;

      await ctx.reply(welcome, {
        reply_markup: mainKeyboard(lang)
      });

    } catch (error) {
      logger.error('Language selection error:', error);
      await ctx.answerCallbackQuery({ text: 'Ошибка. Попробуй /start' });
    }
  });

  // Handle profile language change callback
  bot.callbackQuery('profile:change_lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: languageKeyboard() });
  });

  // Handle subscription plan selection
  bot.callbackQuery(/^sub:(DAILY|WEEKLY|MONTHLY)$/, async (ctx) => {
    const planKey = ctx.match[1] as 'DAILY' | 'WEEKLY' | 'MONTHLY';
    const telegramUser = ctx.from;
    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';

    await ctx.answerCallbackQuery();

    try {
      const result = await subscriptionService.createPayment({
        telegramId: BigInt(telegramUser.id),
        planKey,
        lang
      });

      if (result.success && result.checkoutUrl) {
        const plan = SUBSCRIPTION_PLANS[planKey];
        const planName = plan.name[lang];

        // Notify admin about invoice
        notifyAdminAboutInvoice({
          userId: telegramUser.id,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
          planKey,
          planName: plan.name.ru,
          price: plan.price,
          days: plan.days,
          checkoutUrl: result.checkoutUrl
        });

        const payMsg = lang === 'uz'
          ? `💳 *${planName} obunasi*\n\n` +
            `Narxi: ${plan.price.toLocaleString()} so'm\n` +
            `Muddat: ${plan.days} kun\n\n` +
            `To'lov uchun quyidagi havolani bosing:`
          : `💳 *Подписка "${planName}"*\n\n` +
            `Цена: ${plan.price.toLocaleString()} сум\n` +
            `Срок: ${plan.days} дней\n\n` +
            `Нажмите на ссылку для оплаты:`;

        await ctx.reply(payMsg + '\n\n' + result.checkoutUrl, {
          parse_mode: 'Markdown'
        });
      } else {
        const errorMsg = lang === 'uz'
          ? '❌ To\'lov yaratishda xato. Keyinroq urinib ko\'ring.'
          : '❌ Ошибка создания платежа. Попробуйте позже.';
        await ctx.reply(errorMsg);
      }
    } catch (error) {
      logger.error('Subscription payment error:', error);
      const errorMsg = lang === 'uz'
        ? '❌ Xato yuz berdi'
        : '❌ Произошла ошибка';
      await ctx.reply(errorMsg);
    }
  });

  // Handle subscription notify callback (when payment not configured)
  bot.callbackQuery('sub:notify', async (ctx) => {
    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';
    await ctx.answerCallbackQuery({
      text: lang === 'uz'
        ? '✅ Obuna chiqganda xabar beramiz!'
        : '✅ Уведомим о запуске подписки!',
      show_alert: true
    });
  });

  // Кнопка Чат
  bot.hears(['💬 Чат', '💬 Chat'], async (ctx) => {
    const telegramUser = ctx.from;
    if (!telegramUser) return;

    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';
    ctx.session.chatHistory = [];

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) }
    });

    const dailyLimit = await subscriptionService.getDailyLimit(BigInt(telegramUser.id));

    let remaining = dailyLimit;
    if (user) {
      if (isNewDay(user.lastMsgDate)) {
        remaining = dailyLimit;
      } else {
        remaining = Math.max(0, dailyLimit - user.dailyMsgCount);
      }
    }

    const msg = lang === 'uz'
      ? '💬 Chat faol. Savolingizni yozing.\n\n_Bugun qoldi: ' + remaining + '/' + dailyLimit + '_'
      : '💬 Чат активен. Напиши свой вопрос.\n\n_Сегодня осталось: ' + remaining + '/' + dailyLimit + '_';

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // Кнопка Очистить
  bot.hears(['🗑 Очистить', '🗑 Tozalash'], async (ctx) => {
    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';
    ctx.session.chatHistory = [];
    await ctx.reply(lang === 'uz'
      ? '🗑 Tarix tozalandi. Boshidan boshlaymiz!'
      : '🗑 История очищена. Начнём сначала!');
  });

  // Кнопка Профиль
  bot.hears(['👤 Профиль', '👤 Profil'], async (ctx) => {
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
      const username = user.username ? '@' + user.username : (lang === 'uz' ? "Yo'q" : 'Нет');
      const langLabel = lang === 'uz' ? "O'zbek 🇺🇿" : 'Русский 🇷🇺';

      const hasSubscription = await subscriptionService.hasActiveSubscription(BigInt(telegramUser.id));
      const dailyLimit = hasSubscription ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT;

      let todayUsed = 0;
      if (user.lastMsgDate && !isNewDay(user.lastMsgDate)) {
        todayUsed = user.dailyMsgCount;
      }
      const remaining = Math.max(0, dailyLimit - todayUsed);

      const subscriptionStatus = hasSubscription
        ? (lang === 'uz' ? '💎 Premium' : '💎 Premium')
        : (lang === 'uz' ? '🆓 Bepul' : '🆓 Бесплатный');

      const profileText = lang === 'uz'
        ? '👤 *Profil*\n\n' +
          '📛 Ism: ' + name + '\n' +
          '🔗 Username: ' + username + '\n' +
          '🌐 Til: ' + langLabel + '\n' +
          '📊 Tarif: ' + subscriptionStatus + '\n\n' +
          '💬 Bugun: ' + todayUsed + '/' + dailyLimit + ' xabar\n' +
          '✨ Qoldi: ' + remaining + ' ta'
        : '👤 *Профиль*\n\n' +
          '📛 Имя: ' + name + '\n' +
          '🔗 Username: ' + username + '\n' +
          '🌐 Язык: ' + langLabel + '\n' +
          '📊 Тариф: ' + subscriptionStatus + '\n\n' +
          '💬 Сегодня: ' + todayUsed + '/' + dailyLimit + ' сообщений\n' +
          '✨ Осталось: ' + remaining;

      await ctx.reply(profileText, {
        parse_mode: 'Markdown',
        reply_markup: profileKeyboard(lang)
      });
    } catch (error) {
      logger.error('Profile button error:', error);
      await ctx.reply(lang === 'uz' ? 'Xato yuz berdi' : 'Произошла ошибка');
    }
  });

  // Кнопка Подписка
  bot.hears(['💎 Подписка', '💎 Obuna'], async (ctx) => {
    const telegramUser = ctx.from;
    if (!telegramUser) return;

    const lang = ctx.session.language as 'ru' | 'uz' || 'ru';

    const hasSubscription = await subscriptionService.hasActiveSubscription(BigInt(telegramUser.id));

    if (hasSubscription) {
      const info = await subscriptionService.getSubscriptionInfo(BigInt(telegramUser.id));
      const endDate = info?.subscription?.endDate;
      const endDateStr = endDate
        ? endDate.toLocaleDateString(lang === 'uz' ? 'uz-UZ' : 'ru-RU')
        : '';

      const activeText = lang === 'uz'
        ? '💎 *Premium Obuna faol!*\n\n' +
          '✅ Sizda Premium obuna mavjud\n' +
          '📅 Tugash sanasi: ' + endDateStr + '\n\n' +
          '🚀 Kunlik limit: ' + PREMIUM_DAILY_LIMIT + ' ta xabar'
        : '💎 *Premium подписка активна!*\n\n' +
          '✅ У вас есть Premium подписка\n' +
          '📅 Действует до: ' + endDateStr + '\n\n' +
          '🚀 Дневной лимит: ' + PREMIUM_DAILY_LIMIT + ' сообщений';

      await ctx.reply(activeText, { parse_mode: 'Markdown' });
      return;
    }

    const subText = lang === 'uz'
      ? '💎 *Premium Obuna*\n\n' +
        'Premium imkoniyatlari:\n' +
        '• Kuniga ' + PREMIUM_DAILY_LIMIT + ' ta xabar\n' +
        '• Tezroq javoblar\n' +
        '• Ustuvor qo\'llab-quvvatlash\n\n' +
        '🆓 Hozir: kuniga ' + FREE_DAILY_LIMIT + ' ta bepul xabar\n\n' +
        '_Tarifni tanlang:_'
      : '💎 *Premium Подписка*\n\n' +
        'Возможности Premium:\n' +
        '• ' + PREMIUM_DAILY_LIMIT + ' сообщений в день\n' +
        '• Быстрые ответы\n' +
        '• Приоритетная поддержка\n\n' +
        '🆓 Сейчас: ' + FREE_DAILY_LIMIT + ' бесплатных сообщений в день\n\n' +
        '_Выберите тариф:_';

    const keyboard = multicardService.isConfigured()
      ? subscriptionPlansKeyboard(lang)
      : subscriptionNotifyKeyboard(lang);

    await ctx.reply(subText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  });

  // Handle text messages
  bot.on('message:text', async (ctx) => {
    const telegramUser = ctx.from;
    if (!telegramUser) return;

    const question = ctx.message.text;

    if (!question || question.startsWith('/')) {
      return;
    }

    let user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) }
    });

    if (!user) {
      const lang = ctx.session.language as 'ru' | 'uz' || 'ru';
      await ctx.reply(lang === 'uz' ? 'Avval /start bosing' : 'Сначала нажми /start');
      return;
    }

    const lang = user.language as 'ru' | 'uz';
    ctx.session.language = lang;

    if (!ctx.session.chatHistory) {
      ctx.session.chatHistory = [];
    }

    const dailyLimit = await subscriptionService.getDailyLimit(BigInt(telegramUser.id));

    let dailyCount = user.dailyMsgCount;
    if (isNewDay(user.lastMsgDate)) {
      dailyCount = 0;
    }

    if (dailyCount >= dailyLimit) {
      const hasSubscription = await subscriptionService.hasActiveSubscription(BigInt(telegramUser.id));

      if (hasSubscription) {
        const limitMsg = lang === 'uz'
          ? '⚠️ Bugungi ' + dailyLimit + ' ta xabar limiti tugadi.\n\n' +
            'Ertaga yana ' + dailyLimit + ' ta xabar olasiz!'
          : '⚠️ Лимит ' + dailyLimit + ' сообщений на сегодня исчерпан.\n\n' +
            'Завтра снова будет ' + dailyLimit + ' сообщений!';
        await ctx.reply(limitMsg, { parse_mode: 'Markdown' });
      } else {
        const limitMsg = lang === 'uz'
          ? '⚠️ Bugungi ' + dailyLimit + ' ta bepul xabar limiti tugadi.\n\n' +
            '💎 Premium obuna bilan kuniga ' + PREMIUM_DAILY_LIMIT + ' ta xabar!\n\n' +
            '_Yoki ertaga davom eting._'
          : '⚠️ Лимит ' + dailyLimit + ' бесплатных сообщений на сегодня исчерпан.\n\n' +
            '💎 С Premium подпиской — ' + PREMIUM_DAILY_LIMIT + ' сообщений в день!\n\n' +
            '_Или продолжите завтра._';

        const keyboard = multicardService.isConfigured()
          ? subscriptionPlansKeyboard(lang)
          : subscriptionNotifyKeyboard(lang);

        await ctx.reply(limitMsg, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
      return;
    }

    await ctx.replyWithChatAction('typing');

    try {
      const result = await queryRag(question, ctx.session.chatHistory, lang, SYSTEM_PROMPT);

      ctx.session.chatHistory.push({ role: 'user', content: question });
      ctx.session.chatHistory.push({ role: 'assistant', content: result.answer });

      await prisma.user.update({
        where: { telegramId: BigInt(telegramUser.id) },
        data: {
          dailyMsgCount: dailyCount + 1,
          lastMsgDate: new Date(),
          lastActiveAt: new Date()
        }
      });

      const remaining = dailyLimit - (dailyCount + 1);

      let response = result.answer;

      if (remaining <= 3 && remaining > 0) {
        const remainingText = lang === 'uz'
          ? '\n\n_Bugun qoldi: ' + remaining + '_'
          : '\n\n_Осталось сегодня: ' + remaining + '_';
        response += remainingText;
      } else if (remaining === 0) {
        const lastMsg = lang === 'uz'
          ? '\n\n_Bu bugungi oxirgi xabar. Ertaga davom etamiz!_'
          : '\n\n_Это последнее сообщение на сегодня. Продолжим завтра!_';
        response += lastMsg;
      }

      await ctx.reply(response, { parse_mode: 'Markdown' });

      logger.info('Chat [' + lang + '] - User: ' + telegramUser.id + ', Daily: ' + (dailyCount + 1) + '/' + dailyLimit);

    } catch (error) {
      logger.error('Chat error:', error);
      const errorMsg = lang === 'uz'
        ? '❌ Xato. Qaytadan urinib ko\'ring.'
        : '❌ Ошибка. Попробуй ещё раз.';
      await ctx.reply(errorMsg);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Handle voice messages
  // ═══════════════════════════════════════════════════════════════════
  bot.on('message:voice', async (ctx) => {
    const telegramUser = ctx.from;
    if (!telegramUser) return;

    const voice = ctx.message?.voice;
    if (!voice) return;

    let user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) }
    });

    if (!user) {
      const lang = ctx.session.language as 'ru' | 'uz' || 'ru';
      await ctx.reply(lang === 'uz' ? 'Avval /start bosing' : 'Сначала нажми /start');
      return;
    }

    const lang = user.language as 'ru' | 'uz';
    ctx.session.language = lang;

    if (!ctx.session.chatHistory) {
      ctx.session.chatHistory = [];
    }

    const dailyLimit = await subscriptionService.getDailyLimit(BigInt(telegramUser.id));

    let dailyCount = user.dailyMsgCount;
    if (isNewDay(user.lastMsgDate)) {
      dailyCount = 0;
    }

    if (dailyCount >= dailyLimit) {
      const hasSubscription = await subscriptionService.hasActiveSubscription(BigInt(telegramUser.id));
      const limitMsg = hasSubscription
        ? (lang === 'uz'
            ? '⚠️ Bugungi ' + dailyLimit + ' ta xabar limiti tugadi.'
            : '⚠️ Лимит ' + dailyLimit + ' сообщений исчерпан.')
        : (lang === 'uz'
            ? '⚠️ Bugungi ' + dailyLimit + ' ta bepul xabar limiti tugadi. 💎 Premium obuna bilan kuniga ' + PREMIUM_DAILY_LIMIT + ' ta xabar!'
            : '⚠️ Лимит ' + dailyLimit + ' бесплатных сообщений исчерпан. 💎 С Premium — ' + PREMIUM_DAILY_LIMIT + ' в день!');
      await ctx.reply(limitMsg);
      return;
    }

    try {
      const statusMsg = await ctx.reply(lang === 'uz' ? '🎤 Sizni tinglayman...': '🎤 Слушаю вас...');

      const fileId = voice.file_id;
      const file = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      
      const response = await fetch(fileUrl);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        lang === 'uz' ? '🤔 Javob tayyorlayman...': '🤔 Думаю над ответом...'
      ).catch(() => {});

      const result = await voiceService.processVoiceMessage(
        audioBuffer,
        telegramUser.id.toString(),
        async (text: string) => {
          const ragResult = await queryRag(text, ctx.session.chatHistory, lang, SYSTEM_PROMPT);
          return ragResult.answer;
        }
      );

      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

      await ctx.reply(`📝 ${lang === 'uz' ? 'Siz' : 'Вы'}: ${result.transcript}`);

      ctx.session.chatHistory.push({ role: 'user', content: result.transcript });
      ctx.session.chatHistory.push({ role: 'assistant', content: result.response });

      await ctx.replyWithChatAction('record_voice');

      const caption = result.response.length > 200
        ? result.response.substring(0, 200) + '...'
        : result.response;

      await ctx.replyWithVoice(
        new InputFile(result.audioResponse, 'response.mp3'),
        { caption: `🗣 Sulum: ${caption}` }
      );

      await prisma.user.update({
        where: { telegramId: BigInt(telegramUser.id) },
        data: {
          dailyMsgCount: dailyCount + 1,
          lastMsgDate: new Date(),
          lastActiveAt: new Date()
        }
      });

      const remaining = dailyLimit - (dailyCount + 1);
      logger.info(`Voice [${lang}] - User: ${telegramUser.id}, Daily: ${dailyCount + 1}/${dailyLimit}`);

      if (remaining <= 3 && remaining > 0) {
        await ctx.reply(lang === 'uz'
          ? `_Bugun qoldi: ${remaining}_`
          : `_Осталось сегодня: ${remaining}_`,
          { parse_mode: 'Markdown' }
        );
      }

    } catch (error: unknown) {
      logger.error('Voice message error:', error);
      const errorMsg = lang === 'uz'
        ? '❌ Ovozli xabarni qayta ishlab bolmadi. Matn bilan yozing.'
        : '❌ Не удалось обработать голосовое. Попробуйте текстом.';
      await ctx.reply(errorMsg);
    }
  });
}
