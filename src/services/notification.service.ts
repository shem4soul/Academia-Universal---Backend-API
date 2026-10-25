import { In, IsNull } from 'typeorm';
import { repo } from '../config/database';
import { Notification } from '../models';
import { realtime } from '../sockets';
import { ApiError } from '../utils/ApiError';
import { NotificationType } from '../utils/enums';
import { offset, paginate } from '../utils/pagination';

export interface NotifyInput {
  title: string;
  body?: string;
  type?: NotificationType;
  link?: string;
}

const notifications = () => repo(Notification);

const build = (userId: string, input: NotifyInput) =>
  notifications().create({
    userId,
    title: input.title,
    body: input.body ?? '',
    type: input.type ?? NotificationType.SYSTEM,
    link: input.link ?? null,
  });

export const notificationService = {
  async notify(userId: string, input: NotifyInput) {
    const n = await notifications().save(build(userId, input));
    realtime.toUser(userId, 'notification:new', n);
    return n;
  },

  async notifyMany(userIds: string[], input: NotifyInput) {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    const rows = await notifications().save(unique.map((id) => build(id, input)));
    rows.forEach((n) => realtime.toUser(n.userId, 'notification:new', n));
  },

  async list(userId: string, q: { page: number; limit: number; unread?: boolean }) {
    const [items, total] = await notifications().findAndCount({
      where: { userId, ...(q.unread ? { readAt: IsNull() } : {}) },
      order: { createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    const unread = await notifications().countBy({ userId, readAt: IsNull() });
    return { ...paginate(items, total, q), unread };
  },

  async markRead(userId: string, ids: string[]) {
    await notifications().update({ userId, id: In(ids), readAt: IsNull() }, { readAt: new Date() });
    return { ok: true };
  },

  async markAllRead(userId: string) {
    await notifications().update({ userId, readAt: IsNull() }, { readAt: new Date() });
    return { ok: true };
  },

  async remove(userId: string, id: string) {
    const res = await notifications().delete({ id, userId });
    if (!res.affected) throw ApiError.notFound('Notification not found');
    return { ok: true };
  },
};
