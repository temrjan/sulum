import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validateRequest } from '../middleware/validate';
import { authSchema } from '../validators/auth.validator';

const router = Router();
const authController = new AuthController();

// Telegram Auth
router.post('/telegram',
  validateRequest(authSchema.telegramAuth),
  authController.telegramAuth.bind(authController)
);

// JWT Refresh
router.post('/refresh',
  validateRequest(authSchema.refreshToken),
  authController.refreshToken.bind(authController)
);

// Logout
router.post('/logout', authController.logout.bind(authController));

export { router as authRouter };
