import { z } from 'zod';
import { CommunityType } from '../utils/enums';
import { pageQuery } from '../utils/pagination';

export const communityQuery = pageQuery.extend({
  type: z.nativeEnum(CommunityType).optional(),
  scope: z.enum(['all', 'mine', 'recommended']).default('all'),
});

export const createCommunitySchema = z.object({
  name: z.string().trim().min(2, 'Give it a name').max(80),
  description: z.string().trim().max(1000).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  type: z.nativeEnum(CommunityType).default(CommunityType.COMMUNITY),
  isPublic: z.boolean().default(true),
  courseId: z.string().uuid().nullable().optional(),
  memberIds: z.array(z.string().uuid()).max(100).optional(),
});

export const updateCommunitySchema = createCommunitySchema.omit({ type: true, memberIds: true }).partial();

export const messageQuery = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendMessageSchema = z
  .object({
    body: z.string().trim().max(4000).default(''),
    attachmentUrl: z.string().url().optional(),
    attachmentType: z.enum(['image', 'file', 'audio', 'video']).optional(),
  })
  .refine((d) => d.body.length > 0 || !!d.attachmentUrl, { message: 'Type a message', path: ['body'] });

export const liveSessionSchema = z.object({ at: z.coerce.date().nullable() });

export const postQuery = pageQuery.extend({
  communityId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
  feed: z.enum(['all', 'following']).default('all'),
});

export const createPostSchema = z
  .object({
    body: z.string().trim().max(5000).default(''),
    imageUrl: z.string().url().optional(),
    communityId: z.string().uuid().optional(),
  })
  .refine((d) => d.body.length > 0 || !!d.imageUrl, { message: 'Write something or add a picture', path: ['body'] });

export const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(2000) });

export const announcementSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().max(5000).default(''),
  courseId: z.string().uuid().nullable().optional(),
});

export const userIdParam = z.object({ userId: z.string().uuid() });
