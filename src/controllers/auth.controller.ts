import { logger } from '../utils/logger';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Request body types
interface TelegramAuthBody {
  initData: string;
}

interface RefreshTokenBody {
  refreshToken: string;
}

// JWT Payload type
interface JwtPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

// Telegram user data
interface TelegramUserData {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export class AuthController {
  // Telegram authentication
  async telegramAuth(req: Request<unknown, unknown, TelegramAuthBody>, res: Response): Promise<void> {
    try {
      const { initData } = req.body;

      // Validate Telegram init data
      if (!this.validateTelegramData(initData)) {
        res.status(401).json({ error: 'Invalid authentication data' });
      }

      const userData = this.parseTelegramData(initData);

      if (!userData) {
        res.status(400).json({ error: "Invalid user data" });
        return;
      }

      // Find or create user
      const user = await prisma.user.upsert({
        where: { telegramId: BigInt(userData.id) },
        update: {
          firstName: userData.first_name,
          lastName: userData.last_name,
          username: userData.username,
          lastActiveAt: new Date()
        },
        create: {
          telegramId: BigInt(userData.id),
          firstName: userData.first_name,
          lastName: userData.last_name,
          username: userData.username,
          language: userData.language_code || 'ru'
        }
      });

      // Generate tokens
      const accessToken = this.generateAccessToken(user.id);
      const refreshToken = this.generateRefreshToken(user.id);

      res.json({
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          language: user.language
        },
        accessToken,
        refreshToken
      });
    } catch (error) {
      logger.error('Auth error:', error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  }

  // Refresh token
  async refreshToken(req: Request<unknown, unknown, RefreshTokenBody>, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(401).json({ error: 'Refresh token required' });
      }

      const payload = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET!
      ) as JwtPayload;

      const user = await prisma.user.findUnique({
        where: { id: payload.userId }
      });

      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      const accessToken = this.generateAccessToken(user.id);
      const newRefreshToken = this.generateRefreshToken(user.id);

      res.json({
        accessToken,
        refreshToken: newRefreshToken
      });
    } catch {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  }

  // Logout
  logout(_req: Request, res: Response): void {
    // In a production app, you might want to invalidate the token in Redis
    res.json({ message: 'Logged out successfully' });
  }

  // Helper: Validate Telegram data
  private validateTelegramData(initData: string): boolean {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!BOT_TOKEN) return false;

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');
    const checkString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');

    return calculatedHash === hash;
  }

  // Helper: Parse Telegram data
  private parseTelegramData(initData: string): TelegramUserData | null {
    const urlParams = new URLSearchParams(initData);
    const userParam = urlParams.get('user');
    if (!userParam) return null;

    return JSON.parse(userParam) as TelegramUserData;
  }

  // Helper: Generate access token
  private generateAccessToken(userId: string): string {
    return jwt.sign(
      { userId },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );
  }

  // Helper: Generate refresh token
  private generateRefreshToken(userId: string): string {
    return jwt.sign(
      { userId },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '7d' }
    );
  }
}