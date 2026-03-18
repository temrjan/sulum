import { logger } from "./utils/logger";
import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { apiRouter } from "./routes";
import { bot, startBot } from "./bot";

dotenv.config();

export const prisma = new PrismaClient();

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || "http://localhost:5173",
      process.env.ADMIN_URL || "http://localhost:5174",
    ],
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
const staticPath = path.join(process.cwd(), "www");
app.use(express.static(staticPath));

// API Routes
app.use("/api/v1", apiRouter);

// Health check
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: "connected",
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

// SPA fallback
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) {
    res.sendFile(path.join(staticPath, "index.html"));
  } else {
    next();
  }
});

// Error handling
interface HttpError extends Error {
  status?: number;
  code?: string;
}

app.use(
  (
    err: HttpError,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error(err.stack);
    res.status(err.status ?? 500).json({
      error: {
        code: err.code ?? "INTERNAL_ERROR",
        message: err.message ?? "Internal server error",
      },
    });
  },
);

// Start server + bot in one process
const start = async () => {
  try {
    await prisma.$connect();
    logger.info("Database connected");

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });

    // Start bot in polling mode
    await startBot();
    logger.info("Bot started in polling mode");
  } catch (error) {
    logger.error("Failed to start:", error);
    process.exit(1);
  }
};

process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  await bot.stop();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down...");
  await bot.stop();
  await prisma.$disconnect();
  process.exit(0);
});

start();
