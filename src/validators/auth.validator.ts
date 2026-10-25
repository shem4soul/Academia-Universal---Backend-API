import { z } from 'zod';
import { OtpPurpose, Role } from '../utils/enums';

export const PHONE_RE = /^\+?[0-9]{7,15}$/;
const pin = z.string().regex(/^[0-9]{4,6}$/, 'PIN must be 4–6 digits');
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const identifier = z.string().trim().min(3, 'Enter your email address or mobile number');

export const registerSchema = z
  .object({
    identifier,
    password,
    confirmPassword: z.string(),
    role: z.enum([Role.STUDENT, Role.TEACHER, Role.PARENT]).default(Role.STUDENT),
    firstName: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

export const loginSchema = z.object({
  identifier,
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean().optional(),
});

export const pinLoginSchema = z.object({ identifier, pin });

export const setPinSchema = z
  .object({ pin, confirmPin: z.string() })
  .refine((d) => d.pin === d.confirmPin, { message: 'PINs do not match', path: ['confirmPin'] });

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export const requestOtpSchema = z.object({
  identifier,
  purpose: z.nativeEnum(OtpPurpose).default(OtpPurpose.PASSWORD_RESET),
});

export const verifyOtpSchema = requestOtpSchema.extend({
  code: z.string().regex(/^[0-9]{6}$/, 'Enter the 6-digit code'),
});

export const resetPasswordSchema = z
  .object({ resetToken: z.string().min(1), password, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

/** "Let's get to know you more" — shared by student, parent and teacher onboarding. */
export const onboardingSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  middleName: z.string().trim().max(60).optional(),
  phone: z.string().trim().regex(PHONE_RE, 'Enter a valid phone number').optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  country: z.string().trim().max(60).optional(),
  headline: z.string().trim().max(80).optional(),
  // parent
  childFullName: z.string().trim().max(120).optional(),
  childEmail: z.string().trim().email().optional().or(z.literal('')),
  relationship: z.string().trim().max(40).optional(),
  // teacher
  qualification: z.string().trim().max(120).optional(),
  specialization: z.string().trim().max(120).optional(),
});

export const teacherDocumentSchema = z.object({
  documentType: z.string().trim().min(2).max(80),
  documentUrl: z.string().url('Upload the document first'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const adminLoginSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
});

export const adminVerifySchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
