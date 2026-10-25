import { Router } from 'express';
import { assignmentController as a, plannerController as p } from '../controllers/learning.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { idParam, validate } from '../middlewares/validate.middleware';
import { handle } from '../utils/asyncHandler';
import { Role } from '../utils/enums';
import * as v from '../validators/learning.validator';

export const assignmentRoutes = Router();
assignmentRoutes.use(authenticate);
const teacher = authorize(Role.TEACHER);
assignmentRoutes.get('/mine', validate({ query: v.assignmentQuery }), handle(a.mine));
assignmentRoutes.get('/teaching', teacher, validate({ query: v.assignmentQuery }), handle(a.teaching));
assignmentRoutes.post('/submissions/:id/grade', teacher, validate({ params: idParam, body: v.gradeSchema }), handle(a.grade));
assignmentRoutes.get('/:id', validate({ params: idParam }), handle(a.get));
assignmentRoutes.post('/', teacher, validate({ body: v.createAssignmentSchema }), handle(a.create, 201));
assignmentRoutes.patch('/:id', teacher, validate({ params: idParam, body: v.updateAssignmentSchema }), handle(a.update));
assignmentRoutes.delete('/:id', teacher, validate({ params: idParam }), handle(a.remove));
assignmentRoutes.post('/:id/submit', authorize(Role.STUDENT), validate({ params: idParam, body: v.submitSchema }), handle(a.submit));

export const plannerRoutes = Router();
plannerRoutes.use(authenticate);
plannerRoutes.get('/', validate({ query: v.plannerQuery }), handle(p.list));
plannerRoutes.get('/upcoming', handle(p.upcoming));
plannerRoutes.get('/categories', handle(p.categories));
plannerRoutes.post('/', validate({ body: v.plannerItemSchema }), handle(p.create, 201));
plannerRoutes.patch('/:id', validate({ params: idParam, body: v.updatePlannerItemSchema }), handle(p.update));
plannerRoutes.delete('/:id', validate({ params: idParam }), handle(p.remove));
