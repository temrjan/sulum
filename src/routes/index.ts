import { Router } from 'express';
import { authRouter } from './auth.routes';
import { userRouter } from './user.routes';
import { aiRouter } from './ai.routes';
import { paymentRouter } from './payment.routes';

const router = Router();

// API Routes
router.use('/auth', authRouter);
router.use('/users', userRouter);
router.use('/ai', aiRouter);
router.use('/payments', paymentRouter);

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

export { router as apiRouter };
