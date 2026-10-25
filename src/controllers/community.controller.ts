import type { Request } from 'express';
import { me } from '../middlewares/auth.middleware';
import { communityService as svc } from '../services/community.service';

const q = (req: Request) => req.query as never;

export const communityController = {
  list: (req: Request) => svc.list(me(req).id, q(req)),
  unread: (req: Request) => svc.unreadTotal(me(req).id),
  detail: (req: Request) => svc.detail(req.params.id, me(req).id),
  create: (req: Request) => svc.create(me(req), req.body),
  update: (req: Request) => svc.update(req.params.id, me(req), req.body),
  remove: (req: Request) => svc.remove(req.params.id, me(req)),
  join: (req: Request) => svc.join(req.params.id, me(req).id),
  leave: (req: Request) => svc.leave(req.params.id, me(req).id),
  members: (req: Request) => svc.members(req.params.id, me(req)),
  messages: (req: Request) => svc.messages(req.params.id, me(req), q(req)),
  send: (req: Request) => svc.send(req.params.id, me(req), req.body),
  markRead: (req: Request) => svc.markRead(req.params.id, me(req).id),
  live: (req: Request) => svc.setLiveSession(req.params.id, me(req), req.body.at),
};

export const postController = {
  list: (req: Request) => svc.posts(me(req).id, q(req)),
  create: (req: Request) => svc.createPost(me(req), req.body),
  remove: (req: Request) => svc.deletePost(req.params.id, me(req)),
  like: (req: Request) => svc.like(req.params.id, me(req).id, true),
  unlike: (req: Request) => svc.like(req.params.id, me(req).id, false),
  comments: (req: Request) => svc.comments(req.params.id, q(req)),
  comment: (req: Request) => svc.comment(req.params.id, me(req).id, req.body.body),
};

export const chatController = {
  conversations: (req: Request) => svc.conversations(me(req).id),
  thread: (req: Request) => svc.thread(me(req).id, req.params.userId, q(req)),
  send: (req: Request) => svc.sendDirect(me(req).id, req.params.userId, req.body.body),
};

export const announcementController = {
  list: (req: Request) => svc.announcements(me(req)),
  create: (req: Request) => svc.announce(me(req), req.body),
};
