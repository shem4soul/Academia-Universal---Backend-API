export enum Role {
  STUDENT = 'student',
  TEACHER = 'teacher',
  PARENT = 'parent',
  ADMIN = 'admin',
}

export enum AccountStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
}

export enum Plan {
  FREE = 'free',
  PRO = 'pro',
}

export enum EnrollmentStatus {
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
}

export enum LessonType {
  TEXT = 'text',
  VIDEO = 'video',
  DOCUMENT = 'document',
  QUIZ = 'quiz',
}

export enum SubmissionStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  LATE = 'late',
}

export enum PlannerItemType {
  EVENT = 'event',
  TASK = 'task',
  REMINDER = 'reminder',
}

export enum CommunityType {
  COMMUNITY = 'community',
  STUDY_GROUP = 'study_group',
}

export enum ResourceType {
  VIDEO = 'video',
  DOCUMENT = 'document',
}

export enum DeliveryMode {
  ONLINE = 'online',
  OFFLINE = 'offline',
}

export enum OtpPurpose {
  PASSWORD_RESET = 'password_reset',
  VERIFY_EMAIL = 'verify_email',
  VERIFY_PHONE = 'verify_phone',
}

export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  ABANDONED = 'abandoned',
  REFUND_PENDING = 'refund_pending',
  REFUNDED = 'refunded',
}

/** What a payment is for. `card` is the small, auto-refunded charge used to save a new card. */
export enum PaymentPurpose {
  COURSE = 'course',
  PRO = 'pro',
  CARD = 'card',
}

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
}

export enum NotificationType {
  COURSE = 'course',
  ASSIGNMENT = 'assignment',
  COMMUNITY = 'community',
  PLANNER = 'planner',
  BILLING = 'billing',
  SYSTEM = 'system',
}

/** Leaderboard levels, matched to the point bands shown in the Figma leaderboard. */
export const LEVELS: { name: string; min: number }[] = [
  { name: 'Expert', min: 20000 },
  { name: 'Advanced', min: 15000 },
  { name: 'Proficient', min: 10000 },
  { name: 'Intermediate', min: 8000 },
  { name: 'Novice', min: 5000 },
  { name: 'Beginner', min: 0 },
];

export function levelFor(points: number): string {
  return LEVELS.find((l) => points >= l.min)!.name;
}
