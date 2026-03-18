import { InlineKeyboard, Keyboard } from "grammy";
import { messages } from "../locales";

// Mini App URL
const CASES_MINI_APP_URL = "https://sulum.uz/cases/";

// Language selection keyboard
export function languageKeyboard() {
  return new InlineKeyboard()
    .text("🇷🇺 Русский", "lang:ru")
    .text("🇺🇿 O'zbek", "lang:uz");
}

// Main menu keyboard
export function mainKeyboard(lang: "ru" | "uz") {
  const keyboard = new Keyboard();
  if (lang === "uz") {
    keyboard
      .text("💬 Chat").text("🗑 Tozalash").row()
      .text("👤 Profil").text("💎 Obuna").row()
      .webApp("📖 Hikoyalar", CASES_MINI_APP_URL);
  } else {
    keyboard
      .text("💬 Чат").text("🗑 Очистить").row()
      .text("👤 Профиль").text("💎 Подписка").row()
      .webApp("📖 Истории", CASES_MINI_APP_URL);
  }
  return keyboard.resized().persistent();
}

// Cases Mini App inline keyboard
export function casesInlineKeyboard(lang: "ru" | "uz") {
  return new InlineKeyboard()
    .webApp(
      lang === "uz" ? "📖 Hikoyalarni ko'rish" : "📖 Смотреть истории",
      CASES_MINI_APP_URL
    );
}

// Profile keyboard with language change
export function profileKeyboard(lang: "ru" | "uz") {
  return new InlineKeyboard()
    .text(lang === "uz" ? "🌐 Tilni o'zgartirish" : "🌐 Сменить язык", "profile:change_lang");
}

// Subscription plans keyboard
export function subscriptionPlansKeyboard(lang: "ru" | "uz") {
  const kb = new InlineKeyboard();

  if (lang === "uz") {
    kb.text("🕐 1 kun — 9,900 so'm", "sub:DAILY").row()
      .text("📅 7 kun — 35,000 so'm", "sub:WEEKLY").row()
      .text("📆 30 kun — 89,000 so'm", "sub:MONTHLY");
  } else {
    kb.text("🕐 1 день — 9,900 сум", "sub:DAILY").row()
      .text("📅 7 дней — 35,000 сум", "sub:WEEKLY").row()
      .text("📆 30 дней — 89,000 сум", "sub:MONTHLY");
  }

  return kb;
}

// Subscription notify keyboard (when payment not configured)
export function subscriptionNotifyKeyboard(lang: "ru" | "uz") {
  return new InlineKeyboard()
    .text(lang === "uz" ? "🔔 Xabar berish" : "🔔 Уведомить о запуске", "sub:notify");
}

// Yes/No keyboard
export function yesNoKeyboard(lang: "ru" | "uz") {
  const m = messages[lang];
  return new InlineKeyboard()
    .text(m.yes, "yn:yes")
    .text(m.no, "yn:no")
    .text(m.skip, "yn:skip");
}

// Profile setup keyboard
export function profileSetupKeyboard(_lang: "ru" | "uz") {
  return new InlineKeyboard()
    .text("👋 Начать общение", "setup:skip");
}

// Web App launch keyboard
export function webAppKeyboard(_lang: "ru" | "uz") {
  return new InlineKeyboard()
    .text("💬 Начать чат", "start:chat");
}

// Content categories keyboard
export function contentCategoriesKeyboard(_lang: "ru" | "uz") {
  return new InlineKeyboard()
    .text("🧠 Смысл жизни", "cat:meaning")
    .text("😰 Тревога", "cat:anxiety")
    .row()
    .text("💔 Отношения", "cat:relationships")
    .text("😢 Депрессия", "cat:depression")
    .row()
    .text("🔙 Назад", "back:main");
}
