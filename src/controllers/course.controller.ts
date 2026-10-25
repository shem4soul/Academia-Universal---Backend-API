import type { Request } from 'express';
import { me } from '../middlewares/auth.middleware';
import { courseService as svc } from '../services/course.service';

const q = (req: Request) => req.query as never;

export const courseController = {
  categories: () => svc.listCategories(),
  list: (req: Request) => svc.list(q(req)),
  detail: (req: Request) => svc.detail(req.params.id, req.user),
  related: (req: Request) => svc.related(req.params.id),
  recommended: (req: Request) => svc.recommended(me(req).id, Math.min(Number(req.query.limit ?? 8) || 8, 24)),
  enrolled: (req: Request) => svc.myEnrollments(me(req).id, q(req)),
  bookmarks: (req: Request) => svc.myBookmarks(me(req).id),
  teaching: (req: Request) => svc.teaching(me(req)),
  reviews: (req: Request) => svc.listReviews(req.params.id, q(req)),
  review: (req: Request) => svc.review(me(req).id, req.params.id, req.body.rating, req.body.comment),
  enroll: (req: Request) => svc.enroll(me(req).id, req.params.id),
  unenroll: (req: Request) => svc.unenroll(me(req).id, req.params.id),
  bookmark: (req: Request) => svc.bookmark(me(req).id, req.params.id, true),
  unbookmark: (req: Request) => svc.bookmark(me(req).id, req.params.id, false),
  certificate: (req: Request) => svc.certificate(me(req).id, req.params.id),
  verifyCertificate: (req: Request) => svc.verifyCertificate(req.params.code),
  lesson: (req: Request) => svc.getLesson(req.params.id, me(req)),
  completeLesson: (req: Request) => svc.completeLesson(me(req).id, req.params.id, req.body.minutesSpent),
  heartbeat: (req: Request) => svc.heartbeat(me(req).id, req.body.minutes, req.body.lessonId),

  // instructor
  create: (req: Request) => svc.create(me(req), req.body),
  update: (req: Request) => svc.update(req.params.id, me(req), req.body),
  remove: (req: Request) => svc.remove(req.params.id, me(req)),
  students: (req: Request) => svc.students(req.params.id, me(req)),
  addModule: (req: Request) => svc.addModule(req.params.id, me(req), req.body.title, req.body.position),
  updateModule: (req: Request) => svc.updateModule(req.params.id, me(req), req.body),
  removeModule: (req: Request) => svc.removeModule(req.params.id, me(req)),
  addLesson: (req: Request) => svc.addLesson(req.params.id, me(req), req.body),
  updateLesson: (req: Request) => svc.updateLesson(req.params.id, me(req), req.body),
  removeLesson: (req: Request) => svc.removeLesson(req.params.id, me(req)),
};
