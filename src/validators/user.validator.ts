import { z } from 'zod';
import { Role } from '../utils/enums';
import { pageQuery } from '../utils/pagination';
import { PHONE_RE } from './auth.validator';

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  middleName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.]{3,30}$/, 'Username can use letters, numbers, _ and . (3–30 characters)')
    .optional(),
  headline: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(500).optional(),
  country: z.string().trim().max(60).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  avatarUrl: z.string().url().nullable().optional(),
  coverUrl: z.string().url().nullable().optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().regex(PHONE_RE, 'Enter a valid phone number').optional(),
});

export const updateSettingsSchema = z.object({
  appearance: z.enum(['system', 'light', 'dark']).optional(),
  dailyTargetHours: z.number().int().min(1).max(16).optional(),
  language: z.string().max(10).optional(),
  region: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
  notifications: z
    .object({
      email: z.boolean(),
      push: z.boolean(),
      sms: z.boolean(),
      courseUpdates: z.boolean(),
      assignmentReminders: z.boolean(),
      communityMessages: z.boolean(),
      promotions: z.boolean(),
    })
    .partial()
    .optional(),
  privacy: z
    .object({
      profileVisibility: z.enum(['public', 'community', 'private']),
      showOnLeaderboard: z.boolean(),
      twoFactorEnabled: z.boolean(),
      biometricEnabled: z.boolean(),
    })
    .partial()
    .optional(),
});

export const userSearchQuery = pageQuery.extend({ role: z.nativeEnum(Role).optional() });

export const notificationQuery = pageQuery.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const markReadSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
