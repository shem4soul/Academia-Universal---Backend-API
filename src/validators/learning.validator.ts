import { z } from 'zod';
import { PlannerItemType, SubmissionStatus } from '../utils/enums';
import { pageQuery } from '../utils/pagination';

// ----- Assignments -----
export const createAssignmentSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  description: z.string().max(10000).optional(),
  dueDate: z.coerce.date(),
  maxScore: z.number().int().min(1).max(1000).optional(),
});
export const updateAssignmentSchema = createAssignmentSchema.partial();

export const submitSchema = z.object({
  content: z.string().max(50000).optional(),
  attachmentUrl: z.string().url().optional(),
  status: z.enum([SubmissionStatus.IN_PROGRESS, SubmissionStatus.COMPLETED]).default(SubmissionStatus.COMPLETED),
});

export const gradeSchema = z.object({
  score: z.number().int().min(0).max(1000),
  feedback: z.string().max(5000).optional(),
});

export const assignmentQuery = pageQuery.extend({
  courseId: z.string().uuid().optional(),
  status: z.nativeEnum(SubmissionStatus).optional(),
});

// ----- Planner -----
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #004AC3');

export const plannerItemSchema = z
  .object({
    type: z.nativeEnum(PlannerItemType),
    title: z.string().trim().min(1, 'Add a title').max(160),
    notes: z.string().max(5000).optional(),
    startAt: z.coerce.date().nullable().optional(),
    endAt: z.coerce.date().nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
    remindAt: z.coerce.date().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    category: z.string().trim().max(60).nullable().optional(),
    color: color.optional(),
    courseId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => !d.startAt || !d.endAt || d.endAt >= d.startAt, { message: 'End must be after start', path: ['endAt'] })
  .refine((d) => d.type !== 'event' || !!d.startAt, { message: 'Events need a start time', path: ['startAt'] })
  .refine((d) => d.type !== 'reminder' || !!d.remindAt, { message: 'Reminders need a time', path: ['remindAt'] });

export const updatePlannerItemSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().max(5000).optional(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  remindAt: z.coerce.date().nullable().optional(),
  completed: z.boolean().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  category: z.string().trim().max(60).nullable().optional(),
  color: color.optional(),
});

export const plannerQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  type: z.nativeEnum(PlannerItemType).optional(),
  completed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  category: z.string().optional(),
});

export type PlannerItemInput = z.infer<typeof plannerItemSchema>;
export type PlannerQuery = z.infer<typeof plannerQuery>;
