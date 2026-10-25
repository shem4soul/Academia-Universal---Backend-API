import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.model';
import { User } from './user.model';

/**
 * Security and business events (sign-ins, password changes, payments, refunds, admin actions).
 * Kept in the database so admins can search them in the app; operational logs go to log files.
 */
@Entity('audit_logs')
@Index(['action', 'createdAt'])
@Index(['userId', 'createdAt'])
export class AuditLog extends BaseEntity {
  /** Who did it (null for anonymous actions such as a failed sign-in or a webhook). */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true, eager: true })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** Dot-namespaced event, e.g. auth.login, payment.success, admin.user.suspend */
  @Column()
  action: string;

  @Column({ default: 'info' })
  severity: 'info' | 'warning' | 'critical';

  @Column({ type: 'varchar', nullable: true })
  entityType: string | null;

  @Column({ type: 'varchar', nullable: true })
  entityId: string | null;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', nullable: true })
  requestId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;
}
