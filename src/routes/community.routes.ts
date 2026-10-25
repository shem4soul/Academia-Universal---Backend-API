import { Router } from 'express';
import { z } from 'zod';
import {
  announcementController as a,
  chatController as ch,
  communityController as c,
  postController as p,
} from '../controllers/community.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { idParam, validate } from '../middlewares/validate.middleware';
import { handle } from '../utils/asyncHandler';
import { Role } from '../utils/enums';
import { pageQuery } from '../utils/pagination';
import * as v from '../validators/community.validator';

export const communityRoutes = Router();
communityRoutes.use(authenticate);
communityRoutes.get('/', validate({ query: v.communityQuery }), handle(c.list));
communityRoutes.get('/unread', handle(c.unread));
communityRoutes.post('/', validate({ body: v.createCommunitySchema }), handle(c.create, 201));
communityRoutes.get('/:id', validate({ params: idParam }), handle(c.detail));
communityRoutes.patch('/:id', validate({ params: idParam, body: v.updateCommunitySchema }), handle(c.update));
communityRoutes.delete('/:id', validate({ params: idParam }), handle(c.remove));
communityRoutes.post('/:id/join', validate({ params: idParam }), handle(c.join));
communityRoutes.delete('/:id/join', validate({ params: idParam }), handle(c.leave));
communityRoutes.get('/:id/members', validate({ params: idParam }), handle(c.members));
communityRoutes.get('/:id/messages', validate({ params: idParam, query: v.messageQuery }), handle(c.messages));
communityRoutes.post('/:id/messages', validate({ params: idParam, body: v.sendMessageSchema }), handle(c.send, 201));
communityRoutes.post('/:id/read', validate({ params: idParam }), handle(c.markRead));
communityRoutes.post('/:id/live', validate({ params: idParam, body: v.liveSessionSchema }), handle(c.live));

export const postRoutes = Router();
postRoutes.use(authenticate);
postRoutes.get('/', validate({ query: v.postQuery }), handle(p.list));
postRoutes.post('/', validate({ body: v.createPostSchema }), handle(p.create, 201));
postRoutes.delete('/:id', validate({ params: idParam }), handle(p.remove));
postRoutes.post('/:id/like', validate({ params: idParam }), handle(p.like));
postRoutes.delete('/:id/like', validate({ params: idParam }), handle(p.unlike));
postRoutes.get('/:id/comments', validate({ params: idParam, query: pageQuery }), handle(p.comments));
postRoutes.post('/:id/comments', validate({ params: idParam, body: v.commentSchema }), handle(p.comment, 201));

export const chatRoutes = Router();
chatRoutes.use(authenticate);
chatRoutes.get('/', handle(ch.conversations));
chatRoutes.get('/:userId', validate({ params: v.userIdParam, query: v.messageQuery }), handle(ch.thread));
chatRoutes.post(
  '/:userId',
  validate({ params: v.userIdParam, body: z.object({ body: z.string().trim().min(1, 'Type a message').max(4000) }) }),
  handle(ch.send, 201),
);

export const announcementRoutes = Router();
announcementRoutes.use(authenticate);
announcementRoutes.get('/', handle(a.list));
announcementRoutes.post('/', authorize(Role.TEACHER), validate({ body: v.announcementSchema }), handle(a.create, 201));
