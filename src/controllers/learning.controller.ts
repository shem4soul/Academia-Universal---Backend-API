import type { Request } from 'express';
import { me } from '../middlewares/auth.middleware';
import { assignmentService } from '../services/assignment.service';
import { plannerService } from '../services/planner.service';

export const assignmentController = {
  mine: (req: Request) => assignmentService.forStudent(me(req).id, req.query as never),
  teaching: (req: Request) => assignmentService.forTeacher(me(req), req.query as never),
  get: (req: Request) => assignmentService.get(req.params.id, me(req)),
  create: (req: Request) => assignmentService.create(me(req), req.body),
  update: (req: Request) => assignmentService.update(req.params.id, me(req), req.body),
  remove: (req: Request) => assignmentService.remove(req.params.id, me(req)),
  submit: (req: Request) => assignmentService.submit(req.params.id, me(req).id, req.body),
  grade: (req: Request) => assignmentService.grade(req.params.id, me(req), req.body.score, req.body.feedback),
};

export const plannerController = {
  list: (req: Request) => plannerService.list(me(req).id, req.query as never),
  upcoming: (req: Request) => plannerService.upcoming(me(req).id, Math.min(Number(req.query.limit ?? 5) || 5, 20)),
  categories: (req: Request) => plannerService.categories(me(req).id),
  create: (req: Request) => plannerService.create(me(req).id, req.body),
  update: (req: Request) => plannerService.update(me(req).id, req.params.id, req.body),
  remove: (req: Request) => plannerService.remove(me(req).id, req.params.id),
};
