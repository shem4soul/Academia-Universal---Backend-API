import { Router } from 'express';
import authRoutes from './auth.routes';
import { announcementRoutes, chatRoutes, communityRoutes, postRoutes } from './community.routes';
import courseRoutes from './course.routes';
import { assignmentRoutes, plannerRoutes } from './learning.routes';
import {
  adminRoutes,
  billingRoutes,
  insightRoutes,
  logRoutes,
  marketingRoutes,
  parentRoutes,
  resourceRoutes,
  supportRoutes,
  webhookRoutes,
} from './platform.routes';
import { notificationRoutes, uploadRoutes, userRoutes } from './user.routes';

/** All API routes, mounted under /api. The prefix of each mount is used as its tag in the API docs. */
export const routeTable: [string, Router][] = [
  ['/auth', authRoutes],
  ['/users', userRoutes],
  ['/notifications', notificationRoutes],
  ['/uploads', uploadRoutes],
  ['', courseRoutes], // /categories, /courses, /lessons, /modules, /certificates, /activity
  ['/assignments', assignmentRoutes],
  ['/planner', plannerRoutes],
  ['/communities', communityRoutes],
  ['/posts', postRoutes],
  ['/chats', chatRoutes],
  ['/announcements', announcementRoutes],
  ['', insightRoutes], // /dashboard, /progress, /activity, /leaderboard, /analytics
  ['/billing', billingRoutes],
  ['/resources', resourceRoutes],
  ['/support', supportRoutes],
  ['/parents', parentRoutes],
  ['/admin', adminRoutes],
  ['/public', marketingRoutes],
  ['/webhooks', webhookRoutes],
  ['/logs', logRoutes],
];

const api = Router();
for (const [prefix, router] of routeTable) {
  if (prefix) api.use(prefix, router);
  else api.use(router);
}
export default api;
