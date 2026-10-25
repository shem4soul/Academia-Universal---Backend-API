import { ActivityLog, Follow, OtpCode, ParentChild, TeacherVerification, User } from './user.model';
import {
  Assignment,
  Bookmark,
  Category,
  Course,
  CourseModule,
  Enrollment,
  Lesson,
  LessonProgress,
  Review,
  Submission,
} from './course.model';
import {
  Announcement,
  Comment,
  Community,
  CommunityMember,
  DirectMessage,
  Message,
  Notification,
  PlannerItem,
  Post,
  PostLike,
} from './social.model';
import {
  Faq,
  NewsletterSubscriber,
  Payment,
  PaymentCard,
  Resource,
  SupportTicket,
  WaitlistEntry,
} from './misc.model';

import { AuditLog } from './audit.model';

export * from './audit.model';
export * from './user.model';
export * from './course.model';
export * from './social.model';
export * from './misc.model';

export const ALL_MODELS = [
  User,
  ParentChild,
  TeacherVerification,
  OtpCode,
  Follow,
  ActivityLog,
  Category,
  Course,
  CourseModule,
  Lesson,
  Enrollment,
  LessonProgress,
  Review,
  Assignment,
  Submission,
  Bookmark,
  Community,
  CommunityMember,
  Message,
  DirectMessage,
  Post,
  PostLike,
  Comment,
  PlannerItem,
  Notification,
  Announcement,
  Resource,
  Faq,
  SupportTicket,
  PaymentCard,
  Payment,
  NewsletterSubscriber,
  WaitlistEntry,
  AuditLog,
];
