import { logger } from '../utils/logger';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Request body types
interface UpdateProfileBody {
  isPregnant?: boolean;
  pregnancyStartDate?: string;
  dueDate?: string;
  interests?: string[];
  notificationsEnabled?: boolean;
  reminderTime?: string;
  timezone?: string;
}

interface AddChildBody {
  name: string;
  birthDate: string;
  gender?: string;
}

interface UpdateChildBody {
  name?: string;
  birthDate?: string;
  gender?: string;
}

interface UpdateNotificationsBody {
  enabled?: boolean;
  reminderTime?: string;
}

export class UserController {
  // Get current user
  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId!;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: {
            include: {
              children: {
                where: { isActive: true }
              }
            }
          },
          subscription: true,
          favorites: {
            take: 10,
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!user) {
        res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      logger.error('Get user error:', error);
      res.status(500).json({ error: 'Failed to get user' });
    }
  }

  // Update profile
  async updateProfile(req: Request<unknown, unknown, UpdateProfileBody>, res: Response): Promise<void> {
    try {
      const userId = req.userId!;
      const {
        isPregnant,
        pregnancyStartDate,
        dueDate,
        interests,
        notificationsEnabled,
        reminderTime,
        timezone
      } = req.body;

      // Update or create profile
      const profile = await prisma.userProfile.upsert({
        where: { userId },
        update: {
          isPregnant,
          pregnancyStartDate: pregnancyStartDate ? new Date(pregnancyStartDate) : undefined,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          interests,
          notificationsEnabled,
          reminderTime,
          timezone
        },
        create: {
          userId,
          isPregnant: isPregnant ?? false,
          pregnancyStartDate: pregnancyStartDate ? new Date(pregnancyStartDate) : null,
          dueDate: dueDate ? new Date(dueDate) : null,
          interests: interests ?? [],
          notificationsEnabled: notificationsEnabled ?? true,
          reminderTime,
          timezone: timezone ?? 'Asia/Tashkent'
        }
      });

      // Calculate current week if pregnant
      if (profile.isPregnant && profile.pregnancyStartDate) {
        const weeksPregnant = Math.floor(
          (Date.now() - profile.pregnancyStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        await prisma.userProfile.update({
          where: { id: profile.id },
          data: { currentWeek: weeksPregnant }
        });
      }

      res.json(profile);
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }

  // Add child
  async addChild(req: Request<unknown, unknown, AddChildBody>, res: Response): Promise<void> {
    try {
      const userId = req.userId!;
      const { name, birthDate, gender } = req.body;

      // Get user profile
      const profile = await prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!profile) {
        // Create profile if not exists
        const newProfile = await prisma.userProfile.create({
          data: { userId }
        });

        const child = await prisma.child.create({
          data: {
            profileId: newProfile.id,
            name,
            birthDate: new Date(birthDate),
            gender
          }
        });

        res.json(child);
        return;
      }

      const child = await prisma.child.create({
        data: {
          profileId: profile.id,
          name,
          birthDate: new Date(birthDate),
          gender
        }
      });

      res.json(child);
    } catch (error) {
      logger.error('Add child error:', error);
      res.status(500).json({ error: 'Failed to add child' });
    }
  }

  // Update child
  async updateChild(req: Request<{ childId: string }, unknown, UpdateChildBody>, res: Response): Promise<void> {
    try {
      const userId = req.userId!;
      const { childId } = req.params;
      const { name, birthDate, gender } = req.body;

      // Verify child belongs to user
      const profile = await prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const child = await prisma.child.findFirst({
        where: {
          id: childId,
          profileId: profile.id
        }
      });

      if (!child) {
        res.status(404).json({ error: 'Child not found' });
      }

      const updatedChild = await prisma.child.update({
        where: { id: childId },
        data: {
          name,
          birthDate: birthDate ? new Date(birthDate) : undefined,
          gender
        }
      });

      res.json(updatedChild);
    } catch (error) {
      logger.error('Update child error:', error);
      res.status(500).json({ error: 'Failed to update child' });
    }
  }

  // Delete (archive) child
  async deleteChild(req: Request<{ childId: string }>, res: Response): Promise<void> {
    try {
      const userId = req.userId!;
      const { childId } = req.params;

      // Verify child belongs to user
      const profile = await prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const child = await prisma.child.findFirst({
        where: {
          id: childId,
          profileId: profile.id
        }
      });

      if (!child) {
        res.status(404).json({ error: 'Child not found' });
      }

      // Soft delete (archive)
      await prisma.child.update({
        where: { id: childId },
        data: { isActive: false }
      });

      res.json({ message: 'Child archived successfully' });
    } catch (error) {
      logger.error('Delete child error:', error);
      res.status(500).json({ error: 'Failed to delete child' });
    }
  }

  // Get user statistics
  async getUserStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId!;

      const [
        contentCompleted,
        favoritesCount,
        aiChatsCount,
        children
      ] = await Promise.all([
        prisma.completedContent.count({
          where: { userId }
        }),
        prisma.favorite.count({
          where: { userId }
        }),
        prisma.conversation.count({
          where: { userId }
        }),
        prisma.child.count({
          where: {
            profile: { userId },
            isActive: true
          }
        })
      ]);

      res.json({
        contentCompleted,
        favoritesCount,
        aiChatsCount,
        childrenCount: children
      });
    } catch (error) {
      logger.error('Get stats error:', error);
      res.status(500).json({ error: 'Failed to get statistics' });
    }
  }

  // Update notification settings
  async updateNotifications(req: Request<unknown, unknown, UpdateNotificationsBody>, res: Response): Promise<void> {
    try {
      const userId = req.userId!;
      const { enabled, reminderTime } = req.body;

      const profile = await prisma.userProfile.update({
        where: { userId },
        data: {
          notificationsEnabled: enabled,
          reminderTime
        }
      });

      res.json(profile);
    } catch (error) {
      logger.error('Update notifications error:', error);
      res.status(500).json({ error: 'Failed to update notifications' });
    }
  }
}