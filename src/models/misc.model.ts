import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.model';
import { DeliveryMode, PaymentPurpose, PaymentStatus, ResourceType, TicketStatus } from '../utils/enums';
import { User } from './user.model';

const decimal = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('resources')
export class Resource extends BaseEntity {
  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'enum', enum: ResourceType })
  type: ResourceType;

  @Column()
  url: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnailUrl: string | null;

  @Column()
  authorName: string;

  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ type: 'enum', enum: DeliveryMode, default: DeliveryMode.ONLINE })
  mode: DeliveryMode;

  @Column({ default: true })
  downloadable: boolean;

  @Column({ default: 0 })
  views: number;

  @Column({ default: 0 })
  downloads: number;

  @Column({ type: 'uuid', nullable: true })
  uploadedById: string | null;
}

@Entity('faqs')
export class Faq extends BaseEntity {
  @Column()
  question: string;

  @Column({ type: 'text' })
  answer: string;

  /** Optional bullet list rendered under the answer. */
  @Column({ type: 'text', array: true, default: '{}' })
  bullets: string[];

  @Column({ default: 0 })
  position: number;
}

@Entity('support_tickets')
export class SupportTicket extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true, eager: true })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column()
  subject: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Column({ type: 'text', nullable: true })
  response: string | null;
}

/**
 * A card saved through Paystack. We only keep Paystack's reusable `authorization_code` (never card numbers)
 * plus display details. Paystack requires the same customer email when charging it again.
 */
@Entity('payment_cards')
@Index(['userId', 'signature'], { unique: true })
export class PaymentCard extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  /** Paystack authorization_code (AUTH_xxx). Hidden from API responses. */
  @Column({ select: false })
  authorizationCode: string;

  /** Paystack's card fingerprint; the same card saved twice has the same signature. */
  @Column()
  signature: string;

  /** Email the authorization was created with (required by charge_authorization). */
  @Column({ select: false })
  customerEmail: string;

  @Column()
  brand: string;

  @Column({ length: 4 })
  last4: string;

  /** First six digits (BIN), useful for support. */
  @Column({ type: 'varchar', length: 6, nullable: true })
  bin: string | null;

  @Column()
  expMonth: number;

  @Column()
  expYear: number;

  @Column({ type: 'varchar', nullable: true })
  bank: string | null;

  @Column({ type: 'varchar', nullable: true })
  holderName: string | null;

  @Column({ default: false })
  isDefault: boolean;
}

@Entity('payments')
@Index(['userId', 'createdAt'])
@Index(['status', 'createdAt'])
export class Payment extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: PaymentPurpose, default: PaymentPurpose.COURSE })
  purpose: PaymentPurpose;

  /** Major units (naira). Paystack is sent amount × 100 (kobo). */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimal })
  amount: number;

  @Column({ default: 'NGN' })
  currency: string;

  @Column()
  description: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  /** Our reference, also used as the Paystack transaction reference. */
  @Index({ unique: true })
  @Column()
  reference: string;

  @Column({ default: 'paystack' })
  provider: string;

  /** Paystack transaction id (needed for refunds). */
  @Column({ type: 'varchar', nullable: true })
  providerTransactionId: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  accessCode: string | null;

  @Column({ type: 'varchar', nullable: true })
  authorizationUrl: string | null;

  /** card, bank, ussd, bank_transfer, mobile_money … */
  @Column({ type: 'varchar', nullable: true })
  channel: string | null;

  @Column({ type: 'varchar', nullable: true })
  gatewayResponse: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: decimal })
  fees: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** Set once access (enrolment / Pro / saved card) has been granted, so webhook + verify can't double-grant. */
  @Column({ type: 'timestamptz', nullable: true })
  fulfilledAt: Date | null;

  /** Ask Paystack to keep the card for one-tap payments next time. */
  @Column({ default: false })
  saveCard: boolean;

  @Column({ type: 'uuid', nullable: true })
  cardId: string | null;

  @Column({ type: 'uuid', nullable: true })
  courseId: string | null;

  /** For parents paying on behalf of a child. */
  @Column({ type: 'uuid', nullable: true })
  beneficiaryId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  refundReason: string | null;
}

@Entity('newsletter_subscribers')
export class NewsletterSubscriber extends BaseEntity {
  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ default: true })
  active: boolean;
}

@Entity('waitlist_entries')
export class WaitlistEntry extends BaseEntity {
  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ type: 'varchar', nullable: true })
  fullName: string | null;

  @Column({ type: 'varchar', nullable: true })
  role: string | null;
}
