import { Brackets } from 'typeorm';
import { repo } from '../config/database';
import { Assignment, Enrollment, PlannerItem } from '../models';
import { ApiError } from '../utils/ApiError';
import { PlannerItemType } from '../utils/enums';
import { PlannerItemInput, PlannerQuery } from '../validators/learning.validator';

const items = () => repo(PlannerItem);

async function owned(userId: string, id: string) {
  const item = await items().findOneBy({ id, userId });
  if (!item) throw ApiError.notFound('Planner item not found');
  return item;
}

export const plannerService = {
  /** Calendar range (day / week / month) plus tasks and reminders, with optional filters. */
  async list(userId: string, q: PlannerQuery) {
    const qb = items().createQueryBuilder('p').where('p.userId = :userId', { userId });
    if (q.type) qb.andWhere('p.type = :type', { type: q.type });
    if (q.completed !== undefined) qb.andWhere('p.completed = :c', { c: q.completed });
    if (q.priority) qb.andWhere('p.priority = :pr', { pr: q.priority });
    if (q.category) qb.andWhere('p.category = :cat', { cat: q.category });
    if (q.from || q.to) {
      const from = q.from ?? new Date(0);
      const to = q.to ?? new Date('2999-01-01');
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('p.startAt < :to AND COALESCE(p.endAt, p.startAt) >= :from', { from, to })
            .orWhere('p.dueAt BETWEEN :from AND :to', { from, to })
            .orWhere('p.remindAt BETWEEN :from AND :to', { from, to }),
        ),
      );
    }
    const rows = await qb.orderBy('COALESCE(p.startAt, p.dueAt, p.remindAt)', 'ASC', 'NULLS LAST').getMany();

    // Assignment deadlines appear on the calendar automatically (read-only).
    let deadlines: { id: string; title: string; dueAt: Date; course: string; courseId: string }[] = [];
    if (!q.type || q.type === PlannerItemType.TASK) {
      const courseIds = (await repo(Enrollment).find({ where: { userId }, select: ['courseId'] })).map((e) => e.courseId);
      if (courseIds.length) {
        const aq = repo(Assignment).createQueryBuilder('a').innerJoinAndSelect('a.course', 'c').where('a.courseId IN (:...ids)', { ids: courseIds });
        if (q.from) aq.andWhere('a.dueDate >= :from', { from: q.from });
        if (q.to) aq.andWhere('a.dueDate <= :to', { to: q.to });
        deadlines = (await aq.getMany()).map((a) => ({ id: a.id, title: a.title, dueAt: a.dueDate, course: a.course.title, courseId: a.courseId }));
      }
    }
    return {
      events: rows.filter((r) => r.type === PlannerItemType.EVENT),
      tasks: rows.filter((r) => r.type === PlannerItemType.TASK),
      reminders: rows.filter((r) => r.type === PlannerItemType.REMINDER),
      deadlines,
    };
  },

  /** Next N upcoming items for dashboards ("Planner" card). */
  async upcoming(userId: string, limit = 5) {
    return items()
      .createQueryBuilder('p')
      .where('p.userId = :userId AND p.completed = false', { userId })
      .andWhere('COALESCE(p.startAt, p.dueAt, p.remindAt) >= now()')
      .orderBy('COALESCE(p.startAt, p.dueAt, p.remindAt)', 'ASC')
      .take(limit)
      .getMany();
  },

  async create(userId: string, dto: PlannerItemInput) {
    return items().save(items().create({ ...dto, userId }));
  },

  async update(userId: string, id: string, dto: Partial<PlannerItem>) {
    const item = await owned(userId, id);
    Object.assign(item, dto);
    return items().save(item);
  },

  async remove(userId: string, id: string) {
    await owned(userId, id);
    await items().delete(id);
    return { ok: true };
  },

  async categories(userId: string) {
    const rows = await items()
      .createQueryBuilder('p')
      .select('DISTINCT p.category', 'category')
      .where('p.userId = :userId AND p.category IS NOT NULL', { userId })
      .getRawMany<{ category: string }>();
    return rows.map((r) => r.category);
  },
};
