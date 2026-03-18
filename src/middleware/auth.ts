import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();

// JWT Payload type
interface JwtPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        profile?: unknown;
        subscription?: { tier: string; status: string } | null;
      };
    }
  }
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    req.userId = payload.userId;

    // Optionally load full user data
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        profile: true,
        subscription: true
      }
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = {
      id: user.id,
      profile: user.profile,
      subscription: user.subscription
    };
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Middleware for optional authentication
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      req.userId = payload.userId;

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: {
          profile: true,
          subscription: true
        }
      });

      if (user) {
        req.user = {
          id: user.id,
          profile: user.profile,
          subscription: user.subscription
        };
      }
    } catch {
      // Token is invalid but we continue anyway
    }
  }

  next();
};

// Middleware for premium users only
export const requirePremium = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const subscription = req.user.subscription;

  if (!subscription || subscription.tier !== 'PREMIUM' || subscription.status !== 'ACTIVE') {
    res.status(403).json({
      error: 'Premium subscription required',
      upgradeUrl: `${process.env.FRONTEND_URL}/subscribe`
    });
    return;
  }

  next();
};
