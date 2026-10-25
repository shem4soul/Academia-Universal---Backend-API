import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.model';
import { AccountStatus, OtpPurpose, Plan, Role, VerificationStatus } from '../utils/enums';

export interface UserSettings {
  appearance: 'system' | 'light' | 'dark';
  dailyTargetHours: number;
  language: string;
  region: string;
  timezone: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    courseUpdates: boolean;
    assignmentReminders: boolean;
    communityMessages: boolean;
    promotions: boolean;
  };
  privacy: {
    profileVisibility: 'public' | 'community' | 'private';
    showOnLeaderboard: boolean;
    twoFactorEnabled: boolean;
    biometricEnabled: boolean;
  };
}

export const DEFAULT_SETTINGS: UserSettings = {
  appearance: 'system',
  dailyTargetHours: 7,
  language: 'en',
  region: 'NG',
  timezone: 'Africa/Lagos',
  notifications: {
    email: true,
    push: true,
    sms: false,
    courseUpdates: true,
    assignmentReminders: true,
    communityMessages: true,
    promotions: false,
  },
  privacy: {
    profileVisibility: 'community',
    showOnLeaderboard: true,
    twoFactorEnabled: false,
    biometricEnabled: false,
  },
};

@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true, where: '"email" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Index({ unique: true, where: '"phone" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'varchar', nullable: true, select: false })
  pinHash: string | null;

  /** Incremented to invalidate all refresh tokens (logout everywhere / password change). */
  @Column({ default: 0 })
  tokenVersion: number;

  @Column({ type: 'enum', enum: Role, default: Role.STUDENT })
  role: Role;

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.ACTIVE })
  status: AccountStatus;

  @Column({ type: 'enum', enum: Plan, default: Plan.FREE })
  plan: Plan;

  /** When the paid Pro month ends. Renewed by each successful Pro payment. */
  @Column({ type: 'timestamptz', nullable: true })
  proExpiresAt: Date | null;

  /** Admin 2FA: encrypted authenticator secret, set once the admin confirms a code. */
  @Column({ type: 'varchar', nullable: true, select: false })
  totpSecret: string | null;

  /** Admin 2FA: secret shown during setup, not active until confirmed. */
  @Column({ type: 'varchar', nullable: true, select: false })
  totpPendingSecret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  totpEnabledAt: Date | null;

  /** Last accepted TOTP time step — a code can't be used twice. */
  @Column({ type: 'bigint', nullable: true, select: false })
  totpLastStep: string | null;

  /** Paystack customer code (CUS_xxx), stored after the first payment. */
  @Column({ type: 'varchar', nullable: true })
  paystackCustomerCode: string | null;

  @Column({ default: '' })
  firstName: string;

  @Column({ default: '' })
  middleName: string;

  @Column({ default: '' })
  lastName: string;

  @Index({ unique: true, where: '"username" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  username: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  coverUrl: string | null;

  /** Headline shown under the name, e.g. "AWS Student" / "AWS Instructor". */
  @Column({ type: 'varchar', nullable: true })
  headline: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', nullable: true })
  country: string | null;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ default: false })
  phoneVerified: boolean;

  @Column({ default: false })
  onboardingComplete: boolean;

  @Column({ default: 0 })
  points: number;

  @Column({ default: 0 })
  streakDays: number;

  @Column({ type: 'date', nullable: true })
  lastActiveDate: string | null;

  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_SETTINGS)}'` })
  settings: UserSettings;

  get fullName(): string {
    return [this.firstName, this.lastName].filter(Boolean).join(' ');
  }
}

/** Link between a parent account and a child (student). The child may not have an account yet. */
@Entity('parent_children')
export class ParentChild extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  parent: User;

  @Column()
  parentId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  child: User | null;

  @Column({ type: 'uuid', nullable: true })
  childId: string | null;

  @Column()
  childFullName: string;

  @Column({ type: 'varchar', nullable: true })
  childEmail: string | null;

  @Column({ default: 'parent' })
  relationship: string;
}

/** Instructor document verification (mobile "document verification" step). */
@Entity('teacher_verifications')
export class TeacherVerification extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @Column()
  documentType: string;

  @Column()
  documentUrl: string;

  @Column({ type: 'varchar', nullable: true })
  qualification: string | null;

  @Column({ type: 'varchar', nullable: true })
  specialization: string | null;

  @Column({ type: 'enum', enum: VerificationStatus, default: VerificationStatus.PENDING })
  status: VerificationStatus;

  @Column({ type: 'varchar', nullable: true })
  reviewNote: string | null;
}

@Entity('otp_codes')
export class OtpCode extends BaseEntity {
  @Index()
  @Column()
  target: string;

  @Column({ type: 'enum', enum: OtpPurpose })
  purpose: OtpPurpose;

  @Column()
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}

@Entity('follows')
@Index(['followerId', 'followingId'], { unique: true })
export class Follow extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  follower: User;

  @Column()
  followerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  following: User;

  @Column()
  followingId: string;
}

@Entity('activity_logs')
@Index(['userId', 'date'])
export class ActivityLog extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ default: 0 })
  minutes: number;

  @Column({ type: 'uuid', nullable: true })
  courseId: string | null;

  @Column({ default: 0 })
  testsDone: number;
}
