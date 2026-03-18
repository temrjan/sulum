import { logger } from '../../utils/logger';
import https from "https";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ADMIN_BOT_TOKEN = "8209047171:AAH99iEdLCE2UpPRxX9fy56eF9RKvnlW8GU";
const ADMIN_CHAT_ID = "8503214095";

interface UserInfo {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  language?: string;
  isNew: boolean;
}

async function getUserStats() {
  try {
    const totalUsers = await prisma.user.count();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayUsers = await prisma.user.count({ where: { createdAt: { gte: today } } });
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeUsers = await prisma.user.count({ where: { updatedAt: { gte: last24h } } });
    const langStats = await prisma.user.groupBy({ by: ['language'], _count: true });
    return { total: totalUsers, newToday: todayUsers, active24h: activeUsers, languages: langStats };
  } catch (error) {
    logger.error("Stats error:", error);
    return null;
  }
}

function sendToAdmin(message: string) {
  const data = JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: message, parse_mode: "HTML" });
  const req = https.request({
    hostname: "api.telegram.org",
    port: 443,
    path: `/bot${ADMIN_BOT_TOKEN}/sendMessage`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": data.length }
  }, (res) => { if (res.statusCode !== 200) logger.error(`Admin notify failed: ${res.statusCode}`); });
  req.on("error", (error) => logger.error("Admin notify error:", error.message));
  req.write(data);
  req.end();
}

export async function notifyAdminAboutUser(userInfo: UserInfo) {
  const { id, firstName, lastName, username, language, isNew } = userInfo;
  const stats = await getUserStats();
  const icon = isNew ? "🆕" : "👤";
  const status = isNew ? "<b>НОВЫЙ ПОЛЬЗОВАТЕЛЬ</b>" : "Вернулся";
  let message = `${icon} ${status} - <b>Sulum Bot</b>\n\n`;
  message += `👤 <b>Пользователь:</b>\n`;
  message += `   ID: <code>${id}</code>\n`;
  message += `   Имя: ${firstName}`;
  if (lastName) message += ` ${lastName}`;
  message += `\n`;
  if (username) message += `   Username: @${username}\n`;
  if (language) message += `   Язык: ${language === "uz" ? "🇺🇿 Uzbek" : "🇷🇺 Russian"}\n`;
  if (stats) {
    message += `\n📊 <b>Статистика:</b>\n`;
    message += `   Всего: ${stats.total} чел.\n`;
    message += `   Новых сегодня: ${stats.newToday} чел.\n`;
    message += `   Активных (24ч): ${stats.active24h} чел.\n`;
    if (stats.languages.length > 0) {
      message += `   Языки: ` + stats.languages.map((l: { language: string; _count: number }) => `${l.language}(${l._count})`).join(", ") + `\n`;
    }
  }
  message += `\n<i>⏰ ${new Date().toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}</i>`;
  sendToAdmin(message);
}

interface InvoiceInfo {
  userId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  planKey: string;
  planName: string;
  price: number;
  days: number;
  checkoutUrl?: string;
}

export async function notifyAdminAboutInvoice(invoiceInfo: InvoiceInfo) {
  const { userId, firstName, lastName, username, planKey, planName, price, days, checkoutUrl } = invoiceInfo;
  
  let message = `💰 <b>НОВЫЙ ИНВОЙС</b> - <b>Sulum Bot</b>\n\n`;
  message += `👤 <b>Пользователь:</b>\n`;
  message += `   ID: <code>${userId}</code>\n`;
  message += `   Имя: ${firstName}`;
  if (lastName) message += ` ${lastName}`;
  message += `\n`;
  if (username) message += `   Username: @${username}\n`;
  
  message += `\n📦 <b>Подписка:</b>\n`;
  message += `   Тариф: <b>${planName}</b> (${planKey})\n`;
  message += `   Цена: <b>${price.toLocaleString()} сум</b>\n`;
  message += `   Срок: ${days} дней\n`;
  
  if (checkoutUrl) {
    message += `\n🔗 <a href=${checkoutUrl}>Ссылка на оплату</a>\n`;
  }
  
  message += `\n<i>⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}</i>`;
  sendToAdmin(message);
}
