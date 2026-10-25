import { z } from 'zod';
import { DeliveryMode, EnrollmentStatus, LessonType } from '../utils/enums';
import { pageQuery } from '../utils/pagination';

export const courseQuery = pageQuery.extend({
  category: z.string().optional(),
  level: z.coerce.number().int().min(1).max(3).optional(),
  price: z.enum(['free', 'paid']).optional(),
  mode: z.nativeEnum(DeliveryMode).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  instructorId: z.string().uuid().optional(),
  sort: z.enum(['popular', 'newest', 'rating', 'price_asc', 'price_desc']).default('popular'),
});

export const enrolledQuery = pageQuery.extend({ status: z.nativeEnum(EnrollmentStatus).optional() });

export const createCourseSchema = z.object({
  title: z.string().trim().min(3, 'Give the course a title').max(120),
  subtitle: z.string().trim().max(200).optional(),
  description: z.string().max(20000).optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  previewVideoUrl: z.string().url().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  level: z.number().int().min(1).max(3).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  durationWeeks: z.number().int().min(1).max(104).optional(),
  mode: z.nativeEnum(DeliveryMode).optional(),
  tags: z.array(z.string().trim().toLowerCase()).max(20).optional(),
  outcomes: z.array(z.string().trim()).max(20).optional(),
});

export const updateCourseSchema = createCourseSchema.partial().extend({ isPublished: z.boolean().optional() });

export const moduleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  position: z.number().int().min(0).optional(),
});

export const lessonSchema = z.object({
  title: z.string().trim().min(1).max(160),
  type: z.nativeEnum(LessonType).default(LessonType.TEXT),
  content: z.string().max(100000).optional(),
  videoUrl: z.string().url().nullable().optional(),
  documentUrl: z.string().url().nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  position: z.number().int().min(0).optional(),
  isPreview: z.boolean().optional(),
});

export const updateLessonSchema = lessonSchema.partial();

export const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Pick a rating').max(5),
  comment: z.string().trim().max(2000).optional(),
});

export const lessonCompleteSchema = z.object({ minutesSpent: z.number().int().min(0).max(600).optional() });

export const heartbeatSchema = z.object({
  minutes: z.number().int().min(1).max(60),
  lessonId: z.string().uuid().optional(),
});

export type CourseQuery = z.infer<typeof courseQuery>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type LessonInput = z.infer<typeof lessonSchema>;
