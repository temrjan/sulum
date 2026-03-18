// Simple i18n middleware
export function i18n(ctx: { session?: { language?: string } }, next: () => Promise<void>) {
  if (!ctx.session?.language) {
    ctx.session = { ...ctx.session, language: 'ru' };
  }
  return next();
}

// Translation keys for Znai
export const messages = {
  ru: {
    welcome: `👋 Добро пожаловать в Znai!

Я — AI-психологический консультант.

Я не терапевт и не врач. Я — мудрый собеседник, который поможет тебе:

🧠 Понять себя глубже
💡 Найти направление
🌱 Сделать следующий шаг

Моя база знаний содержит мудрость величайших психотерапевтов: Франкла, Роджерса, Ялома, Бека и других.

Просто напиши свой вопрос или выбери "💬 AI Чат" в меню.`,

    select_language: 'Выберите язык / Tilni tanlang',
    profile_setup: 'Давайте познакомимся',
    are_you_pregnant: 'Расскажите о себе',
    yes: 'Да',
    no: 'Нет',
    skip: 'Пропустить',
    enter_due_date: 'Как вас зовут?',
    enter_child_info: 'Расскажите немного о себе',
    enter_child_name: 'Ваше имя?',
    enter_birth_date: 'Дата рождения (ДД.ММ.ГГГГ)',
    profile_complete: '✅ Приятно познакомиться!',
    main_menu: 'Главное меню',

    // Menu items
    menu_content: '📚 Материалы',
    menu_ai_chat: '💬 AI Чат',
    menu_tracker: '📊 Дневник',
    menu_reminders: '⏰ Напоминания',
    menu_profile: '👤 Профиль',
    menu_subscription: '💎 Подписка',

    // Errors
    error_general: 'Произошла ошибка. Попробуй позже.',
    error_invalid_date: 'Неверный формат даты.',
    error_unauthorized: 'Необходима авторизация',

    // Subscription
    subscription_free: 'Бесплатный план',
    subscription_premium: 'Premium подписка',
    subscription_upgrade: 'Улучшить план',

    // Commands
    cmd_start: 'Начать сначала',
    cmd_help: 'Помощь',
    cmd_profile: 'Мой профиль',
    cmd_settings: 'Настройки'
  },

  uz: {
    welcome: `👋 Znai ga xush kelibsiz!

Men — AI-psixologik maslahatchi.

Men terapevt yoki shifokor emasman. Men — sizga yordam beradigan dono suhbatdosh:

🧠 O'zingizni chuqurroq tushunish
💡 Yo'nalish topish
🌱 Keyingi qadamni qo'yish

Mening bilimlar bazam buyuk psixoterapevtlarning donoligi: Frankl, Rojers, Yalom, Bek va boshqalar.

Shunchaki savolingizni yozing yoki menyuda "💬 AI Chat" ni tanlang.`,

    select_language: 'Tilni tanlang / Выберите язык',
    profile_setup: 'Keling, tanishamiz',
    are_you_pregnant: "O'zingiz haqingizda ayting",
    yes: 'Ha',
    no: "Yo'q",
    skip: "O'tkazib yuborish",
    enter_due_date: 'Ismingiz nima?',
    enter_child_info: "O'zingiz haqingizda aytib bering",
    enter_child_name: 'Ismingiz?',
    enter_birth_date: "Tug'ilgan sanasi (KK.OO.YYYY)",
    profile_complete: "✅ Tanishganimdan xursandman!",
    main_menu: 'Asosiy menyu',

    // Menu items
    menu_content: '📚 Materiallar',
    menu_ai_chat: '💬 AI Chat',
    menu_tracker: '📊 Kundalik',
    menu_reminders: '⏰ Eslatmalar',
    menu_profile: '👤 Profil',
    menu_subscription: '💎 Obuna',

    // Errors
    error_general: "Xatolik yuz berdi. Keyinroq urinib ko'ring.",
    error_invalid_date: "Noto'g'ri sana formati.",
    error_unauthorized: 'Avtorizatsiya talab qilinadi',

    // Subscription
    subscription_free: 'Bepul tarif',
    subscription_premium: 'Premium obuna',
    subscription_upgrade: 'Tarifni yangilash',

    // Commands
    cmd_start: 'Boshidan boshlash',
    cmd_help: 'Yordam',
    cmd_profile: 'Mening profilim',
    cmd_settings: 'Sozlamalar'
  }
};
