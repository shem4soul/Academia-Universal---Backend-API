import { z } from 'zod';
import { AccountStatus, DeliveryMode, PaymentPurpose, PaymentStatus, Plan, ResourceType, Role, TicketStatus, VerificationStatus } from '../utils/enums';
import { pageQuery } from '../utils/pagination';

// ----- Insights -----
export const leaderboardQuery = pageQuery.extend({ courseId: z.string().uuid().optional() });
export const studentParam = z.object({ studentId: z.string().uuid() });

// ----- Billing -----
const purchase = {
  courseId: z.string().trim().min(1).optional(),
  beneficiaryId: z.string().uuid().optional(),
};
const needsCourse = (d: { purpose: string; courseId?: string }) => d.purpose !== 'course' || !!d.courseId;

/** Start a Paystack checkout (new card, bank, USSD, transfer…). purpose=card saves a card with a refunded ₦50 check. */
export const initializePaymentSchema = z
  .object({
    purpose: z.nativeEnum(PaymentPurpose),
    ...purchase,
    saveCard: z.boolean().optional(),
    platform: z.enum(['web', 'mobile']).default('web'),
  })
  .refine(needsCourse, { message: 'Choose a course', path: ['courseId'] });

/** Pay with a saved card (Paystack charge_authorization). */
export const checkoutSchema = z
  .object({
    purpose: z.enum([PaymentPurpose.COURSE, PaymentPurpose.PRO]),
    ...purchase,
    cardId: z.string().uuid().optional(),
  })
  .refine(needsCourse, { message: 'Choose a course', path: ['courseId'] });

export const referenceParam = z.object({ reference: z.string().trim().min(6).max(100).regex(/^[A-Za-z0-9._=-]+$/) });

export const refundSchema = z.object({ reason: z.string().trim().max(300).optional() });

export const auditQuery = pageQuery.extend({
  action: z.string().trim().max(80).optional(),
  userId: z.string().uuid().optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

/** Errors reported by the web and mobile apps (see /logs/client). */
export const clientLogSchema = z.object({
  level: z.enum(['error', 'warn', 'info']).default('error'),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  platform: z.enum(['web', 'ios', 'android']).default('web'),
  appVersion: z.string().max(40).optional(),
  context: z.record(z.unknown()).optional(),
});

// ----- Resources -----
export const resourceQuery = pageQuery.extend({
  type: z.nativeEnum(ResourceType).optional(),
  mode: z.nativeEnum(DeliveryMode).optional(),
  category: z.string().optional(),
});

export const resourceSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().max(5000).optional(),
  type: z.nativeEnum(ResourceType),
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable().optional(),
  authorName: z.string().trim().min(2).max(100),
  categoryId: z.string().uuid().nullable().optional(),
  mode: z.nativeEnum(DeliveryMode).default(DeliveryMode.ONLINE),
  downloadable: z.boolean().default(true),
});

// ----- Support -----
export const ticketSchema = z.object({
  subject: z.string().trim().min(3, 'Add a subject').max(160),
  message: z.string().trim().min(10, 'Tell us a little more').max(5000),
  email: z.string().email().optional(),
});

export const respondTicketSchema = z.object({ status: z.nativeEnum(TicketStatus), response: z.string().max(5000).optional() });
export const ticketQuery = pageQuery.extend({ status: z.nativeEnum(TicketStatus).optional() });

export const faqSchema = z.object({
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(5).max(5000),
  bullets: z.array(z.string().max(200)).max(20).default([]),
  position: z.number().int().min(0).default(0),
});

// ----- Parents -----
export const addChildSchema = z.object({
  childFullName: z.string().trim().min(2, "Enter your child's name").max(120),
  childEmail: z.string().trim().email().optional().or(z.literal('')),
  relationship: z.string().trim().max(40).optional(),
});

// ----- Admin -----
export const adminUserQuery = pageQuery.extend({
  role: z.nativeEnum(Role).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
});
export const adminUpdateUserSchema = z.object({
  status: z.nativeEnum(AccountStatus).optional(),
  role: z.nativeEnum(Role).optional(),
  plan: z.nativeEnum(Plan).optional(),
});
export const verificationQuery = z.object({ status: z.nativeEnum(VerificationStatus).optional() });
export const reviewVerificationSchema = z.object({
  status: z.enum([VerificationStatus.APPROVED, VerificationStatus.REJECTED]),
  note: z.string().max(500).optional(),
});
export const paymentQuery = pageQuery.extend({ status: z.nativeEnum(PaymentStatus).optional() });
export const categorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  icon: z.string().max(40).optional(),
  description: z.string().max(300).optional(),
});
export const broadcastSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().max(1000).optional(),
  role: z.nativeEnum(Role).optional(),
});

// ----- Marketing -----
export const emailSchema = z.object({ email: z.string().trim().email('Enter a valid email') });
export const waitlistSchema = emailSchema.extend({
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(['student', 'teacher', 'parent', 'institution']).optional(),
});
