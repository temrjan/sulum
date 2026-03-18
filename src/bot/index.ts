import { logger } from "../utils/logger";
import { Bot, GrammyError, HttpError, session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { MyContext, SessionData } from "./types";
import { setupCommands } from "./commands";
import { setupHandlers } from "./handlers";
import { i18n } from "./locales";

export const bot = new Bot<MyContext>(process.env.TELEGRAM_BOT_TOKEN || "");

bot.use(
  session({
    initial: (): SessionData => ({
      chatHistory: [],
      messageCount: 0,
      language: "ru",
      botMessageIds: [],
    }),
  }),
);

bot.use(i18n);
bot.use(conversations());

setupCommands(bot);
setupHandlers(bot);

bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    logger.error("Error in request:", e.description);
  } else if (e instanceof HttpError) {
    logger.error("Could not contact Telegram:", e);
  } else {
    logger.error("Unknown error:", e);
  }
});

export async function startBot(): Promise<void> {
  await bot.api.deleteWebhook();
  void bot.start({
    onStart: (botInfo) => {
      logger.info(`Bot @${botInfo.username} started in polling mode`);
    },
  });
}
