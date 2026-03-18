import { z } from 'zod';

export const authSchema = {
  telegramAuth: z.object({
    body: z.object({
      initData: z.string().min(1, 'Init data is required')
    })
  }),

  refreshToken: z.object({
    body: z.object({
      refreshToken: z.string().min(1, 'Refresh token is required')
    })
  })
};