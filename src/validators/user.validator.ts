import { z } from 'zod';

const genderEnum = z.enum(['MALE', 'FEMALE', 'OTHER']);

export const userSchema = {
  updateProfile: z.object({
    body: z.object({
      isPregnant: z.boolean().optional(),
      pregnancyStartDate: z.string().datetime().optional(),
      dueDate: z.string().datetime().optional(),
      interests: z.array(z.string()).optional(),
      notificationsEnabled: z.boolean().optional(),
      reminderTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
      timezone: z.string().optional()
    })
  }),

  addChild: z.object({
    body: z.object({
      name: z.string().min(1).max(50),
      birthDate: z.string().datetime(),
      gender: genderEnum.optional()
    })
  }),

  updateChild: z.object({
    params: z.object({
      childId: z.string().uuid()
    }),
    body: z.object({
      name: z.string().min(1).max(50).optional(),
      birthDate: z.string().datetime().optional(),
      gender: genderEnum.optional()
    })
  }),

  updateNotifications: z.object({
    body: z.object({
      enabled: z.boolean(),
      reminderTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional()
    })
  })
};