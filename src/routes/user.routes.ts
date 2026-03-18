import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticateToken } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { userSchema } from '../validators/user.validator';

const router = Router();
const userController = new UserController();

// Get current user profile
router.get('/me', authenticateToken, userController.getCurrentUser.bind(userController));

// Update user profile
router.put('/profile',
  authenticateToken,
  validateRequest(userSchema.updateProfile),
  userController.updateProfile.bind(userController)
);

// Add child
router.post('/children',
  authenticateToken,
  validateRequest(userSchema.addChild),
  userController.addChild.bind(userController)
);

// Update child
router.put('/children/:childId',
  authenticateToken,
  validateRequest(userSchema.updateChild),
  userController.updateChild.bind(userController)
);

// Delete child
router.delete('/children/:childId',
  authenticateToken,
  userController.deleteChild.bind(userController)
);

// Get user statistics
router.get('/stats', authenticateToken, userController.getUserStats.bind(userController));

// Update notification settings
router.put('/notifications',
  authenticateToken,
  validateRequest(userSchema.updateNotifications),
  userController.updateNotifications.bind(userController)
);

export { router as userRouter };