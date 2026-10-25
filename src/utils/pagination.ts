import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
});

export type PageQuery = z.infer<typeof pageQuery>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function paginate<T>(items: T[], total: number, q: { page: number; limit: number }): Paginated<T> {
  return { items, total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) };
}

export const offset = (q: { page: number; limit: number }) => (q.page - 1) * q.limit;

/** Paginate an in-memory array. */
export function pageOf<T>(all: T[], q: { page: number; limit: number }): Paginated<T> {
  return paginate(all.slice(offset(q), offset(q) + q.limit), all.length, q);
}
