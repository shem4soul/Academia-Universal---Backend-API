import { Router } from 'express';
import { courseController as c } from '../controllers/course.controller';
import { authenticate, authorize, optionalAuth } from '../middlewares/auth.middleware';
import { idOrSlugParam, idParam, validate } from '../middlewares/validate.middleware';
import { handle } from '../utils/asyncHandler';
import { Role } from '../utils/enums';
import { pageQuery } from '../utils/pagination';
import * as v from '../validators/course.validator';

const teacher = [authenticate, authorize(Role.TEACHER)];
const r = Router();

// ----- Public catalogue -----
r.get('/categories', handle(c.categories));
r.get('/courses', validate({ query: v.courseQuery }), handle(c.list));
r.get('/certificates/:code', handle(c.verifyCertificate));

// ----- Signed-in learner (static paths before /courses/:id) -----
r.get('/courses/me/enrolled', authenticate, validate({ query: v.enrolledQuery }), handle(c.enrolled));
r.get('/courses/me/bookmarks', authenticate, handle(c.bookmarks));
r.get('/courses/me/teaching', ...teacher, handle(c.teaching));
r.get('/courses/recommended', authenticate, handle(c.recommended));

r.get('/courses/:id', optionalAuth, validate({ params: idOrSlugParam }), handle(c.detail));
r.get('/courses/:id/related', validate({ params: idOrSlugParam }), handle(c.related));
r.get('/courses/:id/reviews', validate({ params: idOrSlugParam, query: pageQuery }), handle(c.reviews));
r.post('/courses/:id/reviews', authenticate, validate({ params: idOrSlugParam, body: v.reviewSchema }), handle(c.review));
r.post('/courses/:id/enroll', authenticate, validate({ params: idOrSlugParam }), handle(c.enroll));
r.delete('/courses/:id/enroll', authenticate, validate({ params: idOrSlugParam }), handle(c.unenroll));
r.post('/courses/:id/bookmark', authenticate, validate({ params: idOrSlugParam }), handle(c.bookmark));
r.delete('/courses/:id/bookmark', authenticate, validate({ params: idOrSlugParam }), handle(c.unbookmark));
r.get('/courses/:id/certificate', authenticate, validate({ params: idOrSlugParam }), handle(c.certificate));

r.get('/lessons/:id', authenticate, validate({ params: idParam }), handle(c.lesson));
r.post('/lessons/:id/complete', authenticate, validate({ params: idParam, body: v.lessonCompleteSchema }), handle(c.completeLesson));
r.post('/activity/heartbeat', authenticate, validate({ body: v.heartbeatSchema }), handle(c.heartbeat));

// ----- Instructor -----
r.post('/courses', ...teacher, validate({ body: v.createCourseSchema }), handle(c.create, 201));
r.patch('/courses/:id', ...teacher, validate({ params: idOrSlugParam, body: v.updateCourseSchema }), handle(c.update));
r.delete('/courses/:id', ...teacher, validate({ params: idOrSlugParam }), handle(c.remove));
r.get('/courses/:id/students', ...teacher, validate({ params: idOrSlugParam }), handle(c.students));
r.post('/courses/:id/modules', ...teacher, validate({ params: idOrSlugParam, body: v.moduleSchema }), handle(c.addModule, 201));
r.patch('/modules/:id', ...teacher, validate({ params: idParam, body: v.moduleSchema }), handle(c.updateModule));
r.delete('/modules/:id', ...teacher, validate({ params: idParam }), handle(c.removeModule));
r.post('/modules/:id/lessons', ...teacher, validate({ params: idParam, body: v.lessonSchema }), handle(c.addLesson, 201));
r.patch('/lessons/:id', ...teacher, validate({ params: idParam, body: v.updateLessonSchema }), handle(c.updateLesson));
r.delete('/lessons/:id', ...teacher, validate({ params: idParam }), handle(c.removeLesson));

export default r;
