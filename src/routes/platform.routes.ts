import { Router } from 'express';
import {
  adminController as ad,
  billingController as b,
  insightsController as i,
  logController as lg,
  marketingController as m,
  parentController as pa,
  resourceController as rs,
  supportController as s,
} from '../controllers/platform.controller';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize, optionalAuth } from '../middlewares/auth.middleware';
import { idParam, validate } from '../middlewares/validate.middleware';
import { handle } from '../utils/asyncHandler';
import { Role } from '../utils/enums';
import { pageQuery } from '../utils/pagination';
import * as v from '../validators/platform.validator';

// ----- Dashboards, progress, leaderboard, analytics -----
export const insightRoutes = Router();
// Mounted at the API root, so authenticate per route (a router-level `use` would also guard every later mount).
insightRoutes.get('/dashboard', authenticate, handle(i.dashboard));
insightRoutes.get('/dashboard/student', authenticate, authorize(Role.STUDENT), handle(i.student));
insightRoutes.get('/dashboard/teacher', authenticate, authorize(Role.TEACHER), handle(i.teacher));
insightRoutes.get('/dashboard/parent', authenticate, authorize(Role.PARENT), handle(i.parent));
insightRoutes.get('/dashboard/admin', authenticate, authorize(Role.ADMIN), handle(i.admin));
insightRoutes.get('/progress', authenticate, handle(i.progress));
insightRoutes.get('/activity', authenticate, handle(i.activity));
insightRoutes.get('/leaderboard', authenticate, validate({ query: v.leaderboardQuery }), handle(i.leaderboard));
insightRoutes.get('/analytics/students', authenticate, authorize(Role.TEACHER), validate({ query: pageQuery }), handle(i.studentAnalytics));
insightRoutes.get('/analytics/students/:studentId', authenticate, authorize(Role.TEACHER, Role.PARENT), validate({ params: v.studentParam }), handle(i.studentDetail));

// ----- Billing -----
export const billingRoutes = Router();
billingRoutes.get('/plans', handle(b.plans));
billingRoutes.get('/config', handle(b.config));
billingRoutes.use(authenticate);
billingRoutes.get('/cards', handle(b.cards));
billingRoutes.post('/cards', handle(b.addCard, 201));
billingRoutes.post('/cards/:id/default', validate({ params: idParam }), handle(b.setDefault));
billingRoutes.delete('/cards/:id', validate({ params: idParam }), handle(b.removeCard));
billingRoutes.get('/payments', validate({ query: pageQuery }), handle(b.history));
billingRoutes.post('/paystack/initialize', validate({ body: v.initializePaymentSchema }), handle(b.initialize, 201));
billingRoutes.get('/paystack/verify/:reference', validate({ params: v.referenceParam }), handle(b.verify));
billingRoutes.post('/checkout', validate({ body: v.checkoutSchema }), handle(b.checkout, 201));
billingRoutes.post('/pro/cancel', handle(b.cancelPro));

// ----- Resources -----
export const resourceRoutes = Router();
resourceRoutes.use(authenticate);
resourceRoutes.get('/', validate({ query: v.resourceQuery }), handle(rs.list));
resourceRoutes.get('/:id', validate({ params: idParam }), handle(rs.get));
resourceRoutes.post('/:id/download', validate({ params: idParam }), handle(rs.download));
resourceRoutes.post('/', authorize(Role.TEACHER), validate({ body: v.resourceSchema }), handle(rs.create, 201));
resourceRoutes.patch('/:id', authorize(Role.TEACHER), validate({ params: idParam, body: v.resourceSchema.partial() }), handle(rs.update));
resourceRoutes.delete('/:id', authorize(Role.TEACHER), validate({ params: idParam }), handle(rs.remove));

// ----- Support -----
export const supportRoutes = Router();
supportRoutes.get('/faqs', handle(s.faqs));
supportRoutes.post('/tickets', optionalAuth, validate({ body: v.ticketSchema }), handle(s.createTicket, 201));
supportRoutes.get('/tickets/mine', authenticate, handle(s.myTickets));

