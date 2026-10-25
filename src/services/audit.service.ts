import { Between, FindOptionsWhere, ILike, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { repo } from '../config/database';
import { AuditLog } from '../models';
import { redact, requestContext, scoped } from '../utils/logger';
import { offset, paginate, PageQuery } from '../utils/pagination';
import { publicUser } from '../utils/serialize';

const log = scoped('audit');

export interface AuditInput {
  userId?: string | null;
  entityType?: string;
  entityId?: string;
  severity?: AuditLog['severity'];
  metadata?: Record<string, unknown>;
}

export interface AuditQuery extends PageQuery {
  action?: string;
  userId?: string;
  severity?: AuditLog['severity'];
  from?: string;
  to?: string;
}

export const auditService = {
  /**
   * Records an audit event. Never throws — auditing must not break the action being audited.
   * IP, user agent and request id come from the current request automatically.
   */
  async record(action: string, input: AuditInput = {}) {
    const ctx = requestContext.getStore();
    const userId = input.userId === undefined ? ctx?.userId ?? null : input.userId;
    const metadata = (redact(input.metadata ?? {}) as Record<string, unknown>) ?? {};
    log.log(input.severity === 'critical' ? 'warn' : 'info', action, {
      userId,
      entityType: input.entityType,
      entityId: input.entityId,
      ...metadata,
    });
    try {
      await repo(AuditLog).save(repo(AuditLog).create({
        action,
        userId,
        severity: input.severity ?? 'info',
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent?.slice(0, 255) ?? null,
        requestId: ctx?.requestId ?? null,
        metadata,
      }));
    } catch (err) {
      log.error('Could not write audit log', { action, err });
    }
  },

  async list(q: AuditQuery) {
    const where: FindOptionsWhere<AuditLog> = {};
    if (q.action) where.action = q.action.endsWith('*') ? ILike(`${q.action.slice(0, -1)}%`) : q.action;
    if (q.userId) where.userId = q.userId;
    if (q.severity) where.severity = q.severity;
    if (q.from && q.to) where.createdAt = Between(new Date(q.from), new Date(q.to));
    else if (q.from) where.createdAt = MoreThanOrEqual(new Date(q.from));
    else if (q.to) where.createdAt = LessThanOrEqual(new Date(q.to));
    const [items, total] = await repo(AuditLog).findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    return paginate(
      items.map((a) => ({
        id: a.id,
        action: a.action,
        severity: a.severity,
        entityType: a.entityType,
        entityId: a.entityId,
        ip: a.ip,
        userAgent: a.userAgent,
        requestId: a.requestId,
        metadata: a.metadata,
        createdAt: a.createdAt,
        user: publicUser(a.user),
      })),
      total,
      q,
    );
  },

  /** Distinct action names, for the admin filter dropdown. */
  async actions() {
    const rows = await repo(AuditLog).createQueryBuilder('a').select('DISTINCT a.action', 'action').orderBy('action').getRawMany<{ action: string }>();
    return rows.map((r) => r.action);
  },

  /** The signed-in user's own security history (Privacy & security screen). */
  async mine(userId: string, q: PageQuery) {
    const [items, total] = await repo(AuditLog).findAndCount({
      where: [
        { userId, action: ILike('auth.%') },
        { userId, action: ILike('payment.%') },
        { userId, action: ILike('card.%') },
      ],
      order: { createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    return paginate(
      items.map((a) => ({ id: a.id, action: a.action, ip: a.ip, userAgent: a.userAgent, createdAt: a.createdAt, metadata: a.metadata })),
      total,
      q,
    );
  },
};