// ----- Parents -----
export const parentRoutes = Router();
parentRoutes.use(authenticate, authorize(Role.PARENT));
parentRoutes.get('/children', handle(pa.children));
parentRoutes.post('/children', validate({ body: v.addChildSchema }), handle(pa.addChild, 201));
parentRoutes.delete('/children/:id', validate({ params: idParam }), handle(pa.removeChild));
parentRoutes.get('/children/:studentId/progress', validate({ params: v.studentParam }), handle(pa.childProgress));

// ----- Admin -----
export const adminRoutes = Router();
adminRoutes.use(authenticate, authorize(Role.ADMIN));
adminRoutes.get('/users', validate({ query: v.adminUserQuery }), handle(ad.users));
adminRoutes.get('/users/:id', validate({ params: idParam }), handle(ad.user));
adminRoutes.patch('/users/:id', validate({ params: idParam, body: v.adminUpdateUserSchema }), handle(ad.updateUser));
adminRoutes.delete('/users/:id', validate({ params: idParam }), handle(ad.deleteUser));
adminRoutes.get('/verifications', validate({ query: v.verificationQuery }), handle(ad.verifications));
adminRoutes.patch('/verifications/:id', validate({ params: idParam, body: v.reviewVerificationSchema }), handle(ad.reviewVerification));
adminRoutes.get('/payments', validate({ query: v.paymentQuery }), handle(ad.payments));
adminRoutes.post('/payments/:id/refund', validate({ params: idParam, body: v.refundSchema }), handle(ad.refund));
adminRoutes.get('/audit-logs', validate({ query: v.auditQuery }), handle(ad.auditLogs));
adminRoutes.get('/audit-logs/actions', handle(ad.auditActions));
adminRoutes.get('/tickets', validate({ query: v.ticketQuery }), handle(ad.tickets));
adminRoutes.patch('/tickets/:id', validate({ params: idParam, body: v.respondTicketSchema }), handle(ad.respondTicket));
adminRoutes.post('/faqs', validate({ body: v.faqSchema }), handle(ad.createFaq, 201));
adminRoutes.patch('/faqs/:id', validate({ params: idParam, body: v.faqSchema.partial() }), handle(ad.updateFaq));
adminRoutes.delete('/faqs/:id', validate({ params: idParam }), handle(ad.removeFaq));
adminRoutes.post('/categories', validate({ body: v.categorySchema }), handle(ad.createCategory, 201));
adminRoutes.patch('/categories/:id', validate({ params: idParam, body: v.categorySchema.partial() }), handle(ad.updateCategory));
adminRoutes.delete('/categories/:id', validate({ params: idParam }), handle(ad.removeCategory));
adminRoutes.post('/broadcast', validate({ body: v.broadcastSchema }), handle(ad.broadcast));
adminRoutes.get('/newsletter', handle(ad.newsletter));
adminRoutes.get('/waitlist', handle(ad.waitlist));

// ----- Public marketing -----
export const marketingRoutes = Router();
marketingRoutes.post('/newsletter', validate({ body: v.emailSchema }), handle(m.subscribe, 201));
marketingRoutes.post('/newsletter/unsubscribe', validate({ body: v.emailSchema }), handle(m.unsubscribe));
marketingRoutes.post('/waitlist', validate({ body: v.waitlistSchema }), handle(m.waitlist, 201));
marketingRoutes.get('/stats', handle(m.stats));

// ----- Webhooks (no auth; verified by signature). The raw body is captured in app.ts. -----
export const webhookRoutes = Router();
webhookRoutes.post('/paystack', handle(b.webhook));

// ----- Client logs -----
export const logRoutes = Router();
logRoutes.post(
  '/client',
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  optionalAuth,
  validate({ body: v.clientLogSchema }),
  handle(lg.client, 202),
);
logRoutes.get('/me/security', authenticate, validate({ query: pageQuery }), handle(lg.mySecurity));
